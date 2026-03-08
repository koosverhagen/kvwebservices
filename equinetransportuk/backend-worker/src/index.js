import Stripe from "stripe";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

export default {
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

      if (request.method === "POST" && url.pathname === "/api/pricing/quote") {
        const response = await handlePricingQuote(request);
        return withCors(response, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/bookings/create-checkout-session") {
        const response = await handleCreateCheckoutSession(request, env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/bookings/list") {
  const response = await handleListBookings(request, env);
  return withCors(response, corsHeaders);
}

if (request.method === "GET" && url.pathname === "/api/bookings/version") {
  const response = await handleBookingsVersion();
  return withCors(response, corsHeaders);
}

      return withCors(json({ error: "Not found" }, 404), corsHeaders);

    } catch (error) {

      return withCors(
        json({ error: "Server error", detail: error?.message || "Unknown error" }, 500),
        corsHeaders
      );

    }
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

  if (!booking.vehicleId || !booking.vehicleName) {
    return json({ error: "Invalid booking data" }, 400);
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20"
  });

  const confirmationFee = booking.vehicleId.startsWith("v35")
    ? 7500
    : 10000;

  const session = await stripe.checkout.sessions.create({

    payment_method_types: ["card"],
    mode: "payment",

    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: {
            name: `Horsebox booking — ${booking.vehicleName}`
          },
          unit_amount: confirmationFee
        },
        quantity: 1
      }
    ],

  metadata: {
  vehicleId: booking.vehicleId,
  vehicleName: booking.vehicleName || "",
  pickupDate: booking.pickupDate,
  pickupTime: booking.pickupTime || "07:00",
  durationDays: booking.durationDays,
  customerName: booking.customerName,
  customerEmail: booking.customerEmail
},

    success_url: "https://equinetransportuk.com/booking-success",
    cancel_url: "https://equinetransportuk.com/#booking"

  });

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

    const pickupAt = new Date(session.metadata.pickupDate);
const durationDays = Number(session.metadata.durationDays || 1);

let dropoffAt = new Date(pickupAt);

const pickupTime = session.metadata.pickupTime || "07:00";

const [hour, minute] = pickupTime.split(":").map(Number);
pickupAt.setHours(hour, minute, 0, 0);

if (durationDays === 0.5) {

  if (pickupTime === "07:00") {
    dropoffAt.setHours(13,0,0,0);
  } else {
    dropoffAt.setHours(19,0,0,0);
  }

} else {

  dropoffAt.setDate(dropoffAt.getDate() + Math.max(1, durationDays) - 1);
  dropoffAt.setHours(19,0,0,0);

}

const confirmationFee = session.metadata.vehicleId.startsWith("v35")
  ? 75
  : 100;

const booking = {

  id: session.id,

  vehicleId: session.metadata.vehicleId,

  vehicleSnapshot: {
    id: session.metadata.vehicleId,
    name: session.metadata.vehicleName || "",
    type: session.metadata.vehicleId.startsWith("v35") ? "3.5 tonne" : "7.5 tonne"
  },

  pickupAt: pickupAt.toISOString(),
  dropoffAt: dropoffAt.toISOString(),

  durationDays: durationDays,

  pickupTime: pickupAt.toISOString().slice(11,16),

  customerName: session.customer_details?.name || "",
  customerEmail: session.customer_details?.email || session.metadata.customerEmail || "",

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

    /* store booking per day to avoid KV scan */

const start = new Date(booking.pickupAt);
const end = new Date(booking.dropoffAt);

const days = getDatesBetween(start, end);

for (const day of days) {

  const month = day.slice(0,7); // YYYY-MM
const key = `booking:${month}:${booking.id}`;

  await env.BOOKINGS_KV.put(
    key,
    JSON.stringify(booking)
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
   LIST BOOKINGS API
================================ */

async function handleListBookings(request, env) {

  const url = new URL(request.url);

  const from = new Date(url.searchParams.get("from"));
  const to = new Date(url.searchParams.get("to"));

  const month = from.toISOString().slice(0,7); // YYYY-MM

  const list = await env.BOOKINGS_KV.list({
    prefix: `booking:${month}:`,
    limit: 200
  });

  const bookings = [];

  for (const key of list.keys) {

    const value = await env.BOOKINGS_KV.get(key.name);

    if (!value) continue;

    const booking = JSON.parse(value);

    const pickup = new Date(booking.pickupAt);
    const dropoff = new Date(booking.dropoffAt);

    if (pickup <= to && dropoff >= from) {
      bookings.push(booking);
    }

  }

  return json({ bookings });

}


  async function handleBookingsVersion() {

  return json({
    version: Date.now()
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