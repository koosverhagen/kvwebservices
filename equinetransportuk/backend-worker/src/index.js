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

      if (request.method === "POST" && url.pathname === "/api/deposit/create-intent") {
        const response = await handleCreateDepositIntent(request, env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/deposit/cancel") {
        const response = await handleDepositCancel(request, env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/deposit/capture") {
        const response = await handleDepositCapture(request, env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/api/deposit/send-link") {
        const response = await handleSendDepositLink(request, env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/bookings/")) {
        const bookingId = url.pathname.replace("/api/bookings/", "");
        const response = await handleGetBooking(env, bookingId);
        return withCors(response, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/bookings/ical") {
        const response = await handleIcalFeed(env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/deposit/list-all") {
        const response = await handleDepositListAll(env);
        return withCors(response, corsHeaders);
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/deposit/status/")) {
        const bookingId = url.pathname.replace("/api/deposit/status/", "");
        const response = await handleDepositStatus(env, bookingId);
        return withCors(response, corsHeaders);
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/deposit/list/")) {
        const bookingId = url.pathname.replace("/api/deposit/list/", "");
        const response = await handleDepositListByBooking(env, bookingId);
        return withCors(response, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/deposit/pay") {
        const response = await handleDepositPayPage(url, env);
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
  let booking = payload?.booking;
  if (!booking?.id || !booking?.confirmationFee || !booking?.customerEmail) {
    return json({ error: "Invalid booking payload" }, 400);
  }

  booking = await enrichBookingCompliance(env, booking);
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
  assertConfigured(env, ["STRIPE_WEBHOOK_SECRET", "SENDGRID_API_KEY"]);

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
  const object = event.data?.object;

  if (event.type === "checkout.session.completed") {
    const bookingId = bookingIdFromMetadata(object?.metadata);
    if (!bookingId) {
      return json({ error: "Missing booking_id metadata" }, 400);
    }

    let booking = await getBooking(env, bookingId);
    if (!booking) {
      return json({ error: "Booking not found" }, 404);
    }

    booking.status = "confirmed";
    booking.confirmedAt = new Date().toISOString();
    booking.stripeSessionId = object.id;
    booking = await enrichBookingCompliance(env, booking);
    await saveBooking(env, booking);

    await sendConfirmationEmail(env, booking);
    return json({ ok: true, handled: event.type });
  }

  if (event.type === "payment_intent.amount_capturable_updated") {
    const bookingId = bookingIdFromMetadata(object?.metadata);
    if (!bookingId) {
      return json({ ok: true, ignored: true, reason: "missing booking metadata" });
    }

    const booking = await getBooking(env, bookingId);
    if (!booking) {
      return json({ error: "Booking not found" }, 404);
    }

    booking.depositStatus = "hold_active";
    booking.depositPaymentIntentId = object.id;
    booking.depositHoldCreatedAt = new Date().toISOString();
    await saveBooking(env, booking);

    await sendDepositHoldConfirmationEmail(env, booking, object);
    return json({ ok: true, handled: event.type });
  }

  if (event.type === "payment_intent.canceled") {
    const bookingId = bookingIdFromMetadata(object?.metadata);
    if (!bookingId) {
      return json({ ok: true, ignored: true, reason: "missing booking metadata" });
    }

    const booking = await getBooking(env, bookingId);
    if (!booking) {
      return json({ error: "Booking not found" }, 404);
    }

    booking.depositStatus = "hold_canceled";
    booking.depositCanceledAt = new Date().toISOString();
    booking.depositPaymentIntentId = object.id;
    await saveBooking(env, booking);

    await sendDepositCanceledEmail(env, booking);
    return json({ ok: true, handled: event.type });
  }

  if (event.type === "charge.refunded") {
    const paymentIntentId = object?.payment_intent;
    if (!paymentIntentId) {
      return json({ ok: true, ignored: true, reason: "missing payment_intent" });
    }

    const paymentIntent = await stripeGetPaymentIntent(env, paymentIntentId);
    const bookingId = bookingIdFromMetadata(paymentIntent?.metadata);
    if (!bookingId) {
      return json({ ok: true, ignored: true, reason: "missing booking metadata" });
    }

    const booking = await getBooking(env, bookingId);
    if (!booking) {
      return json({ error: "Booking not found" }, 404);
    }

    booking.depositStatus = "refunded";
    booking.depositRefundedAt = new Date().toISOString();
    booking.depositPaymentIntentId = paymentIntentId;
    await saveBooking(env, booking);

    await sendDepositRefundedEmail(env, booking);
    return json({ ok: true, handled: event.type });
  }

  return json({ ok: true, ignored: true, eventType: event.type });
}

async function handleAutomationEvent(request, env) {
  const payload = await request.json();
  let booking = payload?.booking;
  const phase = payload?.phase;

  if (!booking?.id || !phase) {
    return json({ error: "Invalid automation payload" }, 400);
  }

  booking = await enrichBookingCompliance(env, booking);
  await saveBooking(env, booking);
  return json({ ok: true, stored: booking.id });
}

async function handleCreateDepositIntent(request, env) {
  assertConfigured(env, ["STRIPE_SECRET_KEY"]);

  const payload = await request.json();
  const bookingId = String(payload?.bookingID || payload?.bookingId || "").trim();
  const defaultAmountPence = Number(env.DEPOSIT_PENCE || 20000);
  const amount = Number(payload?.amount || defaultAmountPence);

  if (!bookingId || !Number.isFinite(amount) || amount <= 0) {
    return json({ error: "Invalid bookingID or amount" }, 400);
  }

  const booking = await getBooking(env, bookingId);
  if (!booking) {
    return json({ error: "Booking not found" }, 404);
  }

  const params = new URLSearchParams();
  params.set("amount", String(Math.round(amount)));
  params.set("currency", "gbp");
  params.set("capture_method", "manual");
  params.set("payment_method_types[]", "card");
  params.set("metadata[booking_id]", bookingId);
  params.set("metadata[payment_type]", "deposit_hold");
  params.set("description", `Deposit hold - ${booking.vehicleSnapshot?.name || booking.vehicleId} - Booking #${bookingId}`);

  const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  const stripeJson = await stripeRes.json();

  if (!stripeRes.ok) {
    return json({ error: "Stripe deposit intent failed", detail: stripeJson }, 500);
  }

  booking.depositStatus = "intent_created";
  booking.depositPaymentIntentId = stripeJson.id;
  booking.depositAmount = Number((Math.round(amount) / 100).toFixed(2));
  booking.depositIntentCreatedAt = new Date().toISOString();
  await saveBooking(env, booking);

  return json({
    bookingID: bookingId,
    paymentIntentId: stripeJson.id,
    clientSecret: stripeJson.client_secret,
    amount: stripeJson.amount,
    currency: stripeJson.currency,
    status: stripeJson.status
  });
}

async function handleDepositCancel(request, env) {
  assertConfigured(env, ["STRIPE_SECRET_KEY"]);

  const payload = await request.json();
  const paymentIntentId = String(payload?.payment_intent_id || payload?.paymentIntentId || "").trim();

  if (!paymentIntentId) {
    return json({ error: "Missing payment_intent_id" }, 400);
  }

  const stripeRes = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/cancel`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    }
  });
  const stripeJson = await stripeRes.json();

  if (!stripeRes.ok) {
    return json({ error: "Stripe cancel failed", detail: stripeJson }, 500);
  }

  const bookingId = bookingIdFromMetadata(stripeJson?.metadata);
  if (bookingId) {
    const booking = await getBooking(env, bookingId);
    if (booking) {
      booking.depositStatus = "hold_canceled";
      booking.depositCanceledAt = new Date().toISOString();
      booking.depositPaymentIntentId = stripeJson.id;
      await saveBooking(env, booking);
    }
  }

  return json({ id: stripeJson.id, status: stripeJson.status, bookingID: bookingId || null });
}

async function handleDepositCapture(request, env) {
  assertConfigured(env, ["STRIPE_SECRET_KEY"]);

  const payload = await request.json();
  const paymentIntentId = String(payload?.payment_intent_id || payload?.paymentIntentId || "").trim();

  if (!paymentIntentId) {
    return json({ error: "Missing payment_intent_id" }, 400);
  }

  const stripeRes = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/capture`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    }
  });
  const stripeJson = await stripeRes.json();

  if (!stripeRes.ok) {
    return json({ error: "Stripe capture failed", detail: stripeJson }, 500);
  }

  const bookingId = bookingIdFromMetadata(stripeJson?.metadata);
  if (bookingId) {
    const booking = await getBooking(env, bookingId);
    if (booking) {
      booking.depositStatus = "captured";
      booking.depositCapturedAt = new Date().toISOString();
      booking.depositPaymentIntentId = stripeJson.id;
      await saveBooking(env, booking);
    }
  }

  return json({ id: stripeJson.id, status: stripeJson.status, bookingID: bookingId || null });
}

async function handleDepositStatus(env, bookingId) {
  const id = String(bookingId || "").trim();
  if (!id) return json({ error: "Missing bookingID" }, 400);

  const booking = await getBooking(env, id);
  if (!booking) return json({ success: false, error: "Booking not found" }, 404);

  const active = ["hold_active", "captured", "intent_created"].includes(booking.depositStatus);

  return json({
    success: active,
    bookingID: id,
    status: booking.depositStatus || "none",
    amount: Number(booking.depositAmount || 0).toFixed(2),
    paymentIntentId: booking.depositPaymentIntentId || null
  });
}

async function handleDepositListByBooking(env, bookingId) {
  const id = String(bookingId || "").trim();
  if (!id) return json({ error: "Missing bookingID" }, 400);

  const bookings = await listBookings(env);
  const booking = bookings.find((item) => String(item.id) === id);
  if (!booking) return json([], 200);

  return json([
    {
      bookingID: id,
      paymentIntentId: booking.depositPaymentIntentId || null,
      status: booking.depositStatus || "none",
      amount: Number(booking.depositAmount || 0).toFixed(2),
      customerName: booking.customerName || "",
      vehicleName: booking.vehicleSnapshot?.name || booking.vehicleId || "",
      start: booking.pickupAt || "",
      end: booking.dropoffAt || ""
    }
  ]);
}

async function handleDepositListAll(env) {
  const bookings = await listBookings(env);
  const list = bookings
    .filter((item) => item.depositPaymentIntentId)
    .map((item) => ({
      bookingID: item.id,
      paymentIntentId: item.depositPaymentIntentId,
      status: item.depositStatus || "none",
      amount: Number(item.depositAmount || 0).toFixed(2),
      customerName: item.customerName || "",
      vehicleName: item.vehicleSnapshot?.name || item.vehicleId || "",
      start: item.pickupAt || "",
      end: item.dropoffAt || ""
    }));

  return json(list);
}

async function handleGetBooking(env, bookingId) {
  const id = String(bookingId || "").trim();
  if (!id) return json({ error: "Missing bookingID" }, 400);

  const booking = await getBooking(env, id);
  if (!booking) return json({ error: "Booking not found" }, 404);

  return json({
    bookingID: booking.id,
    vehicleName: booking.vehicleSnapshot?.name || booking.vehicleId || "",
    customerName: booking.customerName || "",
    customerEmail: booking.customerEmail || "",
    pickupAt: booking.pickupAt || "",
    dropoffAt: booking.dropoffAt || "",
    hireTotal: Number(booking.hireTotal || 0),
    outstandingAmount: Number(booking.outstandingAmount || 0),
    depositAmount: Number(booking.depositAmount || Number(env.DEPOSIT_PENCE || 20000) / 100),
    depositStatus: booking.depositStatus || "none",
    requiredFormType: booking.requiredFormType || "",
    requiredFormLink: booking.requiredFormLink || "",
    shortFormLink: booking.formLinkA || "",
    longFormLink: booking.formLinkB || ""
  });
}

async function handleDepositPayPage(url, env) {
  const bookingId = String(url.searchParams.get("bookingID") || "").trim();
  if (!bookingId) {
    return new Response("Missing bookingID", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const booking = await getBooking(env, bookingId);
  if (!booking) {
    return new Response("Booking not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const publishable = env.STRIPE_PUBLISHABLE_KEY || "";
  if (!publishable) {
    return new Response("Stripe publishable key not configured", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  const defaultAmountPence = Number(env.DEPOSIT_PENCE || 20000);
  const depositAmountText = (defaultAmountPence / 100).toFixed(2);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Deposit Hold - Booking #${escapeHtml(bookingId)}</title>
  <script src="https://js.stripe.com/v3/"></script>
  <style>
    body{margin:0;padding:0;background:#f6f7fb;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1d2530}
    .container{max-width:620px;margin:18px auto;background:#fff;padding:16px;border-radius:12px;border:1px solid #dbe1e8}
    h1{font-size:24px;margin:0 0 12px}
    .muted{color:#5a6675;font-size:14px}
    .box{background:#f8fbff;border:1px solid #dbe7ff;border-radius:10px;padding:12px;margin:14px 0}
    label{display:block;margin-top:10px;font-size:13px;color:#5a6675}
    input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #dbe1e8;border-radius:10px;margin-top:6px;min-height:42px}
    #card-element{padding:12px;border:1px solid #dbe1e8;border-radius:10px;background:#fff;margin-top:8px}
    button{margin-top:16px;width:100%;min-height:44px;border-radius:10px;border:1px solid #1f6feb;background:#1f6feb;color:#fff;font-weight:600;cursor:pointer}
    button:disabled{opacity:.55;cursor:not-allowed}
    #result{margin-top:12px;font-size:14px}
    @media (max-width:720px){.container{margin:10px;padding:12px}}
  </style>
</head>
<body>
  <div class="container">
    <h1>Deposit hold</h1>
    <p class="muted">Complete the card hold for your booking. This is a pre-authorisation, not an immediate capture.</p>
    <div class="box">
      <div><strong>Booking:</strong> #${escapeHtml(bookingId)}</div>
      <div><strong>Vehicle:</strong> ${escapeHtml(booking.vehicleSnapshot?.name || booking.vehicleId || "Lorry")}</div>
      <div><strong>Pickup:</strong> ${escapeHtml(booking.pickupAt || "")}</div>
      <div><strong>Deposit hold:</strong> £${escapeHtml(depositAmountText)}</div>
    </div>

    <form id="deposit-form">
      <label>Full name
        <input id="full-name" required>
      </label>
      <label>Postcode
        <input id="postcode" required>
      </label>
      <label>Card details
        <div id="card-element"></div>
      </label>
      <button id="pay-btn" type="submit">Confirm deposit hold</button>
      <div id="result"></div>
    </form>
  </div>

  <script>
    const stripe = Stripe(${JSON.stringify(publishable)});
    const bookingID = ${JSON.stringify(bookingId)};
    const depositAmountPence = ${JSON.stringify(defaultAmountPence)};
    const form = document.getElementById("deposit-form");
    const result = document.getElementById("result");
    const payBtn = document.getElementById("pay-btn");

    const elements = stripe.elements();
    const card = elements.create("card");
    card.mount("#card-element");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      payBtn.disabled = true;
      result.textContent = "Processing...";

      try {
        const intentRes = await fetch("/api/deposit/create-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingID, amount: depositAmountPence })
        });
        const intentData = await intentRes.json();
        if (!intentRes.ok || !intentData.clientSecret) {
          throw new Error(intentData.error || "Failed to create deposit intent");
        }

        const fullName = document.getElementById("full-name").value.trim();
        const postcode = document.getElementById("postcode").value.trim();

        const confirm = await stripe.confirmCardPayment(intentData.clientSecret, {
          payment_method: {
            card,
            billing_details: {
              name: fullName,
              address: { postal_code: postcode }
            }
          }
        });

        if (confirm.error) {
          throw new Error(confirm.error.message || "Payment failed");
        }

        const status = confirm.paymentIntent?.status || "unknown";
        if (status === "requires_capture" || status === "succeeded") {
          result.textContent = "Deposit hold successful. You can close this page.";
        } else {
          result.textContent = `Payment status: ${status}`;
        }
      } catch (error) {
        result.textContent = error.message || "Payment failed";
      } finally {
        payBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

async function handleSendDepositLink(request, env) {
  const payload = await request.json();
  const bookingId = String(payload?.bookingID || payload?.bookingId || "").trim();

  if (!bookingId) {
    return json({ success: false, error: "Missing bookingID" }, 400);
  }

  const booking = await getBooking(env, bookingId);
  if (!booking) {
    return json({ success: false, error: "Booking not found" }, 404);
  }

  if (!booking.customerEmail) {
    return json({ success: false, error: "No customer email" }, 400);
  }

  const depositLink = buildDepositLink(env, booking);
  if (!depositLink) {
    return json({ success: false, error: "Deposit link is not configured" }, 400);
  }

  const dedupeKey = `deposit-link-sent:${bookingId}`;
  const sentRecently = await env.BOOKINGS_KV.get(dedupeKey);
  const forced = payload?.force === true;

  if (sentRecently && !forced) {
    return json({ success: true, bookingID: bookingId, alreadySent: true, url: depositLink });
  }

  await sendDepositLinkEmail(env, booking, depositLink, forced);
  await env.BOOKINGS_KV.put(dedupeKey, new Date().toISOString(), { expirationTtl: 60 * 60 * 24 * 3 });

  booking.depositLink = depositLink;
  booking.depositLinkSentAt = new Date().toISOString();
  await saveBooking(env, booking);

  return json({ success: true, bookingID: bookingId, url: depositLink, forced });
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
  assertConfigured(env, ["SENDGRID_API_KEY"]);

  const now = new Date();
  const bookings = await listBookings(env);

  const due = bookings.filter((booking) => {
    if (booking.status !== "confirmed") return false;
    if (booking.reminderSentAt) return false;
    if (!booking.reminderAt) return false;
    return new Date(booking.reminderAt).getTime() <= now.getTime();
  });

  for (const booking of due) {
    const preparedBooking = await enrichBookingCompliance(env, booking);
    await sendReminderEmail(env, preparedBooking);
    preparedBooking.reminderSentAt = new Date().toISOString();
    preparedBooking.status = "reminder_sent";
    await saveBooking(env, preparedBooking);
  }

  return json({ ok: true, remindersSent: due.length });
}

async function sendConfirmationEmail(env, booking) {
  const icalUrl = env.PUBLIC_ICAL_URL || "";
  const requiredFormLabel = booking.requiredFormType === "short"
    ? "Short Form (hired within the last 3 months)"
    : "Long Form (more than 3 months ago)";
  const durationLabel = getDurationLabel(booking.durationDays);
  const pickupLabel = formatBookingDateTime(booking.pickupAt);
  const dropoffLabel = formatBookingDateTime(booking.dropoffAt);
  const html = `
    <h2>Your booking is confirmed</h2>
    <p>Thank you ${escapeHtml(booking.customerName)}.</p>
    <p>Your lorry: <strong>${escapeHtml(booking.vehicleSnapshot?.name || booking.vehicleId)}</strong></p>
    <p>Pickup: ${escapeHtml(pickupLabel)}</p>
    <p>Drop-off: ${escapeHtml(dropoffLabel)}</p>
    <p>Duration: ${escapeHtml(durationLabel)}</p>
    <p>Total hire: £${Number(booking.hireTotal || 0).toFixed(2)}</p>
    <p>Outstanding: £${Number(booking.outstandingAmount || 0).toFixed(2)}</p>
    <h3>Hire form required</h3>
    <p>Based on your hire history, please complete: <strong>${escapeHtml(requiredFormLabel)}</strong></p>
    <p><a href="${escapeHtml(booking.requiredFormLink || "")}">Open required hire form</a></p>
    <p>Submit your DVLA licence check code within the form. All forms must be completed in the driver's name.</p>
    <p>Please bring proof of address on collection.</p>
    ${icalUrl ? `<p>Your iCal feed: <a href="${escapeHtml(icalUrl)}">${escapeHtml(icalUrl)}</a></p>` : ""}
  `;

  await sendEmail(env, {
    to: booking.customerEmail,
    subject: "Equine Transport UK booking confirmed",
    html
  });
}

async function sendReminderEmail(env, booking) {
  const requiredFormLabel = booking.requiredFormType === "short"
    ? "Short Form (hired within the last 3 months)"
    : "Long Form (more than 3 months ago)";
  const durationLabel = getDurationLabel(booking.durationDays);
  const pickupLabel = formatBookingDateTime(booking.pickupAt);
  const dropoffLabel = formatBookingDateTime(booking.dropoffAt);
  const html = `
    <h2>Booking reminder: action required</h2>
    <p>Your pickup is tomorrow for <strong>${escapeHtml(booking.vehicleSnapshot?.name || booking.vehicleId)}</strong>.</p>
    <p>Pickup: ${escapeHtml(pickupLabel)}</p>
    <p>Drop-off: ${escapeHtml(dropoffLabel)}</p>
    <p>Booked duration: ${escapeHtml(durationLabel)}</p>
    <p>Outstanding balance: £${Number(booking.outstandingAmount || 0).toFixed(2)}</p>
    <p>Security deposit: £${Number(booking.depositAmount || 200).toFixed(2)}</p>
    <p><a href="${escapeHtml(booking.outstandingPaymentLink || "")}">Pay outstanding balance</a></p>
    <p><a href="${escapeHtml(booking.depositLink || "")}">Pay security deposit</a></p>
    <p>Required hire form: <strong>${escapeHtml(requiredFormLabel)}</strong></p>
    <p><a href="${escapeHtml(booking.requiredFormLink || "")}">Open required hire form</a></p>
    <p>Also available:</p>
    <ul>
      <li><a href="${escapeHtml(booking.formLinkA || "")}">Short Form</a></li>
      <li><a href="${escapeHtml(booking.formLinkB || "")}">Long Form</a></li>
    </ul>
    <p>Submit your DVLA licence check code inside the form. Forms must be completed in the driver's name.</p>
    <p>Deposit release is processed after return checks and full diesel tank confirmation.</p>
  `;

  await sendEmail(env, {
    to: booking.customerEmail,
    subject: "Equine Transport UK reminder: payment + forms",
    html
  });
}

async function sendDepositLinkEmail(env, booking, depositLink, forced = false) {
  const subject = `Equine Transport UK | Secure Deposit Link${forced ? " (Resent)" : ""} | Booking #${booking.id}`;
  const html = `
    <h2>Deposit payment request</h2>
    <p>Dear ${escapeHtml(booking.customerName || "customer")},</p>
    <p>Please complete your deposit hold for booking <strong>#${escapeHtml(booking.id)}</strong>.</p>
    <p>Vehicle: <strong>${escapeHtml(booking.vehicleSnapshot?.name || booking.vehicleId || "Lorry")}</strong></p>
    <p>Pickup: ${escapeHtml(booking.pickupAt || "")}</p>
    <p><a href="${escapeHtml(depositLink)}">Pay deposit securely</a></p>
    <p>If the button does not work, use this link: ${escapeHtml(depositLink)}</p>
  `;

  await sendEmail(env, {
    to: booking.customerEmail,
    subject,
    html
  });
}

async function sendDepositHoldConfirmationEmail(env, booking, paymentIntent) {
  if (!booking.customerEmail) return;

  const amount = Number(paymentIntent?.amount || 0) / 100;
  const html = `
    <h2>Deposit hold confirmation</h2>
    <p>Booking <strong>#${escapeHtml(booking.id)}</strong> now has an active deposit hold.</p>
    <p>Amount: £${amount.toFixed(2)}</p>
    <p>This is a card hold (manual capture), not an immediate charge.</p>
  `;

  await sendEmail(env, {
    to: booking.customerEmail,
    subject: `Equine Transport UK | Deposit Hold Confirmation | Booking #${booking.id}`,
    html
  });
}

async function sendDepositCanceledEmail(env, booking) {
  if (!booking.customerEmail) return;

  const html = `
    <h2>Deposit hold canceled</h2>
    <p>The deposit hold for booking <strong>#${escapeHtml(booking.id)}</strong> has been canceled.</p>
  `;

  await sendEmail(env, {
    to: booking.customerEmail,
    subject: `Equine Transport UK | Deposit Hold Canceled | Booking #${booking.id}`,
    html
  });
}

async function sendDepositRefundedEmail(env, booking) {
  if (!booking.customerEmail) return;

  const html = `
    <h2>Deposit refunded</h2>
    <p>The deposit for booking <strong>#${escapeHtml(booking.id)}</strong> has been refunded.</p>
  `;

  await sendEmail(env, {
    to: booking.customerEmail,
    subject: `Equine Transport UK | Deposit Refunded | Booking #${booking.id}`,
    html
  });
}

async function sendEmail(env, { to, subject, html }) {
  assertConfigured(env, ["SENDGRID_API_KEY", "EMAIL_FROM"]);

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.SENDGRID_API_KEY}`
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: to }],
          subject
        }
      ],
      from: {
        email: env.EMAIL_FROM,
        name: env.EMAIL_FROM_NAME || "Equine Transport UK"
      },
      content: [
        {
          type: "text/html",
          value: html
        }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`SendGrid send failed: ${detail}`);
  }
}

async function saveBooking(env, booking) {
  await env.BOOKINGS_KV.put(`booking:${booking.id}`, JSON.stringify(booking));
}

async function getBooking(env, id) {
  const raw = await env.BOOKINGS_KV.get(`booking:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function stripeGetPaymentIntent(env, paymentIntentId) {
  assertConfigured(env, ["STRIPE_SECRET_KEY"]);
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Stripe retrieve payment_intent failed: ${detail}`);
  }
  return response.json();
}

function bookingIdFromMetadata(metadata) {
  if (!metadata) return null;
  return metadata.booking_id || metadata.bookingID || null;
}

function getDurationLabel(durationDays) {
  const duration = Number(durationDays || 0);
  if (duration === 0.5) return "1/2 day";
  if (duration === 7) return "week";
  if (duration === 1) return "1 day";
  if (!duration) return "Not specified";
  return `${duration} days`;
}

function formatBookingDateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return String(value || "Not specified");

  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const weekday = get("weekday");
  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");

  return `${weekday} ${day}/${month}/${year} ${hour}:${minute}`.trim();
}

function buildDepositLink(env, booking) {
  if (booking.depositLink) return booking.depositLink;

  const template = env.DEPOSIT_PAYMENT_LINK_TEMPLATE || "";
  if (template.includes("{bookingID}")) {
    return template.replace("{bookingID}", encodeURIComponent(String(booking.id)));
  }

  const pageBase = env.DEPOSIT_PAYMENT_PAGE_BASE || "";
  if (pageBase) {
    const separator = pageBase.includes("?") ? "&" : "?";
    return `${pageBase}${separator}bookingID=${encodeURIComponent(String(booking.id))}`;
  }

  return "";
}

async function enrichBookingCompliance(env, booking) {
  const output = { ...booking };

  const shortFormBase = env.SHORT_FORM_URL || output.formLinkA || "";
  const longFormBase = env.LONG_FORM_URL || output.formLinkB || "";

  const shortFormLink = buildFormLink(shortFormBase, output.id);
  const longFormLink = buildFormLink(longFormBase, output.id);

  output.formLinkA = shortFormLink;
  output.formLinkB = longFormLink;

  let requiredFormType = output.requiredFormType;
  if (requiredFormType !== "short" && requiredFormType !== "long") {
    if (typeof output.hiredWithinLast3Months === "boolean") {
      requiredFormType = output.hiredWithinLast3Months ? "short" : "long";
    } else {
      const bookings = await listBookings(env);
      requiredFormType = hasRecentHireWithin90Days(bookings, output) ? "short" : "long";
    }
  }

  output.requiredFormType = requiredFormType;
  output.requiredFormLink = requiredFormType === "short" ? shortFormLink : longFormLink;
  output.requiredFormLabel = requiredFormType === "short"
    ? "Short Form (hired within last 3 months)"
    : "Long Form (more than 3 months ago)";

  return output;
}

function hasRecentHireWithin90Days(bookings, booking) {
  const targetEmail = String(booking.customerEmail || "").trim().toLowerCase();
  if (!targetEmail) return false;

  const targetPickup = new Date(booking.pickupAt || "");
  if (Number.isNaN(targetPickup.getTime())) return false;

  const windowStart = new Date(targetPickup);
  windowStart.setDate(windowStart.getDate() - 90);

  return bookings.some((item) => {
    if (!item || item.id === booking.id) return false;
    if (String(item.customerEmail || "").trim().toLowerCase() !== targetEmail) return false;
    if (item.status === "cancelled") return false;

    const itemPickup = new Date(item.pickupAt || "");
    if (Number.isNaN(itemPickup.getTime())) return false;

    return itemPickup >= windowStart && itemPickup <= targetPickup;
  });
}

function buildFormLink(baseUrl, bookingId) {
  if (!baseUrl || !bookingId) return "";

  try {
    const parsed = new URL(baseUrl);
    parsed.searchParams.set("bookingID", String(bookingId));
    return parsed.toString();
  } catch {
    const separator = String(baseUrl).includes("?") ? "&" : "?";
    return `${baseUrl}${separator}bookingID=${encodeURIComponent(String(bookingId))}`;
  }
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
