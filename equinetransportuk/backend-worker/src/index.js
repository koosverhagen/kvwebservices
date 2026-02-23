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
      if (request.method === "POST" && url.pathname === "/api/bookings/create-checkout-session") {
        const response = await handleCreateCheckoutSession(request, env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/bookings/stripe-webhook") {
        const response = await handleStripeWebhook(request, env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/bookings/automation") {
        const response = await handleAutomationEvent(request, env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/bookings/ical") {
        const response = await handleIcalFeed(env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/bookings/reminders/run") {
        const response = await runDueReminders(env);
        return withCors(response, corsHeaders);
      }

      return withCors(json({ error: "Not found" }, 404), corsHeaders);
    } catch (error) {
      return withCors(
        json({ error: "Server error", detail: error?.message || "Unknown error" }, 500),
        corsHeaders
      );
    }
  },

  async scheduled(event, env, ctx) {
    await runDueReminders(env);
  }
};

async function handleCreateCheckoutSession(request, env) {
  assertConfigured(env, ["STRIPE_SECRET_KEY", "STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL"]);

  const payload = await request.json();
  const booking = payload?.booking;
  if (!booking?.id || !booking?.confirmationFee || !booking?.customerEmail) {
    return json({ error: "Invalid booking payload" }, 400);
  }

  await saveBooking(env, booking);

  const amountPence = Math.round(Number(booking.confirmationFee) * 100);
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", env.STRIPE_SUCCESS_URL);
  body.set("cancel_url", env.STRIPE_CANCEL_URL);
  body.set("customer_email", booking.customerEmail);
  body.set("line_items[0][price_data][currency]", "gbp");
  body.set("line_items[0][price_data][product_data][name]", `Booking confirmation - ${booking.vehicleSnapshot?.name || "Lorry"}`);
  body.set("line_items[0][price_data][unit_amount]", String(amountPence));
  body.set("line_items[0][quantity]", "1");
  body.set("metadata[booking_id]", booking.id);

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const stripeJson = await stripeResponse.json();
  if (!stripeResponse.ok) {
    return json({ error: "Stripe session creation failed", detail: stripeJson }, 500);
  }

  return json({ checkoutUrl: stripeJson.url });
}

async function handleStripeWebhook(request, env) {
  assertConfigured(env, ["STRIPE_WEBHOOK_SECRET", "BREVO_API_KEY", "PUBLIC_ICAL_URL"]);

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  if (!signature) {
    return json({ error: "Missing stripe-signature header" }, 400);
  }

  const valid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return json({ error: "Invalid webhook signature" }, 400);
  }

  const event = JSON.parse(rawBody);
  if (event.type !== "checkout.session.completed") {
    return json({ ok: true, ignored: true });
  }

  const session = event.data?.object;
  const bookingId = session?.metadata?.booking_id;
  if (!bookingId) {
    return json({ error: "Missing booking_id metadata" }, 400);
  }

  const booking = await getBooking(env, bookingId);
  if (!booking) {
    return json({ error: "Booking not found" }, 404);
  }

  booking.status = "confirmed";
  booking.confirmedAt = new Date().toISOString();
  booking.stripeSessionId = session.id;
  await saveBooking(env, booking);

  await sendConfirmationEmail(env, booking);

  return json({ ok: true });
}

async function handleAutomationEvent(request, env) {
  const payload = await request.json();
  const booking = payload?.booking;
  const phase = payload?.phase;

  if (!booking?.id || !phase) {
    return json({ error: "Invalid automation payload" }, 400);
  }

  await saveBooking(env, booking);
  return json({ ok: true, stored: booking.id });
}

async function handleIcalFeed(env) {
  const bookings = await listBookings(env);
  const confirmed = bookings.filter((booking) => booking.status === "confirmed");
  const ics = buildIcsFeed(confirmed);

  return new Response(ics, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8"
    }
  });
}

async function runDueReminders(env) {
  assertConfigured(env, ["BREVO_API_KEY"]);

  const now = new Date();
  const bookings = await listBookings(env);

  const due = bookings.filter((booking) => {
    if (booking.status !== "confirmed") return false;
    if (booking.reminderSentAt) return false;
    if (!booking.reminderAt) return false;
    return new Date(booking.reminderAt).getTime() <= now.getTime();
  });

  for (const booking of due) {
    await sendReminderEmail(env, booking);
    booking.reminderSentAt = new Date().toISOString();
    booking.status = "reminder_sent";
    await saveBooking(env, booking);
  }

  return json({ ok: true, remindersSent: due.length });
}

async function sendConfirmationEmail(env, booking) {
  const html = `
    <h2>Your booking is confirmed</h2>
    <p>Thank you ${escapeHtml(booking.customerName)}.</p>
    <p>Your lorry: <strong>${escapeHtml(booking.vehicleSnapshot?.name || booking.vehicleId)}</strong></p>
    <p>Pickup: ${escapeHtml(booking.pickupAt)}</p>
    <p>Drop-off: ${escapeHtml(booking.dropoffAt)}</p>
    <p>Total hire: £${Number(booking.hireTotal || 0).toFixed(2)}</p>
    <p>Outstanding: £${Number(booking.outstandingAmount || 0).toFixed(2)}</p>
    <p>Your iCal feed: <a href="${escapeHtml(env.PUBLIC_ICAL_URL)}">${escapeHtml(env.PUBLIC_ICAL_URL)}</a></p>
  `;

  await sendEmail(env, {
    to: booking.customerEmail,
    subject: "Equine Transport UK booking confirmed",
    html
  });
}

async function sendReminderEmail(env, booking) {
  const html = `
    <h2>Booking reminder: action required</h2>
    <p>Your pickup is tomorrow for <strong>${escapeHtml(booking.vehicleSnapshot?.name || booking.vehicleId)}</strong>.</p>
    <p>Outstanding balance: £${Number(booking.outstandingAmount || 0).toFixed(2)}</p>
    <p>Security deposit: £${Number(booking.depositAmount || 200).toFixed(2)}</p>
    <p><a href="${escapeHtml(booking.outstandingPaymentLink || "")}">Pay outstanding balance</a></p>
    <p><a href="${escapeHtml(booking.depositLink || "")}">Pay security deposit</a></p>
    <p>Complete one compliance form:</p>
    <ul>
      <li><a href="${escapeHtml(booking.formLinkA || "")}">Form option A</a></li>
      <li><a href="${escapeHtml(booking.formLinkB || "")}">Form option B</a></li>
    </ul>
  `;

  await sendEmail(env, {
    to: booking.customerEmail,
    subject: "Equine Transport UK reminder: payment + forms",
    html
  });
}

async function sendEmail(env, { to, subject, html }) {
  assertConfigured(env, ["BREVO_API_KEY", "EMAIL_FROM"]);

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME || "Equine Transport UK" },
      to: [{ email: to }],
      subject,
      htmlContent: html
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Brevo send failed: ${detail}`);
  }
}

async function saveBooking(env, booking) {
  await env.BOOKINGS_KV.put(`booking:${booking.id}`, JSON.stringify(booking));
}

async function getBooking(env, id) {
  const raw = await env.BOOKINGS_KV.get(`booking:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function listBookings(env) {
  const list = await env.BOOKINGS_KV.list({ prefix: "booking:" });
  const bookings = [];
  for (const key of list.keys) {
    const raw = await env.BOOKINGS_KV.get(key.name);
    if (raw) bookings.push(JSON.parse(raw));
  }
  return bookings;
}

function buildIcsFeed(bookings) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Equine Transport UK//Bookings//EN"
  ];

  for (const booking of bookings) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${booking.id}@equinetransportuk`);
    lines.push(`DTSTAMP:${toIcsDate(new Date())}`);
    lines.push(`DTSTART:${toIcsDate(new Date(booking.pickupAt))}`);
    lines.push(`DTEND:${toIcsDate(new Date(booking.dropoffAt))}`);
    lines.push(`SUMMARY:${escapeIcs(booking.vehicleSnapshot?.name || booking.vehicleId)} - ${escapeIcs(booking.customerName || "Customer")}`);
    lines.push(`DESCRIPTION:${escapeIcs(`Total £${Number(booking.hireTotal || 0).toFixed(2)} | Outstanding £${Number(booking.outstandingAmount || 0).toFixed(2)} | ${booking.customerEmail || ""}`)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function toIcsDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

async function verifyStripeSignature(rawBody, signatureHeader, webhookSecret) {
  const entries = Object.fromEntries(
    signatureHeader
      .split(",")
      .map((segment) => segment.trim().split("="))
      .filter((parts) => parts.length === 2)
  );

  const timestamp = entries.t;
  const signature = entries.v1;
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const keyData = new TextEncoder().encode(webhookSecret);
  const payloadData = new TextEncoder().encode(signedPayload);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign("HMAC", key, payloadData);
  const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return expected === signature;
}

function assertConfigured(env, keys) {
  for (const key of keys) {
    if (!env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });
}

function buildCorsHeaders(request, env) {
  const origin = request.headers.get("origin") || "*";
  const allowed = env.CORS_ORIGIN || "*";

  return {
    "access-control-allow-origin": allowed === "*" ? "*" : origin,
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
