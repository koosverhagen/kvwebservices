import Stripe from "stripe";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};
const BOOKINGS_RESPONSE_CACHE_TTL = 60 * 1000; // 60 seconds

/* ===============================
   RESERVATION CLEANUP
================================ */

async function cleanupExpiredReservations(env) {

  const EXPIRY_TIME = 10 * 60 * 1000; // 10 minutes

  const list = await env.BOOKINGS_KV.list({ prefix: "reservation:" });

  const now = Date.now();

  for (const key of list.keys) {

    const data = await env.BOOKINGS_KV.get(key.name);

    if (!data) continue;

    let reservation;

    try {
      reservation = JSON.parse(data);
    } catch {
      continue;
    }

    if (!reservation.createdAt) continue;

const createdAt = Number(reservation.createdAt);

if (!Number.isFinite(createdAt)) continue;

const age = now - createdAt;

if (age > EXPIRY_TIME) {

  await env.BOOKINGS_KV.delete(key.name);

  console.log("⏳ Expired reservation removed:", key.name);

}

  }

}

export default {

  /* ===============================
     HTTP REQUEST HANDLER
  ================================ */

  async fetch(request, env, ctx) {

    const url = new URL(request.url);

  /* ===============================
     STRIPE WEBHOOK FIRST
     (must bypass CORS)
  ================================ */

  if (request.method === "POST" && url.pathname === "/api/bookings/stripe-webhook") {
    return handleStripeWebhook(request, env);
  }

  const corsHeaders = buildCorsHeaders();

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {

    /* ===============================
       PRICING ENGINE
    ================================ */

    if (request.method === "POST" && url.pathname === "/api/pricing/quote") {
      const response = await handlePricingQuote(request);
      return withCors(response, corsHeaders);
    }

    

    /* ===============================
       STRIPE CHECKOUT SESSION
    ================================ */

    if (request.method === "POST" && url.pathname === "/api/bookings/create-checkout-session") {
      const response = await handleCreateCheckoutSession(request, env);
      return withCors(response, corsHeaders);
    }

    /* ===============================
       LIST BOOKINGS
    ================================ */

    if (request.method === "GET" && url.pathname === "/api/bookings/list") {
      const response = await handleListBookings(request, env);
      return withCors(response, corsHeaders);
    }

    if (request.method === "GET" && url.pathname === "/api/bookings/by-session") {
    return withCors(await handleBookingBySession(request, env), corsHeaders);
    }

    /* ===============================
       AVAILABILITY API
    ================================ */

    if (request.method === "GET" && url.pathname === "/api/availability") {
     const response = await handleAvailability(request, env);
     return withCors(response, corsHeaders);
    }

    /* ===============================
       VEHICLE AVAILABILITY
    ================================ */

    if (request.method === "GET" && url.pathname === "/api/vehicles/available") {
     const response = await handleVehicleAvailability(request, env);
     return withCors(response, corsHeaders);
    }

    /* ===============================
       MONTH AVAILABILITY (CALENDAR)
    ================================ */

    if (request.method === "GET" && url.pathname === "/api/availability/month") {
     const response = await handleMonthAvailability(request, env);
     return withCors(response, corsHeaders);
    }

    /* ===============================
       CLEAR BOOKINGS (ADMIN)
    ================================ */

    if (request.method === "POST" && url.pathname === "/api/bookings/clear") {
      const response = await handleClearBookings(env);
      return withCors(response, corsHeaders);
    }

    /* ===============================
       BOOKINGS VERSION
    ================================ */

    if (request.method === "GET" && url.pathname === "/api/bookings/version") {

      const response = await handleBookingsVersion(env);
      return withCors(response, corsHeaders);

    }

    /* ===============================
       CREATE / FIND CUSTOMER
    ================================ */

    if (url.pathname === "/api/customers" && request.method === "POST") {

      const body = await request.json();

      const name = body.full_name?.trim();
      const email = body.email?.trim().toLowerCase();
      const mobile = body.mobile?.trim();

      if (!name) {
        return new Response(JSON.stringify({ error: "Name required" }), { status: 400 });
      }

      if (!email && !mobile) {
        return new Response(JSON.stringify({ error: "Email or mobile required" }), { status: 400 });
      }

      const existing = await findCustomerByEmailOrMobile(env, email, mobile);

      if (existing) {
        return withCors(
          json({
            ok: true,
            mode: "existing",
            customer: existing
          }),
          corsHeaders
        );
      }

      const id = "cus_" + crypto.randomUUID();
      const now = new Date().toISOString();

      await env.DB.prepare(`
        INSERT INTO customers (
          id,
          full_name,
          email,
          mobile,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(id, name, email, mobile, now, now)
      .run();

      const customer = await env.DB.prepare(
        "SELECT * FROM customers WHERE id = ?"
      ).bind(id).first();

      return withCors(
        json({
          ok: true,
          mode: "created",
          customer
        }),
        corsHeaders
      );

    }

    /* ===============================
       CUSTOMER LOOKUP
    ================================ */

    if (request.method === "GET" && url.pathname === "/api/customers/lookup") {

      const email = url.searchParams.get("email")?.trim().toLowerCase();
      const mobile = url.searchParams.get("mobile")?.trim();

      if (!email && !mobile) {
        return withCors(json({ found:false }), corsHeaders);
      }

      const customer = await findCustomerByEmailOrMobile(env, email, mobile);

      if (!customer) {
        return withCors(json({ found:false }), corsHeaders);
      }

      return withCors(
        json({
          found: true,
          customer: {
            id: customer.id,
            full_name: customer.full_name,
            email: customer.email,
            mobile: customer.mobile,
            hire_count: customer.hire_count || 0,
            last_hire_at: customer.last_hire_at
          }
        }),
        corsHeaders
      );

    }

    /* ===============================
       CUSTOMER BOOKING HISTORY
    ================================ */

    if (request.method === "GET" && url.pathname === "/api/customers/bookings") {

      const customerId = url.searchParams.get("customer_id");

      if (!customerId) {
        return withCors(json({ bookings: [] }), corsHeaders);
      }

      const result = await env.DB.prepare(`
        SELECT
          id,
          vehicle_id,
          pickup_at,
          dropoff_at,
          duration_days,
          status
        FROM bookings
        WHERE customer_id = ?
        ORDER BY pickup_at DESC
        LIMIT 5
      `)
      .bind(customerId)
      .all();

      return withCors(
        json({
          bookings: result.results || []
        }),
        corsHeaders
      );

    }

    return withCors(json({ error: "Not found" }, 404), corsHeaders);

  } catch (error) {

    return withCors(
      json(
        { error: "Server error", detail: error?.message || "Unknown error" },
        500
      ),
      corsHeaders
    );

  }

  },

  /* ===============================
     CRON JOB — RESERVATION CLEANUP
  ================================ */

  async scheduled(event, env, ctx) {
  console.log("🧹 Running reservation cleanup");
  ctx.waitUntil(cleanupExpiredReservations(env));
}

};


/* ===============================
   PRICING + DISCOUNT ENGINE
================================ */

const DISCOUNT_CODES = [
  {
    code: "SPRING10",
    type: "percent",
    value: 10,
    expires: "2026-05-31",
    vehicles: "all",
    minDuration: 1
  },
  {
    code: "HALFDAY15",
    type: "fixed",
    value: 15,
    expires: "2026-12-31",
    vehicles: ["v35-1", "v35-2", "v35-3"],
    minDuration: 0.5
  }
];

async function handlePricingQuote(request) {

  const payload = await request.json();

  const {
  vehicleId,
  durationDays,
  pickupDate,
  pickupTime,
  discountCode,
  extras = {}
} = payload;

  if (!vehicleId || !durationDays || !pickupDate || !pickupTime) {
    return json({ error: "Missing required pricing fields" }, 400);
  }

  const baseCost = calculateServerBaseCost(vehicleId, durationDays, pickupDate);

const discount = resolveDiscount({
  code: discountCode,
  vehicleId,
  durationDays,
  baseCost
});

if (discount.error) {
  return json({ error: discount.error }, 400);
}

const discountAmount = discount.discountAmount || 0;

/* ===============================
   🔥 ADD HERE (EXACT SPOT)
================================ */

const dartfordTotal = (extras.dartford || 0) * 4.2;
const earlyPickupTotal = extras.earlyPickup ? 20 : 0;
const extrasTotal = dartfordTotal + earlyPickupTotal;

/* ===============================
   TOTAL
================================ */

const discountedTotal = Math.max(
  0,
  baseCost - discountAmount + extrasTotal
);
return json({
  baseCost,
  discountAmount,
  extrasTotal,
  total: discountedTotal
});
}



/* ===============================
   VEHICLE PRICING ENGINE
================================ */

function calculateServerBaseCost(vehicleId, durationDays, pickupDate) {

  const duration = Number(durationDays);
  const date = new Date(pickupDate);
  const day = date.getDay();

  const isWeekend = (day === 0 || day === 6);

  /* 3.5T */

  if (String(vehicleId || "").startsWith("v35")) {

    const prices = {
      0.5: 75,
      1: 105,
      2: 200,
      3: 300,
      4: 400,
      5: 500,
      6: 600,
      7: 700
    };

    return prices[duration] ?? 105 * duration;
  }

  /* 7.5T WITH LIVING */

  if (vehicleId === "v75-1") {

    const prices = {
      1: 175,
      2: 350,
      3: 525,
      4: 700,
      5: 875,
      6: 1050,
      7: 1225
    };

    return prices[duration] ?? 175 * duration;
  }

  /* 7.5T NO LIVING */

  if (vehicleId === "v75-2") {

    let total = 165 * duration;

    if (isWeekend) {

      if (duration === 1) total = 175;
      if (duration === 2) total = 350;

    }

    return total;
  }

  return 0;
}



/* ===============================
   DISCOUNT LOGIC
================================ */

function resolveDiscount({ code, vehicleId, durationDays, baseCost }) {

  if (!code) return { discountAmount: 0 };

  const entry = DISCOUNT_CODES.find(
    d => d.code.toUpperCase() === code.toUpperCase()
  );

  if (!entry) return { error: "Invalid code" };

  const now = new Date();
  const expiry = new Date(entry.expires + "T23:59:59");

  if (now > expiry) return { error: "Code expired" };

  if (entry.vehicles !== "all" && !entry.vehicles.includes(vehicleId)) {
    return { error: "Code not valid for this vehicle" };
  }

  if (Number(durationDays) < Number(entry.minDuration || 0)) {
    return { error: "Code not valid for this duration" };
  }

  let discountAmount = 0;

  if (entry.type === "percent") {
    discountAmount = (baseCost * entry.value) / 100;
  }

  if (entry.type === "fixed") {
    discountAmount = entry.value;
  }

  discountAmount = Math.min(discountAmount, baseCost);

  return {
    discountAmount: Number(discountAmount.toFixed(2))
  };
}




/* ===============================
   STRIPE CHECKOUT SESSION
================================ */

async function handleCreateCheckoutSession(request, env) {

  const booking = await request.json();

  const customerNotes = String(booking.customerNotes || "").slice(0, 500);

  const vehicleName =
    booking.vehicleName ||
    booking.vehicleSnapshot?.name ||
    "Horsebox";

  if (!booking.vehicleId) {
    return json({ error: "Invalid booking data" }, 400);
  }

  /* ===============================
     NORMALISE INPUT
  =============================== */

  const pickupDate = new Date(booking.pickupDate);
  const durationDays = Number(booking.durationDays || 1);
  const pickupTime = booking.pickupTime || "07:00";

  if (Number.isNaN(pickupDate.getTime())) {
    return json({ error: "Invalid pickup date" }, 400);
  }

  /* ===============================
     🔥 SERVER-SIDE PRICING
  =============================== */

  const baseCost = calculateServerBaseCost(
    booking.vehicleId,
    durationDays,
    booking.pickupDate
  );

  const discount = resolveDiscount({
    code: booking.discountCode,
    vehicleId: booking.vehicleId,
    durationDays,
    baseCost
  });

  if (discount.error) {
    return json({ error: discount.error }, 400);
  }

  const discountAmount = discount.discountAmount || 0;

  /* ===============================
     🔥 EXTRAS (NEW FIX)
  =============================== */

  const extras = booking.extras || {};

  const dartfordCount = Number(extras.dartford || 0);
  const dartfordTotal = dartfordCount * 4.2;

  const earlyPickup = extras.earlyPickup ? 1 : 0;
  const earlyPickupTotal = earlyPickup ? 20 : 0;

  const extrasTotal = dartfordTotal + earlyPickupTotal;

  /* ===============================
     FINAL TOTAL (FIXED)
  =============================== */

  const totalHire = Math.max(
    0,
    baseCost - discountAmount + extrasTotal
  );

  function getExpectedConfirmationFee(vehicleId) {
    const id = String(vehicleId || "").trim();

    if (id.startsWith("v35")) return 75;
    if (id.startsWith("v75")) return 100;

    return 75;
  }

  const confirmationFee = getExpectedConfirmationFee(booking.vehicleId);
  const outstandingAmount = Math.max(0, totalHire - confirmationFee);

  console.log("💰 BACKEND PRICING:");
  console.log("baseCost:", baseCost);
  console.log("discountAmount:", discountAmount);
  console.log("extrasTotal:", extrasTotal);
  console.log("totalHire:", totalHire);
  console.log("confirmationFee:", confirmationFee);
  console.log("outstandingAmount:", outstandingAmount);

  /* ===============================
     TEMP RESERVATION LOGIC
     (UNCHANGED)
  =============================== */

  let dropoffDate;

if (durationDays === 0.5) {

  // ✅ keep same day BUT explicit
  dropoffDate = new Date(pickupDate);

} else {

  dropoffDate = new Date(pickupDate);
  dropoffDate.setDate(dropoffDate.getDate() + durationDays - 1);

}

  const reservedDates = getDatesBetween(pickupDate, dropoffDate);

  function getReservationSlot(durationDaysValue, pickupTimeValue) {
    if (Number(durationDaysValue) !== 0.5) return "full";
    return pickupTimeValue === "13:00" ? "pm" : "am";
  }

  function getConfirmedSlot(confirmedBooking) {
    if (Number(confirmedBooking.durationDays) !== 0.5) return "full";
    return confirmedBooking.pickupTime === "13:00" ? "pm" : "am";
  }

  function slotsConflict(a, b) {
    if (a === "full" || b === "full") return true;
    return a === b;
  }

  const requestedSlot = getReservationSlot(durationDays, pickupTime);

  /* ===============================
     CHECK CONFIRMED BOOKINGS
  =============================== */

  const pickupMonth = booking.pickupDate.slice(0, 7);
const existingMonth = await env.BOOKINGS_KV.get(`bookings:${pickupMonth}`);

if (existingMonth) {

  /* ===============================
     SAFE PARSE (CLEAN)
  =============================== */

  let confirmedBookings = [];

  try {
    confirmedBookings = JSON.parse(existingMonth);
    if (!Array.isArray(confirmedBookings)) confirmedBookings = [];
  } catch {
    confirmedBookings = [];
  }

  /* ===============================
     CHECK CONFLICTS
  =============================== */

  for (const confirmed of confirmedBookings) {

    if (confirmed.vehicleId !== booking.vehicleId) continue;

    const confirmedDates = getDatesBetween(
      new Date(confirmed.pickupAt),
      new Date(confirmed.dropoffAt)
    );

    const confirmedSlot = getConfirmedSlot(confirmed);

    for (const d of confirmedDates) {
      if (
        reservedDates.includes(d) &&
        slotsConflict(requestedSlot, confirmedSlot)
      ) {
        return json({
          error: "Vehicle already booked for selected dates."
        }, 409);
      }
    }
  }

}

  /* ===============================
     CHECK TEMP RESERVATIONS
  =============================== */

  for (const date of reservedDates) {

    const exactReservationKey = `reservation:${booking.vehicleId}:${date}:${requestedSlot}`;
    const fullReservationKey = `reservation:${booking.vehicleId}:${date}:full`;

    const existingExactReservation = await env.BOOKINGS_KV.get(exactReservationKey);
    const existingFullReservation = await env.BOOKINGS_KV.get(fullReservationKey);

    if (requestedSlot === "full") {
      const existingAmReservation = await env.BOOKINGS_KV.get(
        `reservation:${booking.vehicleId}:${date}:am`
      );
      const existingPmReservation = await env.BOOKINGS_KV.get(
        `reservation:${booking.vehicleId}:${date}:pm`
      );

      if (existingFullReservation || existingAmReservation || existingPmReservation) {
        return json({
          error: "Vehicle temporarily reserved. Please try again shortly."
        }, 409);
      }
    } else {
      if (existingExactReservation || existingFullReservation) {
        return json({
          error: "Vehicle temporarily reserved. Please try again shortly."
        }, 409);
      }
    }
  }

  /* ===============================
     CREATE TEMP RESERVATIONS
  =============================== */

  for (const date of reservedDates) {

    const reservationKey = `reservation:${booking.vehicleId}:${date}:${requestedSlot}`;

    await env.BOOKINGS_KV.put(
      reservationKey,
      JSON.stringify({
        vehicleId: booking.vehicleId,
        date,
        slot: requestedSlot,
        createdAt: Date.now()
      }),
      { expirationTtl: 600 }
    );
  }

  /* ===============================
     STRIPE
  =============================== */

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "Stripe not configured" }, 500);
  }

const siteBase =
  env.PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://kvwebservices.co.uk/equinetransportuk";

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20"
  });

  let session;

  try {

    session = await stripe.checkout.sessions.create({      payment_method_types: ["card"],
      mode: "payment",

      // ✅ dynamic return URLs (REQUIRED for confirmation step)
      success_url: `${siteBase}/index.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteBase}/index.html?checkout=cancelled`,

      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Horsebox booking — ${vehicleName}`
            },
            unit_amount: Math.round(confirmationFee * 100)
          },
          quantity: 1
        }
      ],

      metadata: {

  bookingId: booking.id,

  vehicleId: booking.vehicleId,
  vehicleName: vehicleName,

  pickupDate: booking.pickupDate,
  pickupTime,
  durationDays: String(durationDays),

  customerName: (booking.customerName || "").slice(0, 100),
  customerEmail: (booking.customerEmail || "").slice(0, 100),
  customerMobile: (booking.customerMobile || "").slice(0, 30),
  customerNotes,

  discountCode: booking.discountCode || "",

  baseCost: String(baseCost),
  discountAmount: String(discountAmount),

  dartfordTotal: String(dartfordTotal),
  earlyPickupTotal: String(earlyPickupTotal),
  extrasTotal: String(extrasTotal),

  // 🔥 ADD THIS LINE
  extrasJson: JSON.stringify(extras || {}),

  totalHire: String(totalHire),
  confirmationFee: String(confirmationFee),
  outstandingAmount: String(outstandingAmount)

}

    });

  } catch (err) {

    return json({
      error: "Stripe session creation failed",
      detail: err?.message || "Unknown Stripe error"
    }, 500);

  }

  if (!session?.url) {
    return json({ error: "Stripe session invalid" }, 500);
  }

  return json({ url: session.url });
}

function getDatesBetween(start, end) {

  const dates = [];
  const current = new Date(start);

  current.setHours(0,0,0,0);

  while (current <= end) {

    dates.push(current.toISOString().slice(0,10));

    current.setDate(current.getDate() + 1);

  }

  return dates;

}


/* ===============================
   STRIPE WEBHOOK
================================ */

async function handleStripeWebhook(request, env) {

  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20"
  });

  let event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      sig,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("❌ Webhook verification failed:", err.message);
    return new Response(
      JSON.stringify({ error: "Webhook signature verification failed" }),
      { status: 400 }
    );
  }

  const eventId = event.id;

  const alreadyProcessed = await env.BOOKINGS_KV.get(eventId);
  if (alreadyProcessed) {
    console.log("⚠️ Webhook already processed:", eventId);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  if (event.type === "checkout.session.completed") {

  try {

    console.log("🔥 WEBHOOK START");

    const session = event.data.object;

    console.log("👉 session received");

    if (!session?.metadata?.vehicleId) {
      console.log("⚠️ Missing vehicleId");
      await env.BOOKINGS_KV.put(eventId, "processed");
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    /* ===============================
       SAFE NUMBER PARSING
    =============================== */

    const totalHire = Number(session.metadata?.totalHire || 0);
    const confirmationFee = Number(session.metadata?.confirmationFee || 0);
    const outstandingAmount = Number(session.metadata?.outstandingAmount || 0);
    const baseCost = Number(session.metadata?.baseCost || totalHire || 0);
    const discountAmount = Number(session.metadata?.discountAmount || 0);

    const dartfordTotal = Number(session.metadata?.dartfordTotal || 0);
    const earlyPickupTotal = Number(session.metadata?.earlyPickupTotal || 0);
    const extrasTotal = Number(session.metadata?.extrasTotal || 0);

    let extras = {};

try {
  extras = JSON.parse(session.metadata?.extrasJson || "{}");
} catch {
  extras = {};
}

const customerNotes = session.metadata?.customerNotes || "";



    console.log("💰 PRICING OK");

    console.log("📦 SAVING BOOKING WITH EXTRAS:", extras);

/* ===============================
   HALF DAY DROP-OFF HELPER
=============================== */

function getHalfDayDropoffTime(pickupTime, vehicleId) {

  // future-proof: only 3.5T supports half-day
  if (!String(vehicleId || "").startsWith("v35")) return null;

  return pickupTime === "13:00" ? "19:00" : "13:00";
}
/* ===============================
   DATES (FIXED FINAL)
=============================== */

const durationDays = Number(session.metadata.durationDays || 1);
const pickupTime = session.metadata.pickupTime || "07:00";

let rawPickupDate = session.metadata.pickupDate || "";

if (rawPickupDate.includes("T")) {
  rawPickupDate = rawPickupDate.split("T")[0];
}

console.log("📅 RAW DATE:", session.metadata.pickupDate);
console.log("📅 CLEAN DATE:", rawPickupDate);

/* ===============================
   PICKUP (FIXED — MATCHES DROPOFF)
=============================== */

let pickupAt;
let pickupAtDate;

// ✅ use London-safe conversion
pickupAtDate = londonDateTimeToUtc(rawPickupDate, pickupTime);

// ✅ convert to ISO ONCE
pickupAt = pickupAtDate.toISOString();
/* ===============================
   DROPOFF (FIXED — CLEAN + SAFE)
=============================== */

let dropoffAt;
let dropoffAtDate;

if (durationDays === 0.5) {

  const dropoffTime = getHalfDayDropoffTime(
    pickupTime,
    session.metadata.vehicleId
  );

  // ✅ use London-safe conversion
  dropoffAtDate = londonDateTimeToUtc(rawPickupDate, dropoffTime);

} else {

  const dropoffDate = new Date(rawPickupDate);
  dropoffDate.setDate(dropoffDate.getDate() + durationDays - 1);

  const dropoffDateStr = dropoffDate.toISOString().slice(0, 10);

  // ✅ use London-safe conversion
  dropoffAtDate = londonDateTimeToUtc(dropoffDateStr, "19:00");

}

// ✅ convert to ISO ONCE (final step only)
dropoffAt = dropoffAtDate.toISOString();
/* ===============================
   SAFETY CHECK (FIXED — CONSISTENT)
=============================== */

if (
  isNaN(pickupAtDate.getTime()) ||
  isNaN(dropoffAtDate.getTime())
) {

  console.warn("⚠️ Invalid date detected — applying fallback", {
    rawPickupDate,
    pickupTime,
    durationDays
  });

  const now = new Date();

  // fallback pickup = now
  pickupAtDate = now;

  // fallback dropoff = +4 hours
  dropoffAtDate = new Date(now);
  dropoffAtDate.setHours(now.getHours() + 4);

  // ✅ ALWAYS convert to ISO strings (consistent)
  pickupAt = pickupAtDate.toISOString();
  dropoffAt = dropoffAtDate.toISOString();
}

/* ===============================
   SAFE LOGGING (ALWAYS WORKS)
=============================== */

console.log("📅 WEBHOOK TIMES:", {
  pickupAt,
  dropoffAt
});


console.log("🔥 FINAL TIMES CHECK:", {
  pickupAt,
  dropoffAt,
  durationDays,
  pickupTime
});
/* ===============================
   BOOKING OBJECT
=============================== */

console.log("📦 BUILD BOOKING");

const booking = {
  id: session.metadata.bookingId || session.id,

  vehicleId: session.metadata.vehicleId,

  vehicleSnapshot: {
    id: session.metadata.vehicleId,
    name: session.metadata.vehicleName || "",
    type: session.metadata.vehicleId.startsWith("v35")
      ? "3.5 tonne"
      : "7.5 tonne"
  },

pickupAt: pickupAt,
dropoffAt: dropoffAt,

 pickupAtLocal: toLondonLocalISOString(new Date(pickupAt)),
dropoffAtLocal: toLondonLocalISOString(new Date(dropoffAt)),

  durationDays,
  pickupTime,

  customerName: session.customer_details?.name || session.metadata.customerName || "",
  customerEmail: session.customer_details?.email || session.metadata.customerEmail || "",
  customerNotes,

  /* ===============================
     🔥 PRICE STRUCTURE (FIX)
  =============================== */

  priceBase: baseCost,
  priceExtras: extrasTotal,
  priceTotal: totalHire,
  paidNow: confirmationFee,
  outstanding: outstandingAmount,

  /* ===============================
     KEEP OLD (for compatibility)
  =============================== */

  baseCost,
  discountAmount,

  dartfordTotal,
  earlyPickupTotal,
  extrasTotal,
  extras,

  hireTotal: totalHire,
  confirmationFee,
  outstandingAmount,

  /* =============================== */

  depositAmount: 200,
  status: "confirmed",
  createdAt: new Date().toISOString()
};

console.log("✅ BOOKING BUILT");

// ===============================
// FORM TYPE LOGIC
// ===============================

let requiredFormType = "long";

try {
  const result = await env.DB.prepare(`
    SELECT pickup_at
    FROM bookings
    WHERE customer_id = ?
    ORDER BY pickup_at DESC
    LIMIT 2
  `)
    .bind(customer?.id || null)
    .all();

  const previousBooking = result.results?.[1];

  if (previousBooking?.pickup_at) {
    const lastHireDate = new Date(previousBooking.pickup_at);
    const now = new Date();

    const diffDays =
      (now.getTime() - lastHireDate.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays <= 90) {
      requiredFormType = "short";
    }
  }

} catch (err) {
  console.warn("Form type check failed:", err);
}

// ===============================
// FORM LINK BUILD
// ===============================

const bookingId = booking.id;

const formBase =
  requiredFormType === "short"
    ? "https://www.equinetransportuk.com/forms/short-form.html"
    : "https://www.equinetransportuk.com/forms/long-form.html";

// ⚠️ IMPORTANT — your forms use bookingID (capital ID)
const formLink = `${formBase}?bookingID=${encodeURIComponent(bookingId)}`;

// save into booking
booking.requiredFormType = requiredFormType;
booking.requiredFormLink = formLink;

    /* ===============================
   SAVE CUSTOMER (SAFE)
=============================== */

let customer = null;

try {

  customer = await findCustomerByEmailOrMobile(
    env,
    booking.customerEmail,
    ""
  );

  if (!customer) {

    const customerId = "cus_" + crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO customers (
        id, full_name, email, mobile, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      customerId,
      booking.customerName,
      booking.customerEmail,
      session.metadata.customerMobile || "",
      now,
      now
    )
    .run();

    customer = { id: customerId };

  }

} catch (err) {
  console.log("⚠️ CUSTOMER ERROR:", err);

  // fallback → still allow booking
  customer = { id: null };
}

    /* ===============================
       SAVE BOOKING (DB)
    =============================== */

    console.log("💾 SAVE BOOKING DB");

    try {

  await env.DB.prepare(`
    INSERT INTO bookings (
      id,
      customer_id,
      vehicle_id,
      pickup_at,
      dropoff_at,
      duration_days,
      price_total,
      paid_now,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  .bind(
    booking.id,
    customer?.id || null,
    booking.vehicleId,
    booking.pickupAt,
    booking.dropoffAt,
    booking.durationDays,
    booking.hireTotal,
    booking.confirmationFee,
    booking.status,
    booking.createdAt,
    booking.createdAt
  )
  .run();

  console.log("✅ DB SAVED");

} catch (err) {
  console.log("💥 DB ERROR:", err);
}

    /* ===============================
       SAVE TO KV
    =============================== */

    console.log("📦 SAVE KV");

    const bookingMonth = booking.pickupAt.slice(0, 7);
    const monthKey = `bookings:${bookingMonth}`;

    let existingMonthBookings = [];

    try {
      const existingMonthData = await env.BOOKINGS_KV.get(monthKey);
      if (existingMonthData) {
        existingMonthBookings = JSON.parse(existingMonthData);
        if (!Array.isArray(existingMonthBookings)) {
          existingMonthBookings = [];
        }
      }
    } catch {}

    existingMonthBookings.push(booking);

    await env.BOOKINGS_KV.put(
      monthKey,
      JSON.stringify(existingMonthBookings)
    );

    console.log("✅ KV SAVED");

    /* ===============================
   🔥 NEW: DIRECT SESSION LOOKUP
================================ */

const sessionKey = `session:${session.id}`;

await env.BOOKINGS_KV.put(
  sessionKey,
  JSON.stringify(booking),
  { expirationTtl: 86400 } // 24h is enough
);

console.log("⚡ Session mapping saved:", sessionKey);

  } catch (err) {

    console.log("💥 WEBHOOK CRASH:", err.message, err.stack);

    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    );
  }
}

  await env.BOOKINGS_KV.put(eventId, "processed");

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

/* ===============================
   LIST BOOKINGS API (MONTH BASED)
================================ */

async function handleListBookings(request, env) {

  const url = new URL(request.url);

  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  if (!fromParam || !toParam) {
    return json({ error: "Missing from/to parameters" }, 400);
  }

  const from = new Date(fromParam);
  const to = new Date(toParam);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return json({ error: "Invalid from/to parameters" }, 400);
  }

  const months = [];

const current = new Date(from);
current.setDate(1);

while (current <= to) {

  const monthKey = current.toISOString().slice(0,7);
  months.push(monthKey);

  current.setMonth(current.getMonth() + 1);

}

  let bookings = [];

  for (const month of months) {

    const data = await env.BOOKINGS_KV.get(`bookings:${month}`);

    if (!data) continue;

    try {

      const parsed = JSON.parse(data);

      bookings = bookings.concat(parsed);

    } catch {}

  }

  /* ===============================
     LOAD ACTIVE RESERVATIONS
  ================================ */

  const reservations = [];

  try {

    const list = await env.BOOKINGS_KV.list({
      prefix: "reservation:"
    });

    for (const key of list.keys) {

  const parts = key.name.split(":");

  if (parts.length >= 3) {

    reservations.push({
      vehicleId: parts[1],
      date: parts[2],
      slot: parts[3] || "full"
    });

  }

}

  } catch (err) {

    console.log("⚠️ Reservation scan failed:", err);

  }

  const transformedBookings = bookings.map(booking => {

  const extras = booking.extras || null;

  return {
    ...booking,

    // always safe number
    extrasTotal: Number(booking.extrasTotal || 0),

    // parsed object for frontend
    extras
  };
});

return json({
  bookings: transformedBookings,
  reservations
});

}

async function handleBookingBySession(request, env) {

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId) {
    return json({ error: "Missing session_id" }, 400);
  }

  /* ===============================
     ⚡ FAST PATH (NEW)
  =============================== */

  const sessionKey = `session:${sessionId}`;

  const cached = await env.BOOKINGS_KV.get(sessionKey);

  if (cached) {
    console.log("⚡ FAST session hit");

    try {
      const booking = JSON.parse(cached);

      return json({
        found: true,
        booking
      });
    } catch (err) {
      console.log("⚠️ Session cache parse error:", err);
    }
  }

  /* ===============================
     HELPERS
  =============================== */

  function cleanIso(value) {
    if (!value || typeof value !== "string") return value;

    if (value.includes("Z") && value.split("T").length > 2) {
      return value.split("Z")[0] + "Z";
    }

    return value;
  }

  /* ===============================
     STRIPE LOOKUP (fallback)
  =============================== */

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20"
  });

  let session;

  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.log("❌ Stripe lookup failed:", err);
    return json({ error: "Stripe lookup failed" }, 500);
  }

  const bookingId =
    session?.metadata?.bookingId ||
    session?.id;

  console.log("🔎 Looking for bookingId:", bookingId);

  /* ===============================
     KV MONTH SCAN (fallback)
  =============================== */

  const months = [];

  const from = new Date();
  from.setMonth(from.getMonth() - 2);

  const to = new Date();
  to.setMonth(to.getMonth() + 3);

  const current = new Date(from);
  current.setDate(1);

  while (current <= to) {
    months.push(current.toISOString().slice(0, 7));
    current.setMonth(current.getMonth() + 1);
  }

  for (const month of months) {

    const data = await env.BOOKINGS_KV.get(`bookings:${month}`);
    if (!data) continue;

    try {

      const bookings = JSON.parse(data);

      const booking = bookings.find(
        b => String(b.id) === String(bookingId)
      );

      if (booking) {

        console.log("✅ Booking found in KV:", bookingId);

        return json({
          found: true,
          booking: {
            ...booking,
            pickupAt: cleanIso(booking.pickupAt),
            dropoffAt: cleanIso(booking.dropoffAt),
            extras: booking.extras || {}
          }
        });
      }

    } catch (err) {
      console.log("⚠️ KV parse error:", err);
    }

  }

  /* ===============================
     FINAL FALLBACK
  =============================== */

  console.log("⚠️ Booking not yet in KV, returning Stripe session");

  return json({
    found: false,
    session: {
      id: session.id,
      metadata: session.metadata || {},
      customer_details: session.customer_details || null
    }
  });
}

async function handleAvailability(request, env) {

  const url = new URL(request.url);

  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  if (!fromParam || !toParam) {
    return json({ error: "Missing from/to parameters" }, 400);
  }

  const fromMonth = fromParam.slice(0, 7);
  const toMonth = toParam.slice(0, 7);

  const months = new Set([fromMonth, toMonth]);
  const availability = [];

  /* ===============================
     CONFIRMED BOOKINGS
  =============================== */

  for (const month of months) {

    const data = await env.BOOKINGS_KV.get(`bookings:${month}`);
    if (!data) continue;

    try {
      const bookings = JSON.parse(data);

      for (const booking of bookings) {
        const dates = getDatesBetween(
          new Date(booking.pickupAt),
          new Date(booking.dropoffAt)
        );

     const slot = getSlotFromBooking(booking);

for (const d of dates) {
  availability.push({
    vehicleId: booking.vehicleId,
    date: d,
    slot,
    status: "booked"
  });
}
      }
    } catch {}
  }

  /* ===============================
     TEMP RESERVATIONS
  =============================== */

  const list = await env.BOOKINGS_KV.list({ prefix: "reservation:" });

  for (const key of list.keys) {
    const parts = key.name.split(":");
    if (parts.length < 4) continue;

    availability.push({
      vehicleId: parts[1],
      date: parts[2],
      slot: parts[3] || "full",
      status: "reserved"
    });
  }

  return json({ availability });
}

async function handleVehicleAvailability(request, env) {

  const url = new URL(request.url);

  const date = url.searchParams.get("date");
  const duration = Number(url.searchParams.get("duration") || 1);
  const pickupTime = url.searchParams.get("pickupTime");

  if (!date) {
    return json({ error: "Missing date parameter" }, 400);
  }

  let requestedSlot = "full";

  if (duration === 0.5) {
    if (pickupTime === "07:00") requestedSlot = "am";
    else if (pickupTime === "13:00") requestedSlot = "pm";
    else requestedSlot = "any";
  }

  const vehicles = [
    "v35-1",
    "v35-2",
    "v35-3",
    "v75-1",
    "v75-2"
  ];

  /* ===============================
     BUILD REQUESTED DATE RANGE
  =============================== */

  let requestedDates = [];

  if (duration === 0.5) {
    requestedDates = [date];
  } else {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + duration - 1);
    requestedDates = getDatesBetween(start, end);
  }

  /* ===============================
     LOAD RELEVANT MONTHS
  =============================== */

  const months = [...new Set(requestedDates.map(d => d.slice(0, 7)))];
  let bookings = [];

  for (const month of months) {
    const data = await env.BOOKINGS_KV.get(`bookings:${month}`);

    if (!data) continue;

    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        bookings.push(...parsed);
      }
    } catch {}
  }

  const result = [];

  for (const vehicleId of vehicles) {

    const vehicleBookings = bookings.filter(
      b => b.vehicleId === vehicleId && b.status !== "cancelled"
    );

    let available = true;
    let availableSlots = [];

    /* ===============================
       HALF DAY
    =============================== */

    if (duration === 0.5) {

      let amBlocked = false;
      let pmBlocked = false;
      let fullBlocked = false;

      for (const b of vehicleBookings) {
        const dates = getDatesBetween(
          new Date(b.pickupAt),
          new Date(b.dropoffAt)
        );

        if (!dates.includes(date)) continue;

        const bookingSlot = getSlotFromBooking(b);

        if (bookingSlot === "full") {
          fullBlocked = true;
          amBlocked = true;
          pmBlocked = true;
        }

        if (bookingSlot === "am") amBlocked = true;
        if (bookingSlot === "pm") pmBlocked = true;
      }

      const list = await env.BOOKINGS_KV.list({
        prefix: `reservation:${vehicleId}:${date}`
      });

      for (const key of list.keys) {
        const parts = key.name.split(":");
        const reservationSlot = parts[3] || "full";

        if (reservationSlot === "full") {
          fullBlocked = true;
          amBlocked = true;
          pmBlocked = true;
        }

        if (reservationSlot === "am") amBlocked = true;
        if (reservationSlot === "pm") pmBlocked = true;
      }

      if (!fullBlocked && !amBlocked) availableSlots.push("am");
      if (!fullBlocked && !pmBlocked) availableSlots.push("pm");

      if (requestedSlot === "am") {
        available = availableSlots.includes("am");
      } else if (requestedSlot === "pm") {
        available = availableSlots.includes("pm");
      } else {
        available = availableSlots.length > 0;
      }

    } else {

      /* ===============================
         FULL / MULTI-DAY
      =============================== */

      for (const requestedDate of requestedDates) {

        let amBlocked = false;
        let pmBlocked = false;
        let fullBlocked = false;

        for (const b of vehicleBookings) {
          const dates = getDatesBetween(
            new Date(b.pickupAt),
            new Date(b.dropoffAt)
          );

          if (!dates.includes(requestedDate)) continue;

          const bookingSlot = getSlotFromBooking(b);

          if (bookingSlot === "full") {
            fullBlocked = true;
            amBlocked = true;
            pmBlocked = true;
          }

          if (bookingSlot === "am") amBlocked = true;
          if (bookingSlot === "pm") pmBlocked = true;
        }

        const list = await env.BOOKINGS_KV.list({
          prefix: `reservation:${vehicleId}:${requestedDate}`
        });

        for (const key of list.keys) {
          const parts = key.name.split(":");
          const reservationSlot = parts[3] || "full";

          if (reservationSlot === "full") {
            fullBlocked = true;
            amBlocked = true;
            pmBlocked = true;
          }

          if (reservationSlot === "am") amBlocked = true;
          if (reservationSlot === "pm") pmBlocked = true;
        }

        const dayAvailable = !fullBlocked && !amBlocked && !pmBlocked;

        if (!dayAvailable) {
          available = false;
          break;
        }
      }
    }

    result.push({
      vehicleId,
      available,
      availableSlots
    });
  }

  return json({ vehicles: result });
}

/* ===============================
   MONTH AVAILABILITY (FAST)
================================ */

async function handleMonthAvailability(request, env) {

  const url = new URL(request.url);

  const month = url.searchParams.get("month");

  if (!month) {
    return json({ error: "Missing month parameter (YYYY-MM)" }, 400);
  }

  const vehicles = [
    "v35-1",
    "v35-2",
    "v35-3",
    "v75-1",
    "v75-2"
  ];

  const days = [];

  const start = new Date(month + "-01");
  const end = new Date(start);

  end.setMonth(end.getMonth() + 1);
  end.setDate(0);

  const current = new Date(start);

  while (current <= end) {

    const date = current.toISOString().slice(0,10);

    const booked = new Set();
    const reserved = new Set();

    /* ===============================
       CONFIRMED BOOKINGS (FAST INDEX)
    ================================ */

    const checks = vehicles.map(v =>
      env.BOOKINGS_KV.get(`booking:${v}:${date}`)
    );

    const results = await Promise.all(checks);

    results.forEach((exists, i) => {
      if (exists) booked.add(vehicles[i]);
    });

    /* ===============================
       TEMP RESERVATIONS
    ================================ */

    const reservations = await env.BOOKINGS_KV.list({
      prefix: "reservation:"
    });

    for (const key of reservations.keys) {

      const parts = key.name.split(":");

      if (parts.length < 3) continue;

      if (parts[2] === date) {
        reserved.add(parts[1]);
      }

    }

    days.push({
      date,
      vehicles: vehicles.map(v => ({
        vehicleId: v,
        available: !(booked.has(v) || reserved.has(v))
      }))
    });

    current.setDate(current.getDate() + 1);

  }

  return json({ days });

}


  async function handleBookingsVersion(env) {

  const version = await env.BOOKINGS_KV.get("bookings:version");

  return json({
    version: version || "0"
  });

}

async function handleClearBookings(env) {

  const bookingsList = await env.BOOKINGS_KV.list({ prefix: "bookings:" });
  await Promise.all(
    bookingsList.keys.map(key => env.BOOKINGS_KV.delete(key.name))
  );

  const bookingIndexList = await env.BOOKINGS_KV.list({ prefix: "booking:" });
  await Promise.all(
    bookingIndexList.keys.map(key => env.BOOKINGS_KV.delete(key.name))
  );

  const reservationsList = await env.BOOKINGS_KV.list({ prefix: "reservation:" });
  await Promise.all(
    reservationsList.keys.map(key => env.BOOKINGS_KV.delete(key.name))
  );

  await env.BOOKINGS_KV.delete("bookings:version");

  return json({ success: true });
}

async function findCustomerByEmailOrMobile(env, email, mobile) {

  if (email) {
    const result = await env.DB.prepare(
      "SELECT * FROM customers WHERE email = ? LIMIT 1"
    ).bind(email).first();

    if (result) return result;
  }

  if (mobile) {
    const result = await env.DB.prepare(
      "SELECT * FROM customers WHERE mobile = ? LIMIT 1"
    ).bind(mobile).first();

    if (result) return result;
  }

  return null;
}

/* ===============================
   HELPERS
================================ */

function buildUtcDate(dateStr, timeStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);

  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

function getSlotFromBooking(booking) {
  if (Number(booking.durationDays) !== 0.5) return "full";
  return booking.pickupTime === "13:00" ? "pm" : "am";
}

function slotsConflict(a, b) {
  if (a === "full" || b === "full") return true;
  return a === b;
}

function json(payload, status = 200) {

  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });

}

function londonDateTimeToUtc(dateString, timeString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  const [hour, minute] = String(timeString).split(":").map(Number);

  const guessUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  const londonParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(guessUtc);

  const get = (type) => londonParts.find(p => p.type === type)?.value || "";

  const londonYear = Number(get("year"));
  const londonMonth = Number(get("month"));
  const londonDay = Number(get("day"));
  const londonHour = Number(get("hour"));
  const londonMinute = Number(get("minute"));

  const wantedUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const shownAsLondonMs = Date.UTC(
    londonYear,
    londonMonth - 1,
    londonDay,
    londonHour,
    londonMinute,
    0
  );

  const offsetMs = shownAsLondonMs - guessUtc.getTime();

  return new Date(wantedUtcMs - offsetMs);
}

function toLondonLocalISOString(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = (type) => parts.find(p => p.type === type)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}


function buildCorsHeaders() {

  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,stripe-signature"
  };

}

function withCors(response, corsHeaders) {

  const headers = new Headers(response.headers);

  Object.entries(corsHeaders).forEach(([key, value]) =>
    headers.set(key, value)
  );

  return new Response(response.body, {
    status: response.status,
    headers
  });

}
