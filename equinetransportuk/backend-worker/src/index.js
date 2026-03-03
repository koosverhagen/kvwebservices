
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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

      if (request.method === "POST" && url.pathname === "/api/bookings/stripe-webhook") {
        const response = await handleStripeWebhook(request, env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/forms/submit") {
        const response = await handleFormSubmit(request, env);
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
  return json({ message: "Checkout endpoint active" });
}

async function handleStripeWebhook(request, env) {
  return json({ message: "Webhook endpoint active" });
}

async function handleFormSubmit(request, env) {
  return json({ message: "Form submission endpoint active" });
}
