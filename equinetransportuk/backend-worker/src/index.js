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
       REBUILD BOOKING INDEX (ADMIN)
    ================================ */

    if (request.method === "POST" && url.pathname === "/api/bookings/rebuild-index") {
     const response = await handleRebuildBookingIndex(env);
     return withCors(response, corsHeaders);
    }

    /* ===============================
       BOOKINGS VERSION
    ================================ */

    if (request.method === "GET" && url.pathname === "/api/bookings/version") {

      const response = await handleBookingsVersion();
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

    await cleanupExpiredReservations(env);

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

  const { vehicleId, durationDays, pickupDate, pickupTime, discountCode } = payload;

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
  const discountedTotal = Math.max(0, baseCost - discountAmount);

  return json({
    baseCost,
    discountAmount,
    discountedTotal
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

  if (vehicleId.startsWith("v35")) {

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

  const vehicleName =
    booking.vehicleName ||
    booking.vehicleSnapshot?.name ||
    "Horsebox";

  if (!booking.vehicleId) {
    return json({ error: "Invalid booking data" }, 400);
  }

  /* ===============================
   TEMPORARY VEHICLE RESERVATION
================================ */

const pickupDate = new Date(booking.pickupDate);
const durationDays = Number(booking.durationDays || 1);

let dropoffDate = new Date(pickupDate);

if (durationDays === 0.5) {

  dropoffDate = new Date(pickupDate);

} else {

  dropoffDate.setDate(dropoffDate.getDate() + Math.max(1, durationDays) - 1);

}

const reservedDates = getDatesBetween(pickupDate, dropoffDate);

/* ===============================
   CHECK CONFIRMED BOOKINGS
================================ */

const pickupMonth = booking.pickupDate.slice(0, 7);
const existingMonth = await env.BOOKINGS_KV.get(`bookings:${pickupMonth}`);

if (existingMonth) {

  try {

    const confirmedBookings = JSON.parse(existingMonth);

    for (const confirmed of confirmedBookings) {

      if (confirmed.vehicleId !== booking.vehicleId) continue;

      const confirmedDates = getDatesBetween(
        new Date(confirmed.pickupAt),
        new Date(confirmed.dropoffAt)
      );

      for (const d of confirmedDates) {

        if (reservedDates.includes(d)) {

          console.log("⚠️ Vehicle already booked:", d);

          return json({
            error: "Vehicle already booked for selected dates."
          }, 409);

        }

      }

    }

  } catch (err) {

    console.log("⚠️ Failed to read confirmed bookings:", err);

  }

}

/* ===============================
   CHECK TEMP RESERVATIONS
================================ */

for (const date of reservedDates) {

  const reservationKey = `reservation:${booking.vehicleId}:${date}`;

  const existingReservation = await env.BOOKINGS_KV.get(reservationKey);

  if (existingReservation) {

    console.log("⚠️ Vehicle already reserved:", reservationKey);

    return json({
      error: "Vehicle temporarily reserved. Please try again shortly."
    }, 409);

  }

}

/* create reservations for all dates */

for (const date of reservedDates) {

  const reservationKey = `reservation:${booking.vehicleId}:${date}`;

  await env.BOOKINGS_KV.put(
    reservationKey,
    JSON.stringify({
      vehicleId: booking.vehicleId,
      date,
      createdAt: Date.now()
    }),
    { expirationTtl: 600 } // 10 minutes
  );

}

  /* ===============================
     STRIPE INITIALISATION
  ================================ */

  if (!env.STRIPE_SECRET_KEY) {

    console.log("❌ STRIPE_SECRET_KEY missing in Worker environment");

    return json({
      error: "Stripe not configured",
      detail: "Missing STRIPE_SECRET_KEY"
    }, 500);

  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20"
  });

  const confirmationFee = booking.vehicleId.startsWith("v35")
    ? 7500
    : 10000;

  let session;

  try {

    session = await stripe.checkout.sessions.create({

      payment_method_types: ["card"],
      mode: "payment",

      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Horsebox booking — ${vehicleName}`
            },
            unit_amount: confirmationFee
          },
          quantity: 1
        }
      ],

      metadata: {
        vehicleId: booking.vehicleId,
        vehicleName: vehicleName,
        pickupDate: booking.pickupDate,
        pickupTime: booking.pickupTime || "07:00",
        durationDays: booking.durationDays,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail
      },

      success_url: "https://equinetransportuk.com/booking-success",
      cancel_url: "https://equinetransportuk.com/#booking"

    });

  } catch (err) {

    console.log("❌ STRIPE CHECKOUT ERROR");
    console.log(err);

    return json({
      error: "Stripe session creation failed",
      detail: err?.message || "Unknown Stripe error"
    }, 500);

  }

  if (!session?.url) {

    console.log("❌ Stripe session created but URL missing");

    return json({
      error: "Stripe session invalid"
    }, 500);

  }

  return json({
    url: session.url
  });

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


  /* Prevent duplicate processing */

  const eventId = event.id;

  const alreadyProcessed = await env.BOOKINGS_KV.get(eventId);

  if (alreadyProcessed) {

    console.log("⚠️ Webhook already processed:", eventId);

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }


  /* Handle booking confirmation */

if (event.type === "checkout.session.completed") {

  const session = event.data.object;

  /* ===============================
     SAFETY CHECK
  ================================ */

  if (!session?.metadata?.vehicleId) {

    console.log("⚠️ Stripe session missing metadata");

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200 }
    );

  }

  

  /* ===============================
   RELEASE TEMPORARY RESERVATIONS
================================ */

const pickupDate = new Date(session.metadata?.pickupDate);
const durationDays = Number(session.metadata?.durationDays || 1);

let dropoffDate = new Date(pickupDate);

if (durationDays === 0.5) {

  dropoffDate = new Date(pickupDate);

} else {

  dropoffDate.setDate(dropoffDate.getDate() + Math.max(1, durationDays) - 1);

}

const reservedDates = getDatesBetween(pickupDate, dropoffDate);

for (const date of reservedDates) {

  const reservationKey =
    `reservation:${session.metadata.vehicleId}:${date}`;

  try {

    await env.BOOKINGS_KV.delete(reservationKey);
    console.log("🔓 Reservation released:", reservationKey);

  } catch (err) {

    console.log("⚠️ Reservation release failed:", reservationKey, err);

  }

}

const pickupAt = new Date(session.metadata?.pickupDate);
const durationDaysConfirmed = Number(session.metadata?.durationDays || 1);

let dropoffAt = new Date(pickupAt);

const pickupTime = session.metadata?.pickupTime || "07:00";

const [hour, minute] = pickupTime.split(":").map(Number);
pickupAt.setHours(hour, minute, 0, 0);

if (durationDaysConfirmed === 0.5) {

  if (pickupTime === "07:00") {
    dropoffAt.setHours(13,0,0,0);
  } else {
    dropoffAt.setHours(19,0,0,0);
  }

} else {

  dropoffAt.setDate(dropoffAt.getDate() + Math.max(1, durationDaysConfirmed) - 1);
  dropoffAt.setHours(19,0,0,0);

}

const confirmationFee = session.metadata?.vehicleId?.startsWith("v35")
  ? 75
  : 100;

const booking = {

  id: session.id,

  vehicleId: session.metadata?.vehicleId,

 vehicleSnapshot: {
  id: session.metadata?.vehicleId,
  name: session.metadata?.vehicleName || "",
  type: session.metadata?.vehicleId?.startsWith("v35")
    ? "3.5 tonne"
    : "7.5 tonne"
},
  pickupAt: pickupAt.toISOString(),
  dropoffAt: dropoffAt.toISOString(),

  durationDays: durationDaysConfirmed,

  pickupTime: pickupAt.toISOString().slice(11,16),

  customerName: session.customer_details?.name || "",
  customerEmail: session.customer_details?.email || session.metadata?.customerEmail || "",

  customerMobile: "",
  customerAddress: "",
  customerDob: "",

  dartfordCrossings: 0,
  crossingCharge: 0,

  earlyPickup: false,
  earlyPickupCharge: 0,

  baseCost: 0,
  discountAmount: 0,
  hireTotal: 0,

  confirmationFee: confirmationFee,

  outstandingAmount: 0,

  depositAmount: 200,

  status: "confirmed",

  createdAt: new Date().toISOString()

};

console.log("✅ Booking confirmed:", booking);

/* ===============================
   SAVE BOOKING IN DATABASE
================================ */

let customer = await findCustomerByEmailOrMobile(
  env,
  booking.customerEmail,
  booking.customerMobile
);

if (!customer) {

  const customerId = "cus_" + crypto.randomUUID();
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
  .bind(
    customerId,
    booking.customerName,
    booking.customerEmail,
    booking.customerMobile,
    now,
    now
  )
  .run();

  customer = await env.DB.prepare(
  "SELECT * FROM customers WHERE id = ?"
).bind(customerId).first();
}

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
  customer.id,
  booking.vehicleId,
  booking.pickupAt,
  booking.dropoffAt,
  booking.durationDays,
  booking.hireTotal || 0,
  booking.confirmationFee || 0,
  booking.status,
  booking.createdAt,
  booking.createdAt
)
.run();

/* ===============================
   UPDATE CUSTOMER HISTORY
================================ */

const hireNow = new Date().toISOString();

await env.DB.prepare(`
  UPDATE customers
  SET
    hire_count = COALESCE(hire_count,0) + 1,
    last_hire_at = ?,
    first_hire_at = COALESCE(first_hire_at, ?),
    updated_at = ?
  WHERE id = ?
`)
.bind(
  hireNow,
  hireNow,
  hireNow,
  customer.id
)
.run();

    /* ===============================
   STORE BOOKING (MONTHLY BUCKET)
================================ */

const pickupMonth = booking.pickupAt.slice(0,7); // YYYY-MM
const key = `bookings:${pickupMonth}`;

/* Load existing month */

let existing = await env.BOOKINGS_KV.get(key);

let list = [];

if (existing) {
  try {
    list = JSON.parse(existing);
  } catch {
    list = [];
  }
}

/* Add booking */

list.push(booking);

/* Save back */

await env.BOOKINGS_KV.put(
  key,
  JSON.stringify(list)
);

/* ===============================
   STORE VEHICLE-DAY INDEX
================================ */

for (const date of reservedDates) {

  const indexKey = `booking:${booking.vehicleId}:${date}`;

  await env.BOOKINGS_KV.put(
    indexKey,
    booking.id
  );

}

  }


  await env.BOOKINGS_KV.put(eventId, "processed");

  return new Response(
    JSON.stringify({ received: true }),
    { status: 200 }
  );

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

  const fromMonth = fromParam.slice(0,7);
  const toMonth = toParam.slice(0,7);

  const months = new Set([fromMonth, toMonth]);

  let bookings = [];

  for (const month of months) {

    const data = await env.BOOKINGS_KV.get(`bookings:${month}`);

    if (!data) continue;

    try {

      const parsed = JSON.parse(data);

      bookings.push(...parsed);

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

      if (parts.length === 3) {

        reservations.push({
          vehicleId: parts[1],
          date: parts[2]
        });

      }

    }

  } catch (err) {

    console.log("⚠️ Reservation scan failed:", err);

  }

  return json({
    bookings,
    reservations
  });

}

async function handleAvailability(request, env) {

  const url = new URL(request.url);

  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  if (!fromParam || !toParam) {
    return json({ error: "Missing from/to parameters" }, 400);
  }

  const fromMonth = fromParam.slice(0,7);
  const toMonth = toParam.slice(0,7);

  const months = new Set([fromMonth, toMonth]);

  const availability = [];

  /* ===============================
     CONFIRMED BOOKINGS
  ================================ */

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

        for (const d of dates) {

          availability.push({
            vehicleId: booking.vehicleId,
            date: d,
            status: "booked"
          });

        }

      }

    } catch {}

  }

  /* ===============================
     TEMP RESERVATIONS
  ================================ */

  const list = await env.BOOKINGS_KV.list({ prefix: "reservation:" });

  for (const key of list.keys) {

    const parts = key.name.split(":");

    if (parts.length !== 3) continue;

    availability.push({
      vehicleId: parts[1],
      date: parts[2],
      status: "reserved"
    });

  }

  return json({ availability });

}

async function handleVehicleAvailability(request, env) {

  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  if (!date) {
    return json({ error: "Missing date parameter" }, 400);
  }

  const vehicles = [
    "v35-1",
    "v35-2",
    "v35-3",
    "v75-1",
    "v75-2"
  ];

  const booked = new Set();
  const reserved = new Set();



  /* ===============================
   CHECK CONFIRMED BOOKINGS (FAST INDEX)
================================ */

const checks = vehicles.map(vehicle =>
  env.BOOKINGS_KV.get(`booking:${vehicle}:${date}`)
);

let results = [];

try {

  results = await Promise.all(checks);

} catch (err) {

  console.log("⚠️ Booking index lookup batch failed:", err);

}

results.forEach((exists, i) => {

  if (exists) {
    booked.add(vehicles[i]);
  }

});

  /* ===============================
     CHECK TEMP RESERVATIONS
  ================================ */

  const list = await env.BOOKINGS_KV.list({ prefix: "reservation:" });

  for (const key of list.keys) {

    const parts = key.name.split(":");

    if (parts.length !== 3) continue;

    if (parts[2] === date) {
      reserved.add(parts[1]);
    }

  }

  /* ===============================
     BUILD RESPONSE
  ================================ */

  const result = vehicles.map(v => ({
    vehicleId: v,
    available: !(booked.has(v) || reserved.has(v))
  }));

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

      if (parts.length !== 3) continue;

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


  async function handleBookingsVersion() {

  return json({
    version: Date.now()
  });

}

async function handleClearBookings(env) {

  const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

  await Promise.all(
    list.keys.map(key => env.BOOKINGS_KV.delete(key.name))
  );
  
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
async function handleRebuildBookingIndex(env) {

  const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

  let indexed = 0;

  for (const key of list.keys) {

    const data = await env.BOOKINGS_KV.get(key.name);

    if (!data) continue;

    let bookings = [];

    try {
      bookings = JSON.parse(data);
    } catch {
      continue;
    }

    for (const booking of bookings) {

      const dates = getDatesBetween(
        new Date(booking.pickupAt),
        new Date(booking.dropoffAt)
      );

      for (const date of dates) {

        const indexKey = `booking:${booking.vehicleId}:${date}`;

        await env.BOOKINGS_KV.put(indexKey, booking.id);
        indexed++;

      }

    }

  }

  return json({
    success: true,
    indexed
  });

}

/* ===============================
   HELPERS
================================ */

function json(payload, status = 200) {

  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });

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
