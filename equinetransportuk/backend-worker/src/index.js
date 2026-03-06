import Stripe from "stripe";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

export default {
  async fetch(request, env, ctx) {

    const url = new URL(request.url);

    /* STRIPE WEBHOOK FIRST (before anything else) */

    if (request.method === "POST" && url.pathname === "/api/bookings/stripe-webhook") {
      return handleStripeWebhook(request, env);
    }

    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {

      if (request.method === "POST" && url.pathname === "/api/pricing/quote") {
        const response = await handlePricingQuote(request, env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/bookings/create-checkout-session") {
        const response = await handleCreateCheckoutSession(request, env);
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

async function handlePricingQuote(request, env) {
  const payload = await request.json();
  const { vehicleId, durationDays, pickupDate, pickupTime, discountCode } = payload;

  if (!vehicleId || !durationDays || !pickupDate || !pickupTime) {
    return json({ error: "Missing required pricing fields" }, 400);
  }

  const baseCost = calculateServerBaseCost(vehicleId, durationDays);

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

function calculateServerBaseCost(vehicleId, durationDays) {
  const duration = Number(durationDays);

  if (duration === 0.5) return 75;
  if (duration === 1) return 105;
  if (duration === 7) return 700;

  return 105 * duration;
}

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
  } else if (entry.type === "fixed") {
    discountAmount = entry.value;
  }

  discountAmount = Math.min(discountAmount, baseCost);

  return {
    discountAmount: Number(discountAmount.toFixed(2))
  };
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

function buildCorsHeaders(request, env) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,stripe-signature"
  };
}

function withCors(response, corsHeaders) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/* ===============================
   PLACEHOLDER ENDPOINTS
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
      pickupDate: booking.pickupDate,
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

  if (event.type === "checkout.session.completed") {

    const session = event.data.object;

    const booking = {
      vehicleId: session.metadata.vehicleId,
      pickupDate: session.metadata.pickupDate,
      durationDays: session.metadata.durationDays,
      customerEmail: session.metadata.customerEmail,
      paymentId: session.id,
      status: "confirmed"
    };

    console.log("✅ Booking confirmed:", booking);

  }

  return new Response(
    JSON.stringify({ received: true }),
    { status: 200 }
  );

}
