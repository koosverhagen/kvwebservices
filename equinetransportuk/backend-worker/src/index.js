import Stripe from "stripe";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
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

/* ===============================
   ⏰ PROCESS REMINDERS
=============================== */

async function processReminders(env) {
  const now = new Date();

  const list = await env.BOOKINGS_KV.list({ prefix: "reminder:" });

  for (const key of list.keys) {
    const data = await env.BOOKINGS_KV.get(key.name);
    if (!data) continue;

    let reminder;

    try {
      reminder = JSON.parse(data);
    } catch {
      continue;
    }

    if (!reminder.sendAt) continue;

    const sendTime = new Date(reminder.sendAt);

    if (now < sendTime) continue;

    console.log("📨 Sending reminder:", reminder.bookingId);

    const booking = await findBookingById(env, reminder.bookingId);

    if (!booking || !booking.customerEmail) {
      console.log("⚠️ Booking/email missing");
      await env.BOOKINGS_KV.delete(key.name);
      continue;
    }

    try {
      const reminderType = booking.formCompleted ? "outstanding" : "form";
      const emailHtml = buildModernEmail({
        title:
          reminderType === "form"
            ? "Reminder – Form required before your hire"
            : "Reminder – Outstanding balance due",

        customerName: booking.customerName,

        booking: {
          id: booking.id,
          vehicle: booking.vehicleSnapshot?.name,
          from: booking.pickupAtLocal,
          to: booking.dropoffAtLocal,
          email: booking.customerEmail,
          mobile: booking.customerMobile,
          paid: booking.confirmationFee,
          outstanding: booking.outstandingAmount,
          total: booking.hireTotal,
          formType: booking.requiredFormType,
          depositPaid: booking.depositPaid,
        },

        formLink: booking.requiredFormLink,
        depositLink: booking.depositLink,
        outstandingLink: booking.outstandingLink,
      });

      await sendBookingEmail(env, {
        to: booking.customerEmail,
        subject:
          reminderType === "form"
            ? "Reminder: Please complete your form"
            : "Reminder: Outstanding balance due",
        html: emailHtml,
      });

      console.log("✅ Reminder email sent");
    } catch (err) {
      console.error("❌ Reminder email failed:", err);
    }

    // ✅ DELETE AFTER SEND
    await env.BOOKINGS_KV.delete(key.name);
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

    if (
      request.method === "POST" &&
      url.pathname === "/api/bookings/stripe-webhook"
    ) {
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

      if (
        request.method === "POST" &&
        url.pathname === "/api/bookings/create-checkout-session"
      ) {
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
         🔥 DEBUG — LAST BOOKING (NEW)
      ================================ */

      if (
        request.method === "GET" &&
        url.pathname === "/api/debug/last-booking"
      ) {
        const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

        let latest = null;

        for (const key of list.keys) {
          const data = await env.BOOKINGS_KV.get(key.name);

          if (!data) continue;

          try {
            const parsed = JSON.parse(data);

            if (Array.isArray(parsed) && parsed.length) {
              latest = parsed[parsed.length - 1];
            }
          } catch {}
        }

        return withCors(json({ latest }), corsHeaders);
      }

      /* ===============================
         BOOKING BY SESSION
      ================================ */

      if (
        request.method === "GET" &&
        url.pathname === "/api/bookings/by-session"
      ) {
        return withCors(
          await handleBookingBySession(request, env),
          corsHeaders,
        );
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

      if (
        request.method === "GET" &&
        url.pathname === "/api/vehicles/available"
      ) {
        const response = await handleVehicleAvailability(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
         MONTH AVAILABILITY (CALENDAR)
      ================================ */

      if (
        request.method === "GET" &&
        url.pathname === "/api/availability/month"
      ) {
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

      if (
        request.method === "GET" &&
        url.pathname === "/api/bookings/version"
      ) {
        const response = await handleBookingsVersion(env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
     DEPOSIT STRIPE SESSION
  =============================== */

      if (request.method === "POST" && url.pathname === "/api/deposit-intent") {
        const { bookingId } = await request.json();

        if (!bookingId) {
          return withCors(
            json({ error: "Missing bookingId" }, 400),
            corsHeaders,
          );
        }

        // ===============================
        // FIND BOOKING
        // ===============================

        const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

        let booking = null;

        for (const key of list.keys) {
          const data = await env.BOOKINGS_KV.get(key.name);
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);

            if (Array.isArray(parsed)) {
              const found = parsed.find((b) => b.id === bookingId);
              if (found) {
                booking = found;
                break;
              }
            }
          } catch {}
        }

        if (!booking) {
          return withCors(
            json({ error: "Booking not found" }, 404),
            corsHeaders,
          );
        }

        // ✅ prevent double hold
        if (booking.depositPaid) {
          return withCors(
            json({ error: "Deposit already secured" }, 400),
            corsHeaders,
          );
        }

        // ===============================
        // CREATE PAYMENT INTENT (HOLD)
        // ===============================

        const stripe = new Stripe(env.STRIPE_SECRET_KEY);

        const paymentIntent = await stripe.paymentIntents.create({
          amount: 20000, // £200
          currency: "gbp",

          capture_method: "manual", // 🔥 HOLD

          receipt_email: booking.customerEmail,

          metadata: {
            bookingId: bookingId,
            paymentType: "deposit",
          },
        });

        return withCors(
          json({
            clientSecret: paymentIntent.client_secret,
          }),
          corsHeaders,
        );
      }

      /* ===============================
         OUTSTANDING STRIPE SESSION
      =============================== */

      if (
        request.method === "GET" &&
        url.pathname === "/api/outstanding-session"
      ) {
        const bookingId = url.searchParams.get("bookingId");

        if (!bookingId) {
          return withCors(
            json({ error: "Missing bookingId" }, 400),
            corsHeaders,
          );
        }

        // ===============================
        // FIND BOOKING IN KV
        // ===============================

        const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

        let booking = null;

        for (const key of list.keys) {
          const data = await env.BOOKINGS_KV.get(key.name);

          if (!data) continue;

          try {
            const parsed = JSON.parse(data);

            if (Array.isArray(parsed)) {
              const found = parsed.find((b) => b.id === bookingId);
              if (found) {
                booking = found;
                break;
              }
            }
          } catch {}
        }

        if (!booking) {
          return withCors(
            json({ error: "Booking not found" }, 404),
            corsHeaders,
          );
        }

        // ===============================
        // PREVENT DOUBLE PAYMENT
        // ===============================

        if (!booking.outstandingAmount || booking.outstandingAmount <= 0) {
          return withCors(json({ error: "Nothing to pay" }, 400), corsHeaders);
        }

        // ===============================
        // CREATE STRIPE SESSION
        // ===============================

        const stripe = new Stripe(env.STRIPE_SECRET_KEY);

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: booking.customerEmail,

          line_items: [
            {
              price_data: {
                currency: "gbp",
                product_data: {
                  name: `Outstanding Balance – ${booking.vehicleSnapshot?.name || "Horsebox Hire"}`,
                },
                unit_amount: Math.round(booking.outstandingAmount * 100),
              },
              quantity: 1,
            },
          ],

          // ✅ ADD THIS BLOCK
          metadata: {
            bookingId: bookingId,
            paymentType: "outstanding",
          },

          success_url: `${env.PUBLIC_SITE_URL}/index.html?outstanding=paid&bookingId=${bookingId}`,
          cancel_url: `${env.PUBLIC_SITE_URL}/booking-cancelled?bookingId=${bookingId}`,
        });

        return withCors(json({ url: session.url }), corsHeaders);
      }

      /* ===============================
     CREATE / FIND CUSTOMER (FIXED SAFE)
  ================================ */

      if (url.pathname === "/api/customers" && request.method === "POST") {
        let body;

        try {
          body = await request.json();
          console.log("📥 CUSTOMER BODY:", body);
        } catch (err) {
          return withCors(json({ error: "Invalid JSON" }, 400), corsHeaders);
        }

        const name = body.full_name?.trim();
        const email = body.email?.trim().toLowerCase() || null;
        const mobile = body.mobile?.trim() || null;

        if (!name) {
          return withCors(json({ error: "Name required" }, 400), corsHeaders);
        }

        if (!email && !mobile) {
          return withCors(
            json({ error: "Email or mobile required" }, 400),
            corsHeaders,
          );
        }

        try {
          /* ===============================
             FIND EXISTING FIRST
          =============================== */

          const existing = await findCustomerByEmailOrMobile(
            env,
            email,
            mobile,
          );

          if (existing) {
            console.log("👤 EXISTING CUSTOMER:", existing.id);

            return withCors(
              json({
                ok: true,
                mode: "existing",
                customer: existing,
              }),
              corsHeaders,
            );
          }

          /* ===============================
             CREATE NEW CUSTOMER
          =============================== */

          const id = "cus_" + crypto.randomUUID();
          const now = new Date().toISOString();

          await env.DB.prepare(
            `
      INSERT INTO customers (
        id,
        full_name,
        email,
        mobile,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
          )
            .bind(
              id,
              name,
              email, // ✅ NULL safe
              mobile, // ✅ NULL safe
              now,
              now,
            )
            .run();

          console.log("✅ CUSTOMER CREATED:", id);

          const customer = await env.DB.prepare(
            "SELECT * FROM customers WHERE id = ?",
          )
            .bind(id)
            .first();

          return withCors(
            json({
              ok: true,
              mode: "created",
              customer,
            }),
            corsHeaders,
          );
        } catch (err) {
          console.error("❌ CUSTOMER CREATE ERROR:", err);

          return withCors(
            json(
              {
                error: "Customer creation failed",
                detail: err.message,
              },
              500,
            ),
            corsHeaders,
          );
        }
      }

      /* ===============================
         CUSTOMER LOOKUP (SAFE)
      ================================ */

      if (
        request.method === "GET" &&
        url.pathname === "/api/customers/lookup"
      ) {
        try {
          const email = url.searchParams.get("email")?.trim().toLowerCase();
          const mobile = url.searchParams.get("mobile")?.trim();

          if (!email && !mobile) {
            return withCors(json({ found: false }), corsHeaders);
          }

          const customer = await findCustomerByEmailOrMobile(
            env,
            email,
            mobile,
          );

          if (!customer) {
            return withCors(json({ found: false }), corsHeaders);
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
                last_hire_at: customer.last_hire_at,
              },
            }),
            corsHeaders,
          );
        } catch (err) {
          console.error("❌ CUSTOMER LOOKUP ERROR:", err);

          return withCors(json({ found: false }), corsHeaders);
        }
      }

      /* ===============================
         CUSTOMER BOOKING HISTORY (SAFE)
      ================================ */

      if (
        request.method === "GET" &&
        url.pathname === "/api/customers/bookings"
      ) {
        try {
          const customerId = url.searchParams.get("customer_id");

          if (!customerId) {
            return withCors(json({ bookings: [] }), corsHeaders);
          }

          const result = await env.DB.prepare(
            `
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
    `,
          )
            .bind(customerId)
            .all();

          return withCors(
            json({
              bookings: result.results || [],
            }),
            corsHeaders,
          );
        } catch (err) {
          console.error("❌ CUSTOMER BOOKINGS ERROR:", err);

          return withCors(json({ bookings: [] }), corsHeaders);
        }
      }

      /* ===============================
         FORM SUBMIT (NEW)
      ================================ */

      if (request.method === "POST" && url.pathname === "/api/form-submit") {
        try {
          const response = await handleFormSubmit(request, env);
          return withCors(response, corsHeaders);
        } catch (err) {
          console.error("❌ FORM ROUTE CRASH:", err);

          return withCors(json({ error: "Server error" }, 500), corsHeaders);
        }
      }

      if (request.method === "GET" && url.pathname === "/api/admin/form") {
        const response = await handleAdminFormView(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
   RESEND EMAIL (ADMIN)
=============================== */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/resend-email"
      ) {
        const response = await handleResendEmail(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
   DVLA VERIFY TOGGLE (NEW)
=============================== */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/dvla-verify"
      ) {
        try {
          const { bookingId, verified } = await request.json();

          if (!bookingId) {
            return withCors(
              json({ error: "Missing bookingId" }, 400),
              corsHeaders,
            );
          }

          const value = verified ? 1 : 0;
          const now = new Date().toISOString();

          /* ===============================
       UPDATE D1
    =============================== */

          await env.DB.prepare(
            `
      UPDATE bookings
      SET dvla_verified = ?, updated_at = ?
      WHERE id = ?
    `,
          )
            .bind(value, now, bookingId)
            .run();

          /* ===============================
       UPDATE KV (CRITICAL)
    =============================== */

          const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

          for (const key of list.keys) {
            const raw = await env.BOOKINGS_KV.get(key.name);
            if (!raw) continue;

            let bookings;

            try {
              bookings = JSON.parse(raw);
            } catch {
              continue;
            }

            if (!Array.isArray(bookings)) continue;

            let updated = false;

            const nextBookings = bookings.map((b) => {
              if (String(b.id) !== String(bookingId)) return b;

              updated = true;

              return {
                ...b,
                dvlaVerified: !!verified,
                updatedAt: now,
              };
            });

            if (updated) {
              await env.BOOKINGS_KV.put(key.name, JSON.stringify(nextBookings));
              console.log("✅ DVLA updated in KV:", bookingId, value);
              break;
            }
          }

          console.log("✅ DVLA updated:", bookingId, value);

          return withCors(json({ ok: true }), corsHeaders);
        } catch (err) {
          console.error("❌ DVLA VERIFY ERROR:", err);

          return withCors(
            json({ error: "Failed to update DVLA status" }, 500),
            corsHeaders,
          );
        }
      }

      /* ===============================
         FALLBACK
      ================================ */

      return withCors(json({ error: "Not found" }, 404), corsHeaders);
    } catch (error) {
      console.error("❌ FETCH ERROR:", error);

      return withCors(
        json(
          {
            error: "Server error",
            detail: error?.message || "Unknown error",
          },
          500,
        ),
        corsHeaders,
      );
    }
  },

  /* ===============================
     CRON JOB — RESERVATION CLEANUP
  ================================ */

  async scheduled(event, env, ctx) {
    console.log("🧹 Running scheduled jobs");

    ctx.waitUntil(cleanupExpiredReservations(env));

    // 🔥 NEW
    ctx.waitUntil(processReminders(env));
  },
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
    minDuration: 1,
  },
  {
    code: "HALFDAY15",
    type: "fixed",
    value: 15,
    expires: "2026-12-31",
    vehicles: ["v35-1", "v35-2", "v35-3"],
    minDuration: 0.5,
  },
];

async function handlePricingQuote(request) {
  const payload = await request.json();

  const {
    vehicleId,
    durationDays,
    pickupDate,
    pickupTime,
    discountCode,
    extras = {},
  } = payload;

  if (!vehicleId || !durationDays || !pickupDate || !pickupTime) {
    return json({ error: "Missing required pricing fields" }, 400);
  }

  const baseCost = calculateServerBaseCost(vehicleId, durationDays, pickupDate);

  const discount = resolveDiscount({
    code: discountCode,
    vehicleId,
    durationDays,
    baseCost,
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

  const discountedTotal = Math.max(0, baseCost - discountAmount + extrasTotal);
  return json({
    baseCost,
    discountAmount,
    extrasTotal,
    total: discountedTotal,
  });
}

/* ===============================
   VEHICLE PRICING ENGINE
================================ */

function calculateServerBaseCost(vehicleId, durationDays, pickupDate) {
  const duration = Number(durationDays);
  const date = new Date(pickupDate);
  const day = date.getDay();

  const isWeekend = day === 0 || day === 6;

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
      7: 700,
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
      7: 1225,
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
    (d) => d.code.toUpperCase() === code.toUpperCase(),
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
    discountAmount: Number(discountAmount.toFixed(2)),
  };
}

/* ===============================
   STRIPE CHECKOUT SESSION
================================ */

async function handleCreateCheckoutSession(request, env) {
  const booking = await request.json();

  const customerNotes = String(booking.customerNotes || "").slice(0, 500);

  const vehicleName =
    booking.vehicleName || booking.vehicleSnapshot?.name || "Horsebox";

  if (!booking.vehicleId) {
    return json({ error: "Invalid booking data" }, 400);
  }

  /* ===============================
     🔥 CLEAN CUSTOMER NAME
  =============================== */

  let cleanCustomerName = (booking.customerName || "").trim();

  if (
    !cleanCustomerName ||
    cleanCustomerName.toLowerCase() === "test" ||
    cleanCustomerName.length < 2
  ) {
    console.warn("⚠️ Invalid customer name replaced:", cleanCustomerName);
    cleanCustomerName = "Customer";
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
    booking.pickupDate,
  );

  const discount = resolveDiscount({
    code: booking.discountCode,
    vehicleId: booking.vehicleId,
    durationDays,
    baseCost,
  });

  if (discount.error) {
    return json({ error: discount.error }, 400);
  }

  const discountAmount = discount.discountAmount || 0;

  /* ===============================
     🔥 EXTRAS
  =============================== */

  const extras = booking.extras || {};

  const dartfordCount = Number(extras.dartford || 0);
  const dartfordTotal = dartfordCount * 4.2;

  const earlyPickup = extras.earlyPickup ? 1 : 0;
  const earlyPickupTotal = earlyPickup ? 20 : 0;

  const extrasTotal = dartfordTotal + earlyPickupTotal;

  /* ===============================
     FINAL TOTAL
  =============================== */

  const totalHire = Math.max(0, baseCost - discountAmount + extrasTotal);

  function getExpectedConfirmationFee(vehicleId) {
    const id = String(vehicleId || "").trim();
    if (id.startsWith("v35")) return 75;
    if (id.startsWith("v75")) return 100;
    return 75;
  }

  const confirmationFee = getExpectedConfirmationFee(booking.vehicleId);
  const outstandingAmount = Math.max(0, totalHire - confirmationFee);

  /* ===============================
     RESERVATION LOGIC (UNCHANGED)
  =============================== */

  let dropoffDate;

  if (durationDays === 0.5) {
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

  const pickupMonth = booking.pickupDate.slice(0, 7);
  const existingMonth = await env.BOOKINGS_KV.get(`bookings:${pickupMonth}`);

  if (existingMonth) {
    let confirmedBookings = [];

    try {
      confirmedBookings = JSON.parse(existingMonth);
      if (!Array.isArray(confirmedBookings)) confirmedBookings = [];
    } catch {
      confirmedBookings = [];
    }

    for (const confirmed of confirmedBookings) {
      if (confirmed.vehicleId !== booking.vehicleId) continue;

      const confirmedDates = getDatesBetween(
        new Date(confirmed.pickupAt),
        new Date(confirmed.dropoffAt),
      );

      const confirmedSlot = getConfirmedSlot(confirmed);

      for (const d of confirmedDates) {
        if (
          reservedDates.includes(d) &&
          slotsConflict(requestedSlot, confirmedSlot)
        ) {
          return json(
            {
              error: "Vehicle already booked for selected dates.",
            },
            409,
          );
        }
      }
    }
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
    apiVersion: "2024-06-20",
  });

  // 🔥 CRITICAL FIX — GENERATE BOOKING ID HERE
  const bookingId = "book_" + crypto.randomUUID();

  let session;

  try {
    session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      success_url: `${siteBase}/index.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteBase}/index.html?checkout=cancelled`,

      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: {
              name: `Horsebox booking — ${vehicleName}`,
            },
            unit_amount: Math.round(confirmationFee * 100),
          },
          quantity: 1,
        },
      ],

      metadata: {
        bookingId: bookingId, // ✅ FIXED

        vehicleId: booking.vehicleId,
        vehicleName: vehicleName,

        pickupDate: booking.pickupDate,
        pickupTime,
        durationDays: String(durationDays),

        customerName: cleanCustomerName,
        customerEmail: (booking.customerEmail || "").slice(0, 100),
        customerMobile: (booking.customerMobile || "").slice(0, 30),
        customerNotes,

        discountCode: booking.discountCode || "",

        baseCost: String(baseCost),
        discountAmount: String(discountAmount),

        dartfordTotal: String(dartfordTotal),
        earlyPickupTotal: String(earlyPickupTotal),
        extrasTotal: String(extrasTotal),

        extrasJson: JSON.stringify(extras || {}),

        totalHire: String(totalHire),
        confirmationFee: String(confirmationFee),
        outstandingAmount: String(outstandingAmount),
      },
    });
  } catch (err) {
    return json(
      {
        error: "Stripe session creation failed",
        detail: err?.message || "Unknown Stripe error",
      },
      500,
    );
  }

  if (!session?.url) {
    return json({ error: "Stripe session invalid" }, 500);
  }

  return json({ url: session.url });
}

function getDatesBetween(start, end) {
  const dates = [];
  const current = new Date(start);

  current.setHours(0, 0, 0, 0);

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));

    current.setDate(current.getDate() + 1);
  }

  return dates;
}

async function findBookingById(env, bookingId) {
  const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

  for (const key of list.keys) {
    const data = await env.BOOKINGS_KV.get(key.name);
    if (!data) continue;

    try {
      const parsed = JSON.parse(data);

      if (Array.isArray(parsed)) {
        const found = parsed.find((b) => String(b.id) === String(bookingId));
        if (found) return found;
      }
    } catch {}
  }

  return null;
}

/* ===============================
   STRIPE WEBHOOK
================================ */

async function handleStripeWebhook(request, env) {
  const SITE_BASE =
    env.PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://kvwebservices.co.uk/equinetransportuk";

  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
  });

  let event;

  console.log("📩 STRIPE EVENT TYPE:", event?.type);

  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      sig,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.log("❌ Webhook verification failed:", err.message);
    return new Response(
      JSON.stringify({ error: "Webhook signature verification failed" }),
      { status: 400 },
    );
  }

  const eventId = event.id;

  const alreadyProcessed = await env.BOOKINGS_KV.get(eventId);
  if (alreadyProcessed) {
    console.log("⚠️ Webhook already processed:", eventId);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  /* ===============================
     DEPOSIT PAYMENT INTENT (CRITICAL FIX)
  ================================ */

  if (event.type === "payment_intent.succeeded") {
    console.log("💳 PAYMENT INTENT EVENT");

    const paymentIntent = event.data.object;

    const bookingId = paymentIntent.metadata?.bookingId;
    const paymentType = paymentIntent.metadata?.paymentType;

    if (!bookingId || paymentType !== "deposit") {
      console.log("⚠️ Not a deposit payment");
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    console.log("🔥 DEPOSIT CONFIRMED:", bookingId);

    // ✅ IMPORTANT: check status
    if (paymentIntent.status !== "requires_capture") {
      console.log("⚠️ Not a HOLD payment:", paymentIntent.status);
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    try {
      // ✅ UPDATE DB
      await env.DB.prepare(
        `
      UPDATE bookings
      SET deposit_paid = 1,
          updated_at = ?
      WHERE id = ?
    `,
      )
        .bind(new Date().toISOString(), bookingId)
        .run();

      console.log("✅ Deposit updated in DB");
    } catch (err) {
      console.error("❌ DB update failed:", err);
    }

    // ✅ UPDATE KV (same as before)
    const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

    for (const key of list.keys) {
      const data = await env.BOOKINGS_KV.get(key.name);
      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) continue;

        let updated = false;

        for (const b of parsed) {
          if (String(b.id) === String(bookingId)) {
            b.depositPaid = true;
            b.updatedAt = new Date().toISOString();
            updated = true;
          }
        }

        if (updated) {
          await env.BOOKINGS_KV.put(key.name, JSON.stringify(parsed));
          console.log("✅ Deposit updated in KV");
          break;
        }
      } catch {}
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  /* ===============================
   DEPOSIT HOLD (FINAL FINAL FIX)
================================ */

  if (event.type === "payment_intent.amount_capturable_updated") {
    console.log("💳 DEPOSIT HOLD EVENT");

    const paymentIntent = event.data.object;

    const bookingId = paymentIntent.metadata?.bookingId;
    const paymentType = paymentIntent.metadata?.paymentType;

    console.log("🧪 METADATA:", paymentIntent.metadata);

    if (!bookingId || paymentType !== "deposit") {
      console.log("⚠️ Not a deposit");
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    console.log("🔥 DEPOSIT HOLD CONFIRMED:", bookingId);

    try {
      // ✅ UPDATE DB
      await env.DB.prepare(
        `
      UPDATE bookings
      SET deposit_paid = 1,
          updated_at = ?
      WHERE id = ?
    `,
      )
        .bind(new Date().toISOString(), bookingId)
        .run();

      console.log("✅ Deposit marked in DB");
    } catch (err) {
      console.error("❌ DB update failed:", err);
    }

    // ✅ UPDATE KV
    const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

    for (const key of list.keys) {
      const data = await env.BOOKINGS_KV.get(key.name);
      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) continue;

        let updated = false;

        for (const b of parsed) {
          if (String(b.id) === String(bookingId)) {
            b.depositPaid = true;
            b.updatedAt = new Date().toISOString();
            updated = true;
          }
        }

        if (updated) {
          await env.BOOKINGS_KV.put(key.name, JSON.stringify(parsed));
          console.log("✅ Deposit updated in KV");
          break;
        }
      } catch {}
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  if (event.type === "checkout.session.completed") {
    console.log("🔥 CHECKOUT SESSION COMPLETED EVENT");

    try {
      console.log("🔥 ENTERING TRY BLOCK");
      console.log("🔥 WEBHOOK START");

      const session = event.data.object;

      // 🔥 ADD THIS BLOCK HERE (EXACT SPOT)
      if (!session.metadata?.bookingId) {
        console.log("❌ Missing bookingId in metadata");

        await env.BOOKINGS_KV.put(eventId, "processed");

        return new Response(
          JSON.stringify({ error: "Missing bookingId in metadata" }),
          { status: 400 },
        );
      }

      const paymentType = session.metadata?.paymentType || "";
      const paymentBookingId = session.metadata?.bookingId || "";

      console.log("👉 session received");

      /* ===============================
         PAYMENT-ONLY SESSIONS FIRST
      =============================== */

      if (paymentType && paymentBookingId) {
        console.log("💳 Payment detected:", paymentType, paymentBookingId);

        const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

        for (const key of list.keys) {
          const data = await env.BOOKINGS_KV.get(key.name);
          if (!data) continue;

          let parsed;

          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          if (!Array.isArray(parsed)) continue;

          let updated = false;

          for (const b of parsed) {
            if (String(b.id) === String(paymentBookingId)) {
              if (paymentType === "deposit") {
                b.depositPaid = true;

                // ✅ ALSO SAVE TO DATABASE (CRITICAL FIX)
                try {
                  await env.DB.prepare(
                    `
      UPDATE bookings
      SET deposit_paid = 1,
          updated_at = ?
      WHERE id = ?
    `,
                  )
                    .bind(new Date().toISOString(), paymentBookingId)
                    .run();

                  console.log(
                    "✅ Deposit marked as paid in DB:",
                    paymentBookingId,
                  );
                } catch (err) {
                  console.error("❌ Failed to update deposit in DB:", err);
                }
              }

              if (paymentType === "outstanding") {
                b.outstandingPaid = true;
                b.outstandingAmount = 0;
                b.outstanding = 0;
              }

              b.updatedAt = new Date().toISOString();
              updated = true;
            }
          }

          if (updated) {
            await env.BOOKINGS_KV.put(key.name, JSON.stringify(parsed));
            console.log("✅ Payment status updated in KV");
            break;
          }
        }

        await env.BOOKINGS_KV.put(eventId, "processed");

        return new Response(JSON.stringify({ received: true }), {
          status: 200,
        });
      }

      if (!session?.metadata?.vehicleId) {
        console.log("⚠️ Missing vehicleId");
        await env.BOOKINGS_KV.put(eventId, "processed");
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
        });
      }

      /* ===============================
         SAFE NUMBER PARSING
      =============================== */

      const totalHire = Number(session.metadata?.totalHire || 0);
      const confirmationFee = Number(session.metadata?.confirmationFee || 0);
      const outstandingAmount = Number(
        session.metadata?.outstandingAmount || 0,
      );
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
         PICKUP
      =============================== */

      let pickupAt;
      let pickupAtDate = londonDateTimeToUtc(rawPickupDate, pickupTime);
      pickupAt = pickupAtDate.toISOString();

      /* ===============================
         DROPOFF
      =============================== */

      let dropoffAt;
      let dropoffAtDate;

      if (durationDays === 0.5) {
        const dropoffTime = getHalfDayDropoffTime(
          pickupTime,
          session.metadata.vehicleId,
        );

        dropoffAtDate = londonDateTimeToUtc(rawPickupDate, dropoffTime);
      } else {
        const dropoffDate = new Date(rawPickupDate);
        dropoffDate.setDate(dropoffDate.getDate() + durationDays - 1);

        const dropoffDateStr = dropoffDate.toISOString().slice(0, 10);
        dropoffAtDate = londonDateTimeToUtc(dropoffDateStr, "19:00");
      }

      dropoffAt = dropoffAtDate.toISOString();

      /* ===============================
         SAFETY CHECK
      =============================== */

      if (isNaN(pickupAtDate.getTime()) || isNaN(dropoffAtDate.getTime())) {
        console.warn("⚠️ Invalid date detected — applying fallback", {
          rawPickupDate,
          pickupTime,
          durationDays,
        });

        const now = new Date();

        pickupAtDate = now;

        dropoffAtDate = new Date(now);
        dropoffAtDate.setHours(now.getHours() + 4);

        pickupAt = pickupAtDate.toISOString();
        dropoffAt = dropoffAtDate.toISOString();
      }

      console.log("📅 WEBHOOK TIMES:", {
        pickupAt,
        dropoffAt,
      });

      console.log("🔥 FINAL TIMES CHECK:", {
        pickupAt,
        dropoffAt,
        durationDays,
        pickupTime,
      });

      /* ===============================
         CUSTOMER NAME FIX
      =============================== */

      function cleanCustomerName(name) {
        if (!name) return null;

        let n = String(name).trim();

        const bad = ["test", "customer", "test customer"];
        if (bad.includes(n.toLowerCase())) return null;

        n = n.replace(/\s+/g, " ");

        n = n
          .toLowerCase()
          .split(" ")
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(" ");

        return n;
      }

      const finalCustomerName =
        cleanCustomerName(session.metadata.customerName) ||
        cleanCustomerName(session.customer_details?.name) ||
        null;

      if (!finalCustomerName) {
        console.warn("⚠️ No valid customer name found");
      }

      console.log("🧪 NAME DEBUG:", {
        metadataName: session.metadata.customerName,
        stripeName: session.customer_details?.name,
      });

      /* ===============================
         BOOKING OBJECT
      =============================== */

      const booking = {
        id: session.metadata.bookingId,

        vehicleId: session.metadata.vehicleId,

        vehicleSnapshot: {
          id: session.metadata.vehicleId,
          name: session.metadata.vehicleName || "",
          type: session.metadata.vehicleId.startsWith("v35")
            ? "3.5 tonne"
            : "7.5 tonne",
        },

        pickupAt,
        dropoffAt,

        pickupAtLocal: toLondonLocalISOString(new Date(pickupAt)),
        dropoffAtLocal: toLondonLocalISOString(new Date(dropoffAt)),

        durationDays,
        pickupTime,

        customerName: finalCustomerName || "Customer",
        customerEmail:
          session.metadata.customerEmail ||
          session.customer_details?.email ||
          "",
        customerMobile: session.metadata.customerMobile || "",
        customerNotes,

        priceBase: baseCost,
        priceExtras: extrasTotal,
        priceTotal: totalHire,
        paidNow: confirmationFee,
        outstanding: outstandingAmount,

        baseCost,
        discountAmount,

        dartfordTotal,
        earlyPickupTotal,
        extrasTotal,
        extras,

        hireTotal: totalHire,
        confirmationFee,
        outstandingAmount,

        depositAmount: 200,
        depositPaid: false,
        outstandingPaid: false,
        status: "confirmed",
        createdAt: new Date().toISOString(),
      };

      console.log("✅ BOOKING BUILT");

      /* ===============================
   ⏰ SCHEDULE REMINDER (NEW)
=============================== */

      try {
        const pickupDate = new Date(booking.pickupAt);

        const reminderDate = new Date(pickupDate);
        reminderDate.setDate(reminderDate.getDate() - 1);
        reminderDate.setHours(16, 0, 0, 0); // 4PM UK time

        const reminderKey = `reminder:${booking.id}`;

        await env.BOOKINGS_KV.put(
          reminderKey,
          JSON.stringify({
            bookingId: booking.id,
            sendAt: reminderDate.toISOString(),
          }),
          {
            expirationTtl: 60 * 60 * 24 * 7, // 7 days safety
          },
        );

        console.log(
          "⏰ Reminder scheduled:",
          reminderKey,
          reminderDate.toISOString(),
        );
      } catch (err) {
        console.warn("⚠️ Failed to schedule reminder:", err);
      }

      if (!finalCustomerName) {
        console.warn("❌ Booking created without proper name:", booking.id);
      }

      console.log("📧 EMAIL SOURCE:", {
        metadata: session.metadata.customerEmail,
        stripe: session.customer_details?.email,
        final: booking.customerEmail,
      });

      /* ===============================
         SAVE CUSTOMER (FIRST)
      =============================== */

      let customer = null;

      try {
        customer = await findCustomerByEmailOrMobile(
          env,
          booking.customerEmail,
          booking.customerMobile,
        );

        /* ===============================
           UPDATE NAME IF CHANGED
        =============================== */

        if (
          customer &&
          finalCustomerName &&
          customer.full_name !== finalCustomerName
        ) {
          console.log(
            "✏️ Updating customer name:",
            customer.full_name,
            "→",
            booking.customerName,
          );

          await env.DB.prepare(
            `
            UPDATE customers
            SET full_name = ?, updated_at = ?
            WHERE id = ?
          `,
          )
            .bind(finalCustomerName, new Date().toISOString(), customer.id)
            .run();

          customer.full_name = booking.customerName;
        }

        if (!customer) {
          const customerId = "cus_" + crypto.randomUUID();
          const now = new Date().toISOString();

          await env.DB.prepare(
            `
            INSERT INTO customers (
              id, full_name, email, mobile, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          )
            .bind(
              customerId,
              finalCustomerName || "Customer",
              booking.customerEmail,
              booking.customerMobile,
              now,
              now,
            )
            .run();

          customer = { id: customerId };
        }
      } catch (err) {
        console.log("⚠️ CUSTOMER ERROR:", err);
        customer = { id: null };
      }

      booking.customerId = customer?.id || null;

      /* ===============================
         SAVE BOOKING (DB) FIRST
      =============================== */

      console.log("💾 SAVE BOOKING DB");

      try {
        await env.DB.prepare(
          `
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
        `,
        )
          .bind(
            booking.id,
            booking.customerId,
            booking.vehicleId,
            booking.pickupAt,
            booking.dropoffAt,
            booking.durationDays,
            booking.hireTotal,
            booking.confirmationFee,
            booking.status,
            booking.createdAt,
            booking.createdAt,
          )
          .run();

        console.log("✅ DB SAVED");
      } catch (err) {
        console.log("💥 DB ERROR:", err);
      }

      /* ===============================
         UPDATE CUSTOMER STATS
      =============================== */

      try {
        if (booking.customerId) {
          await env.DB.prepare(
            `
            UPDATE customers
            SET
              hire_count = COALESCE(hire_count, 0) + 1,
              last_hire_at = ?,
              updated_at = ?
            WHERE id = ?
          `,
          )
            .bind(
              booking.pickupAt,
              new Date().toISOString(),
              booking.customerId,
            )
            .run();

          console.log("📈 Customer stats updated");
        }
      } catch (err) {
        console.error("❌ Customer update failed:", err);
      }

      /* ===============================
         FORM TYPE LOGIC (PRODUCTION SAFE)
      =============================== */

      let requiredFormType = "long";

      try {
        if (booking.customerId) {
          const result = await env.DB.prepare(
            `
            SELECT pickup_at
            FROM bookings
            WHERE customer_id = ?
            ORDER BY pickup_at DESC
            LIMIT 2
          `,
          )
            .bind(booking.customerId)
            .all();

          const rows = result.results || [];
          const previousBooking = rows[1];

          if (previousBooking?.pickup_at) {
            const previousPickup = new Date(previousBooking.pickup_at);
            const currentPickup = new Date(booking.pickupAt);

            const diffDays =
              (currentPickup.getTime() - previousPickup.getTime()) /
              (1000 * 60 * 60 * 24);

            console.log("🧪 FORM CHECK:", {
              previousPickup: previousBooking.pickup_at,
              currentPickup: booking.pickupAt,
              diffDays,
            });

            if (diffDays <= 90) {
              requiredFormType = "short";
            }
          }
        }
      } catch (err) {
        console.warn("Form type check failed:", err);
      }

      /* ===============================
         FORM LINK BUILD
      =============================== */

      const bookingId = booking.id;

      const formBase =
        requiredFormType === "short"
          ? `${SITE_BASE}/forms/short-form.html`
          : `${SITE_BASE}/forms/long-form.html`;

      const formLink = `${formBase}?bookingId=${encodeURIComponent(bookingId)}&vehicleName=${encodeURIComponent(booking.vehicleSnapshot?.name || "")}`;

      booking.requiredFormType = requiredFormType;
      booking.requiredFormLink = formLink;

      console.log("🧪 FORM DEBUG:", {
        type: booking.requiredFormType,
        link: booking.requiredFormLink,
        customerId: booking.customerId,
      });

      /* ===============================
         PAYMENT LINKS
      =============================== */

      const depositLink = `${SITE_BASE}/pay-deposit.html?bookingId=${encodeURIComponent(bookingId)}`;

      const outstandingLink = `${SITE_BASE}/pay-outstanding.html?bookingId=${encodeURIComponent(bookingId)}`;

      booking.depositLink = depositLink;
      booking.outstandingLink = outstandingLink;

      console.log("🧪 PAYMENT LINKS:", depositLink, outstandingLink);

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
        JSON.stringify(existingMonthBookings),
      );

      console.log("✅ KV SAVED");

      /* ===============================
         DIRECT SESSION LOOKUP
      =============================== */

      const sessionKey = `session:${session.id}`;

      await env.BOOKINGS_KV.put(sessionKey, JSON.stringify(booking), {
        expirationTtl: 86400,
      });

      console.log("⚡ Session mapping saved:", sessionKey);

      /* ===============================
         EMAIL DEDUPE CHECK
      =============================== */

      const emailKey = `email_sent:${booking.id}`;
      const alreadySent = await env.BOOKINGS_KV.get(emailKey);

      if (alreadySent) {
        console.log("⚠️ Email already sent, skipping");
      } else {
        try {
          const vehicleName = booking.vehicleSnapshot?.name || "Horsebox Hire";

          const extras = booking.extras || {};
          const dartfordCount = Number(extras.dartford || 0);
          const earlyPickupEnabled = !!extras.earlyPickup;

          const extrasLines = [];

          if (earlyPickupEnabled) {
            extrasLines.push(
              `Early pickup: £${Number(booking.earlyPickupTotal || 0).toFixed(2)}`,
            );
          }

          if (dartfordCount > 0) {
            extrasLines.push(
              `Dartford crossings: ${dartfordCount} (£${Number(booking.dartfordTotal || 0).toFixed(2)})`,
            );
          }

          const extrasHtml = extrasLines.length
            ? `
              <hr style="margin:24px 0;">
              <h3>Extras</h3>
              <p>${extrasLines.join("<br>")}</p>
            `
            : "";

          const formLabel =
            String(booking.requiredFormType || "long").toLowerCase() === "short"
              ? "SHORT Form Required"
              : "LONG Form Required";

          const outstandingAmountNumber = Number(
            booking.outstandingAmount || 0,
          );
          const showOutstandingSection = outstandingAmountNumber > 0;

          const outstandingHtml = showOutstandingSection
            ? `
              <hr style="margin:24px 0;">

              <h3>Outstanding Balance</h3>

              <p>Please complete payment before collection.</p>

              <p>
                <a href="${escapeHtml(booking.outstandingLink || "")}"
                   style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">
                  Pay Outstanding
                </a>
              </p>

              <p style="font-size:13px;color:#555;">
                ${escapeHtml(booking.outstandingLink || "")}
              </p>
            `
            : `
              <hr style="margin:24px 0;">
              <h3>Outstanding Balance</h3>
              <p>No outstanding balance remains on this booking.</p>
            `;

          const emailHtml = buildModernEmail({
            title: "Equine Transport UK – Booking Confirmation",
            customerName: booking.customerName,
            booking: {
              id: booking.id,
              vehicle: booking.vehicleSnapshot?.name || "Horsebox Hire",
              from: booking.pickupAtLocal,
              to: booking.dropoffAtLocal,
              email: booking.customerEmail,
              mobile: booking.customerMobile,
              paid: booking.confirmationFee,
              outstanding: booking.outstandingAmount,
              total: booking.hireTotal,
              formType: booking.requiredFormType,

              // ✅ ADD THIS
              depositPaid: booking.depositPaid,
            },
            formLink: booking.requiredFormLink,
            depositLink: booking.depositLink,
            outstandingLink: booking.outstandingLink,
          });

          if (booking.customerEmail) {
            await sendBookingEmail(env, {
              to: booking.customerEmail,
              subject: "Your Equine Transport UK booking is confirmed",
              html: emailHtml,
            });

            console.log("📧 BOOKING EMAIL SENT");

            await env.BOOKINGS_KV.put(emailKey, "1", {
              expirationTtl: 86400,
            });
          } else {
            console.log("⚠️ No customer email — skipping email send");
          }
        } catch (emailErr) {
          console.log("❌ EMAIL SEND FAILED:", emailErr.message || emailErr);
        }
      }
    } catch (err) {
      console.log("💥 WEBHOOK CRASH:", err.message, err.stack);

      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
      });
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
    const monthKey = current.toISOString().slice(0, 7);
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
   🔐 ENRICH WITH DVLA STATUS (NEW)
================================ */

  const ids = bookings.map((b) => b.id);

  let dvlaMap = {};

  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");

    const result = await env.DB.prepare(
      `
    SELECT id, dvla_verified
    FROM bookings
    WHERE id IN (${placeholders})
  `,
    )
      .bind(...ids)
      .all();

    for (const row of result.results || []) {
      dvlaMap[row.id] = row.dvla_verified === 1;
    }
  }

  /* ===============================
     LOAD ACTIVE RESERVATIONS
  ================================ */

  const reservations = [];

  try {
    const list = await env.BOOKINGS_KV.list({
      prefix: "reservation:",
    });

    for (const key of list.keys) {
      const parts = key.name.split(":");

      if (parts.length >= 3) {
        reservations.push({
          vehicleId: parts[1],
          date: parts[2],
          slot: parts[3] || "full",
        });
      }
    }
  } catch (err) {
    console.log("⚠️ Reservation scan failed:", err);
  }

  const transformedBookings = bookings.map((booking) => {
    return {
      ...booking,

      extrasTotal: Number(booking.extrasTotal || 0),
      extras: booking.extras || null,

      // ✅ ADD THIS
      dvlaVerified:
        booking.dvla_verified === 1 || booking.dvlaVerified === true,
    };
  });

  return json({
    bookings: transformedBookings,
    reservations,
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
        booking,
      });
    } catch (err) {
      console.log("⚠️ Session cache parse error:", err);
    }
  }

  /* ===============================
     HELPERS
  =============================== */

  async function getRequiredFormType(env, customerId, pickupAt) {
    if (!customerId) return "long";

    const rows = await env.DB.prepare(
      `
    SELECT pickup_at
    FROM bookings
    WHERE customer_id = ?
    ORDER BY pickup_at DESC
    LIMIT 2
  `,
    )
      .bind(customerId)
      .all();

    const bookings = rows?.results || [];

    // first booking ever
    if (bookings.length < 2) return "long";

    const previous = new Date(bookings[1].pickup_at);
    const current = new Date(pickupAt);

    const diffDays = (current - previous) / (1000 * 60 * 60 * 24);

    return diffDays <= 90 ? "short" : "long";
  }

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
    apiVersion: "2024-06-20",
  });

  let session;

  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.log("❌ Stripe lookup failed:", err);
    return json({ error: "Stripe lookup failed" }, 500);
  }

  const bookingId = session?.metadata?.bookingId || session?.id;

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

      const booking = bookings.find((b) => String(b.id) === String(bookingId));

      if (booking) {
        console.log("✅ Booking found in KV:", bookingId);

        return json({
          found: true,
          booking: {
            ...booking,
            pickupAt: cleanIso(booking.pickupAt),
            dropoffAt: cleanIso(booking.dropoffAt),
            extras: booking.extras || {},
          },
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
      customer_details: session.customer_details || null,
    },
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
          new Date(booking.dropoffAt),
        );

        const slot = getSlotFromBooking(booking);

        for (const d of dates) {
          availability.push({
            vehicleId: booking.vehicleId,
            date: d,
            slot,
            status: "booked",
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
      status: "reserved",
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

  const vehicles = ["v35-1", "v35-2", "v35-3", "v75-1", "v75-2"];

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

  const months = [...new Set(requestedDates.map((d) => d.slice(0, 7)))];
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
      (b) => b.vehicleId === vehicleId && b.status !== "cancelled",
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
          new Date(b.dropoffAt),
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
        prefix: `reservation:${vehicleId}:${date}`,
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
            new Date(b.dropoffAt),
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
          prefix: `reservation:${vehicleId}:${requestedDate}`,
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
      availableSlots,
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

  const vehicles = ["v35-1", "v35-2", "v35-3", "v75-1", "v75-2"];

  const days = [];

  const start = new Date(month + "-01");
  const end = new Date(start);

  end.setMonth(end.getMonth() + 1);
  end.setDate(0);

  const current = new Date(start);

  while (current <= end) {
    const date = current.toISOString().slice(0, 10);

    const booked = new Set();
    const reserved = new Set();

    /* ===============================
       CONFIRMED BOOKINGS (FAST INDEX)
    ================================ */

    const checks = vehicles.map((v) =>
      env.BOOKINGS_KV.get(`booking:${v}:${date}`),
    );

    const results = await Promise.all(checks);

    results.forEach((exists, i) => {
      if (exists) booked.add(vehicles[i]);
    });

    /* ===============================
       TEMP RESERVATIONS
    ================================ */

    const reservations = await env.BOOKINGS_KV.list({
      prefix: "reservation:",
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
      vehicles: vehicles.map((v) => ({
        vehicleId: v,
        available: !(booked.has(v) || reserved.has(v)),
      })),
    });

    current.setDate(current.getDate() + 1);
  }

  return json({ days });
}

async function handleBookingsVersion(env) {
  const version = await env.BOOKINGS_KV.get("bookings:version");

  return json({
    version: version || "0",
  });
}

async function handleClearBookings(env) {
  const bookingsList = await env.BOOKINGS_KV.list({ prefix: "bookings:" });
  await Promise.all(
    bookingsList.keys.map((key) => env.BOOKINGS_KV.delete(key.name)),
  );

  const bookingIndexList = await env.BOOKINGS_KV.list({ prefix: "booking:" });
  await Promise.all(
    bookingIndexList.keys.map((key) => env.BOOKINGS_KV.delete(key.name)),
  );

  const reservationsList = await env.BOOKINGS_KV.list({
    prefix: "reservation:",
  });
  await Promise.all(
    reservationsList.keys.map((key) => env.BOOKINGS_KV.delete(key.name)),
  );

  await env.BOOKINGS_KV.delete("bookings:version");

  return json({ success: true });
}

async function findCustomerByEmailOrMobile(env, email, mobile) {
  if (email) {
    const result = await env.DB.prepare(
      "SELECT * FROM customers WHERE email = ? LIMIT 1",
    )
      .bind(email)
      .first();

    if (result) return result;
  }

  if (mobile) {
    const result = await env.DB.prepare(
      "SELECT * FROM customers WHERE mobile = ? LIMIT 1",
    )
      .bind(mobile)
      .first();

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
    headers: JSON_HEADERS,
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
    hour12: false,
  }).formatToParts(guessUtc);

  const get = (type) => londonParts.find((p) => p.type === type)?.value || "";

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
    0,
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
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

/* ===============================
   📧 MODERN EMAIL TEMPLATE
=============================== */

/* ===============================
   📧 MODERN EMAIL TEMPLATE
=============================== */

function buildModernEmail({
  title,
  customerName,
  booking,
  formLink,
  depositLink,
  outstandingLink,
}) {
  const money = (v) => `£${Number(v || 0).toFixed(2)}`;

  const safeTitle = escapeHtml(title || "Equine Transport UK");
  const safeCustomerName = escapeHtml(customerName || "Customer");

  const safeBookingId = escapeHtml(booking?.id || "");
  const safeVehicle = escapeHtml(booking?.vehicle || "Horsebox Hire");
  const safeFrom = escapeHtml(booking?.from || "");
  const safeTo = escapeHtml(booking?.to || "");
  const safeEmail = escapeHtml(booking?.email || "");
  const safeMobile = escapeHtml(booking?.mobile || "");
  const safeFormType =
    String(booking?.formType || "long").toLowerCase() === "short"
      ? "SHORT Form Required"
      : "LONG Form Required";

  const safeFormLink = escapeHtml(formLink || "");
  const safeDepositLink = escapeHtml(depositLink || "");
  const safeOutstandingLink = escapeHtml(outstandingLink || "");

  const paidNow = Number(booking?.paid || 0);

  const outstanding = Number(booking?.outstanding || 0);
  const totalHire = Number(booking?.total || paidNow + outstanding || 0);

  const showOutstanding = outstanding > 0;

  const depositPaid = !!booking?.depositPaid;
  const showDeposit = !depositPaid;

  return `
  <div style="margin:0;padding:0;background:#f3f4f6;">
    <div style="
      max-width:760px;
      margin:0 auto;
      padding:34px 22px 40px;
      font-family:Arial,sans-serif;
      color:#2b2b2b;
      line-height:1.6;
    ">

      <!-- LOGO -->
      <div style="text-align:center;margin:0 0 22px;">
        <img
          src="https://kvwebservices.co.uk/equinetransportuk/images/logo.png"
          alt="Equine Transport UK"
          style="max-width:280px;width:100%;height:auto;"
        >
      </div>

      <!-- TITLE -->
      <h1 style="
        margin:0 0 22px;
        text-align:center;
        color:#1673ea;
        font-size:28px;
        line-height:1.3;
      ">
        ${safeTitle}
      </h1>

      <!-- INTRO -->
      <p style="margin:0 0 16px;font-size:16px;">Dear ${safeCustomerName},</p>

      <p style="margin:0 0 18px;font-size:16px;">
        Thank you for your booking with <strong>Equine Transport UK</strong>.
        Please complete the next steps below for your upcoming hire.
      </p>

      <!-- BOOKING DETAILS CARD -->
      <div style="
        background:#eef4ff;
        border:1px solid #c9dafc;
        border-radius:14px;
        padding:20px 24px;
        margin:0 0 28px;
      ">
        <h2 style="margin:0 0 14px;color:#0f4f9c;font-size:18px;">
          Booking Details
        </h2>

        <ul style="margin:0;padding-left:24px;font-size:16px;">
          <li><strong>Booking reference:</strong> #${safeBookingId}</li>
          <li><strong>Lorry:</strong> ${safeVehicle}</li>
          <li><strong>From:</strong> ${safeFrom}</li>
          <li><strong>To:</strong> ${safeTo}</li>
          ${safeEmail ? `<li><strong>Email:</strong> ${safeEmail}</li>` : ""}
          ${safeMobile ? `<li><strong>Mobile:</strong> ${safeMobile}</li>` : ""}
        </ul>
      </div>

      <!-- PAYMENT SUMMARY -->
      <div style="
        background:#ffffff;
        border:1px solid #e5e7eb;
        border-radius:14px;
        padding:18px 22px;
        margin:0 0 28px;
      ">
        <h2 style="margin:0 0 12px;color:#0f4f9c;font-size:18px;">
          Payment Summary
        </h2>

        <p style="margin:0;font-size:16px;">
          <strong>Total hire:</strong> ${money(totalHire)}<br>
          <strong>Paid now:</strong> ${money(paidNow)}<br>
          <strong>Outstanding:</strong> ${money(outstanding)}
        </p>
      </div>

      <!-- FORM -->
      <h2 style="margin:0 0 8px;color:#1673ea;font-size:22px;">
        ${safeFormType}
      </h2>

      <p style="margin:0 0 10px;font-size:16px;">
        Please complete the required hire form before collection.
      </p>

      <div style="text-align:center;margin:18px 0 14px;">
        <a href="${safeFormLink}"
           style="
             display:inline-block;
             background:#1673ea;
             color:#ffffff;
             text-decoration:none;
             font-weight:700;
             font-size:16px;
             line-height:1;
             padding:16px 28px;
             border-radius:10px;
           ">
          Complete Form
        </a>
      </div>

      <div style="
        margin:20px 0 26px;
        padding:18px 20px;
        background:#f4ecd8;
        border:1px solid #e5b54a;
        border-radius:12px;
        color:#6f4c00;
        font-size:15px;
        line-height:1.7;
      ">
        <strong>Why this matters:</strong>
        This form is required before the hire can proceed. It allows us to confirm your details, licence information and hire readiness.
      </div>

      <p style="margin:0 0 8px;color:#222;font-size:15px;">
        If the button does not work, please use this link:
      </p>
      <p style="margin:0 0 24px;">
        <a href="${safeFormLink}" style="color:#1673ea;word-break:break-all;">
          ${safeFormLink}
        </a>
      </p>

      <!-- DEPOSIT -->
<h2 style="margin:0 0 8px;color:#1673ea;font-size:22px;">
  Deposit Hold
</h2>

${
  !booking?.depositPaid
    ? `
      <p style="margin:0 0 10px;font-size:16px;">
        The required deposit hold amount is: <strong>£200.00</strong>
      </p>

      <div style="text-align:center;margin:18px 0 14px;">
        <a href="${safeDepositLink}"
           style="
             display:inline-block;
             background:#1673ea;
             color:#ffffff;
             text-decoration:none;
             font-weight:700;
             font-size:16px;
             line-height:1;
             padding:16px 28px;
             border-radius:10px;
           ">
          💳 Pay Deposit Securely
        </a>
      </div>

      <div style="
        margin:20px 0 26px;
        padding:18px 20px;
        background:#f4ecd8;
        border:1px solid #e5b54a;
        border-radius:12px;
        color:#6f4c00;
        font-size:15px;
        line-height:1.7;
      ">
        <strong>Important:</strong>
        This is a <strong>pre-authorisation (hold)</strong>, not an immediate payment.
        The funds are reserved on your card and may only be captured if required under the hire agreement.
      </div>

      <p style="margin:0 0 8px;color:#222;font-size:15px;">
        If the button does not work, please use this link:
      </p>
      <p style="margin:0 0 24px;">
        <a href="${safeDepositLink}" style="color:#1673ea;word-break:break-all;">
          ${safeDepositLink}
        </a>
      </p>
    `
    : `
      <div style="
        margin:20px 0 26px;
        padding:18px 20px;
        background:#edf8f0;
        border:1px solid #9ed2ab;
        border-radius:12px;
        color:#215c31;
        font-size:15px;
        line-height:1.7;
      ">
        <strong>Deposit secured:</strong>
        Your £200 deposit has already been authorised. No further action is required.
      </div>
    `
}
      <!-- OUTSTANDING -->
      <h2 style="margin:0 0 8px;color:#1673ea;font-size:22px;">
        Outstanding Balance
      </h2>

      ${
        showOutstanding
          ? `
            <p style="margin:0 0 10px;font-size:16px;">
              Your remaining balance is: <strong>${money(outstanding)}</strong>
            </p>

            <div style="text-align:center;margin:18px 0 14px;">
              <a href="${safeOutstandingLink}"
                 style="
                   display:inline-block;
                   background:#1673ea;
                   color:#ffffff;
                   text-decoration:none;
                   font-weight:700;
                   font-size:16px;
                   line-height:1;
                   padding:16px 28px;
                   border-radius:10px;
                 ">
                Pay Outstanding Balance
              </a>
            </div>

            <div style="
              margin:20px 0 26px;
              padding:18px 20px;
              background:#f4ecd8;
              border:1px solid #e5b54a;
              border-radius:12px;
              color:#6f4c00;
              font-size:15px;
              line-height:1.7;
            ">
              <strong>When to pay:</strong>
              This is the remaining hire balance after your confirmation payment.
              Please complete this payment before collection unless agreed otherwise with us.
            </div>

            <p style="margin:0 0 8px;color:#222;font-size:15px;">
              If the button does not work, please use this link:
            </p>
            <p style="margin:0 0 24px;">
              <a href="${safeOutstandingLink}" style="color:#1673ea;word-break:break-all;">
                ${safeOutstandingLink}
              </a>
            </p>
          `
          : `
            <div style="
              margin:20px 0 26px;
              padding:18px 20px;
              background:#edf8f0;
              border:1px solid #9ed2ab;
              border-radius:12px;
              color:#215c31;
              font-size:15px;
              line-height:1.7;
            ">
              <strong>No balance due:</strong>
              There is no outstanding balance left on this booking.
            </div>
          `
      }

      <!-- SIGN OFF -->
      <p style="margin:26px 0 0;font-size:16px;">With kind regards,</p>

      <p style="margin:8px 0 0;font-size:16px;">
        <strong>Koos & Avril</strong><br>
        <strong>Equine Transport UK</strong>
      </p>

      <!-- FOOTER -->
      <hr style="border:none;border-top:1px solid #d6d6d6;margin:34px 0 20px;">

      <div style="text-align:center;color:#555;font-size:14px;line-height:1.7;">
        <strong>Equine Transport UK</strong><br>
        Upper Broadreed Farm, Stonehurst Lane, Five Ashes, TN20 6LL, East Sussex, GB<br>
        📞 +44 7584 578654<br>
        ✉️ info@equinetransportuk.com<br>
        🌍 www.equinetransportuk.com
      </div>

    </div>
  </div>
  `;
}

function buildResendCardEmail({
  booking,
  type,
  formLink,
  depositLink,
  outstandingLink,
}) {
  const firstName = booking.customerName?.split(" ")[0] || "Customer";

  const showForm = type === "form";
  const showDeposit = type === "deposit";
  const showOutstanding = type === "outstanding";

  const hasOutstanding = Number(booking.outstandingAmount || 0) > 0;

  // ✅ SAFE LINKS (prevents crashes)
  const safeFormLink = formLink || "#";
  const safeDepositLink = depositLink || "#";
  const safeOutstandingLink = outstandingLink || "#";

  const formatDate = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d)) return value;

    return d.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const title = showForm
    ? "Form Required"
    : showDeposit
      ? "Deposit Required"
      : "Outstanding Balance";

  return `
<div style="font-family:Arial,sans-serif;background:#f5f7fa;padding:20px;">

  <div style="max-width:600px;margin:0 auto;">

    <div style="background:#ffffff;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,0.08);">

      <h2 style="margin-top:0;">${title}</h2>

      <p>Dear ${firstName},</p>

      <!-- ===============================
           BOOKING SUMMARY
      =============================== -->

      <div style="margin-top:20px;padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa;">
        <strong>Booking Summary</strong><br><br>

        Reference: #${(booking.id || "").slice(-8)}<br>
        Lorry: ${booking.vehicleSnapshot?.name || "Horsebox Hire"}<br>
        From: ${formatDate(booking.pickupAt)}<br>
        Until: ${formatDate(booking.dropoffAt)}
      </div>

      <!-- ===============================
           PAYMENT SUMMARY
      =============================== -->

      <div style="margin-top:16px;padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff;">
        <strong>Payment Summary</strong><br><br>

        Total hire: £${Number(booking.hireTotal || 0).toFixed(2)}<br>
        Paid now: £${Number(booking.confirmationFee || 0).toFixed(2)}<br>
        Outstanding: £${Number(booking.outstandingAmount || 0).toFixed(2)}
      </div>

      <!-- ===============================
           ACTION BLOCK
      =============================== -->

      ${
        showForm
          ? `
      <div style="margin-top:20px;padding:16px;border:1px solid #e5e7eb;border-radius:12px;">
        <strong>Form Required</strong>
        <p>Please complete your hire form before collection.</p>

        <a href="${safeFormLink}" style="display:inline-block;margin-top:10px;padding:12px 18px;background:#1f6feb;color:#fff;border-radius:8px;text-decoration:none;">
          Complete Form
        </a>

        <p style="margin-top:10px;font-size:13px;color:#555;">
          Required before your hire can proceed.
        </p>
      </div>
      `
          : ""
      }

      ${
        showDeposit
          ? `
      <div style="margin-top:20px;padding:16px;border:1px solid #e5e7eb;border-radius:12px;">
        <strong>Deposit Hold (£200)</strong>

        <p>This secures your booking.</p>

        <a href="${safeDepositLink}" style="display:inline-block;margin-top:10px;padding:12px 18px;background:#1f6feb;color:#fff;border-radius:8px;text-decoration:none;">
          Pay Deposit
        </a>

        <p style="margin-top:10px;font-size:13px;color:#555;">
          Must be completed before collection.
        </p>
      </div>
      `
          : ""
      }

      ${
        showOutstanding && hasOutstanding
          ? `
      <div style="margin-top:20px;padding:16px;border:1px solid #e5e7eb;border-radius:12px;">
        <strong>Outstanding Balance</strong>

        <p>Your remaining balance is:</p>

        <div style="font-size:20px;font-weight:700;margin:10px 0;">
          £${Number(booking.outstandingAmount || 0).toFixed(2)}
        </div>

        <a href="${safeOutstandingLink}" style="display:inline-block;margin-top:10px;padding:12px 18px;background:#1f6feb;color:#fff;border-radius:8px;text-decoration:none;">
          Pay Outstanding
        </a>

        <p style="margin-top:10px;font-size:13px;color:#b45309;">
          ⚠ Please complete before collection
        </p>
      </div>
      `
          : ""
      }

      <!-- ===============================
           WHATSAPP CTA
      =============================== -->

      <div style="margin-top:24px;text-align:center;">
        <a href="https://wa.me/447584578654"
           style="display:inline-block;padding:10px 16px;background:#25D366;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
          💬 Message us on WhatsApp
        </a>
      </div>

      <!-- ===============================
           FOOTER
      =============================== -->

      <p style="margin-top:30px;">
        With kind regards,<br>
        Koos & Avril<br>
        Equine Transport UK
      </p>

    </div>
  </div>
</div>
`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendBookingEmail(env, { to, subject, html }) {
  if (!env.SENDGRID_API_KEY) {
    throw new Error("Missing SENDGRID_API_KEY");
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: to }],
        },
      ],
      from: {
        email: "info@equinetransportuk.com",
        name: "Equine Transport UK",
      },
      subject,
      content: [
        {
          type: "text/html",
          value: html,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SendGrid error ${response.status}: ${text}`);
  }
}

function buildCorsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,stripe-signature",
  };
}

function withCors(response, corsHeaders) {
  const headers = new Headers(response.headers);

  Object.entries(corsHeaders).forEach(([key, value]) =>
    headers.set(key, value),
  );

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

async function handleFormSubmit(request, env) {
  try {
    const data = await request.json();

    const bookingId = String(data.bookingId || data.bookingID || "").trim();

    /* ===============================
   🔥 NORMALISE BOOKING ID (FIX)
=============================== */

    // ✅ force single field everywhere
    data.bookingId = bookingId;

    // ❌ remove legacy duplicate
    delete data.bookingID;

    const formType = String(data.formType || "unknown")
      .trim()
      .toLowerCase();

    if (!bookingId) {
      return json({ error: "Missing bookingId" }, 400);
    }

    if (!["short", "long"].includes(formType)) {
      return json({ error: "Invalid formType" }, 400);
    }

    /* ===============================
       FIND BOOKING IN KV
    =============================== */

    const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

    let booking = null;
    let monthKeyUsed = null;
    let monthData = null;

    for (const key of list.keys) {
      const raw = await env.BOOKINGS_KV.get(key.name);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) continue;

        const found = parsed.find((b) => String(b.id) === bookingId);

        if (found) {
          booking = found;
          monthKeyUsed = key.name;
          monthData = parsed;
          break;
        }
      } catch {}
    }

    if (!booking) {
      return json({ error: "Booking not found" }, 404);
    }

    /* ===============================
       NORMALISE + BASIC VALIDATION
    =============================== */

    const cleaned = { ...data };

    /* ===============================
   DVLA EXTRACTION (NEW)
=============================== */

    function extractLicenceLast8(raw) {
      if (!raw) return "";

      return String(raw).replace(/\s+/g, "").toUpperCase().slice(-8);
    }

    const dvlaCode =
      cleaned.dvlaCheckCode ||
      cleaned.dvlaCode ||
      cleaned.payload?.dvlaCheckCode ||
      cleaned.payload?.dvlaCode ||
      "";

    const licenceRaw =
      cleaned.drivingLicenceNumber ||
      cleaned.licenceNumber ||
      cleaned.payload?.drivingLicenceNumber ||
      cleaned.payload?.licenceNumber ||
      "";

    const licenceLast8 = extractLicenceLast8(licenceRaw);

    cleaned.bookingId = bookingId;
    cleaned.formType = formType;

    const customerName =
      [cleaned.firstName, cleaned.lastName]
        .filter(Boolean)
        .map((v) => String(v).trim())
        .join(" ")
        .trim() ||
      booking.customerName ||
      null;

    const customerEmail =
      String(cleaned.email || booking.customerEmail || "")
        .trim()
        .toLowerCase() || null;

    const customerMobile =
      String(cleaned.mobile || booking.customerMobile || "").trim() || null;

    const signatureData =
      String(cleaned.signatureData || cleaned.signature || "").trim() || null;

    if (!signatureData) {
      return json({ error: "Missing signature" }, 400);
    }

    if (formType === "long") {
      const dvla = String(cleaned.dvlaCheckCode || "").trim();
      if (dvla.length !== 8) {
        return json(
          { error: "DVLA check code must be exactly 8 characters" },
          400,
        );
      }
    }

    if (formType === "short") {
      const dvla = String(cleaned.dvlaCode || "").trim();
      if (dvla.length !== 8) {
        return json(
          { error: "DVLA access code must be exactly 8 characters" },
          400,
        );
      }
    }

    const now = new Date().toISOString();
    const formId = `form_${bookingId}`;

    /* ===============================
       SAVE FULL FORM TO D1
    =============================== */

    await env.DB.prepare(
      `
      INSERT INTO booking_forms (
        id,
        booking_id,
        form_type,
        customer_id,
        customer_name,
        customer_email,
        customer_mobile,
        payload_json,
        signature_data,
        submitted_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        form_type = excluded.form_type,
        customer_id = excluded.customer_id,
        customer_name = excluded.customer_name,
        customer_email = excluded.customer_email,
        customer_mobile = excluded.customer_mobile,
        payload_json = excluded.payload_json,
        signature_data = excluded.signature_data,
        updated_at = excluded.updated_at
    `,
    )
      .bind(
        formId,
        bookingId,
        formType,
        booking.customerId || null,
        customerName,
        customerEmail,
        customerMobile,
        JSON.stringify(cleaned),
        signatureData,
        now,
        now,
      )
      .run();

    /* ===============================
       UPDATE BOOKING IN KV
    =============================== */

    booking.formCompleted = true;
    booking.formType = formType;
    booking.formSubmittedAt = now;
    booking.formRecordId = formId;

    /* ===============================
   SAVE DVLA INTO BOOKING (NEW)
=============================== */

    booking.dvlaLicenceLast8 = licenceLast8 || "";
    booking.dvlaCode = dvlaCode || "";

    // only set default if not already verified
    if (booking.dvlaVerified !== true) {
      booking.dvlaVerified = false;
    }

    if (monthKeyUsed && monthData) {
      const updated = monthData.map((b) =>
        String(b.id) === bookingId ? booking : b,
      );

      await env.BOOKINGS_KV.put(monthKeyUsed, JSON.stringify(updated));
    }

    /* ===============================
       UPDATE BOOKING IN D1
    =============================== */

    try {
      await env.DB.prepare(
        `
  UPDATE bookings
  SET
    form_completed = 1,
    dvla_verified = 0,
    updated_at = ?
  WHERE id = ?
`,
      )
        .bind(now, bookingId)
        .run();
    } catch (err) {
      console.warn("⚠️ bookings table update skipped:", err.message);
    }

    console.log("✅ FORM SAVED:", {
      bookingId,
      formType,
      formId,
    });

    return json({
      success: true,
      bookingId,
      formType,
      formId,
    });
  } catch (err) {
    console.error("❌ FORM ERROR:", err);

    return json({ error: "Form submission failed" }, 500);
  }
}

async function handleAdminFormView(request, env) {
  try {
    const url = new URL(request.url);
    const bookingId = String(url.searchParams.get("bookingId") || "").trim();

    if (!bookingId) {
      return json({ error: "Missing bookingId" }, 400);
    }

    const row = await env.DB.prepare(
      `
      SELECT
        id,
        booking_id,
        form_type,
        customer_id,
        customer_name,
        customer_email,
        customer_mobile,
        payload_json,
        signature_data,
        submitted_at,
        updated_at
      FROM booking_forms
      WHERE booking_id = ?
      LIMIT 1
    `,
    )
      .bind(bookingId)
      .first();

    if (!row) {
      return json({ found: false }, 404);
    }

    let payload = null;

    try {
      payload = JSON.parse(row.payload_json || "{}");
    } catch {
      payload = {};
    }

    return json({
      found: true,
      form: {
        id: row.id,
        bookingId: row.booking_id,
        formType: row.form_type,
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        customerMobile: row.customer_mobile,
        submittedAt: row.submitted_at,
        updatedAt: row.updated_at,
        signatureData: row.signature_data,
        payload,
      },
    });
  } catch (err) {
    console.error("❌ ADMIN FORM VIEW ERROR:", err);

    return json({ error: "Failed to load form" }, 500);
  }
}

async function handleResendEmail(request, env) {
  try {
    const body = await request.json();

    const bookingId = String(body.bookingId || "").trim();
    const type = String(body.type || "")
      .trim()
      .toLowerCase(); // form / deposit / outstanding

    if (!bookingId || !type) {
      return json({ error: "Missing bookingId or type" }, 400);
    }

    /* ===============================
       FIND BOOKING IN KV
    =============================== */

    const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

    let booking = null;

    for (const key of list.keys) {
      const data = await env.BOOKINGS_KV.get(key.name);
      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) continue;

        const found = parsed.find((b) => String(b.id) === bookingId);
        if (found) {
          booking = found;
          break;
        }
      } catch {}
    }

    if (!booking) {
      return json({ error: "Booking not found" }, 404);
    }

    if (!booking.customerEmail) {
      return json({ error: "No customer email" }, 400);
    }

    /* ===============================
       EMAIL TYPE LOGIC
    =============================== */

    let title = "Equine Transport UK – Update";
    let subject = "Your Equine Transport UK update";

    if (type === "form") {
      title = "Equine Transport UK – Form Required";
      subject = "Please complete your hire form";
    }

    if (type === "deposit") {
      title = "Equine Transport UK – Deposit Payment";
      subject = "Deposit required for your booking";
    }

    if (type === "outstanding") {
      title = "Equine Transport UK – Outstanding Balance";
      subject = "Outstanding balance for your booking";
    }

    /* ===============================
   BUILD EMAIL (REUSE TEMPLATE)
=============================== */

    // ✅ SAFETY CHECKS (ADD HERE)
    if (!booking.requiredFormLink) {
      console.warn("⚠️ Missing formLink for booking", bookingId);
    }

    if (!booking.depositLink) {
      console.warn("⚠️ Missing depositLink for booking", bookingId);
    }

    if (!booking.outstandingLink) {
      console.warn("⚠️ Missing outstandingLink for booking", bookingId);
    }

    // ✅ FIXED EMAIL BUILD
    const emailHtml = buildResendCardEmail({
      booking,
      type,
      formLink: booking.requiredFormLink,
      depositLink: booking.depositLink,
      outstandingLink: booking.outstandingLink,
    });

    /* ===============================
       SEND EMAIL
    =============================== */

    await sendBookingEmail(env, {
      to: booking.customerEmail,
      subject,
      html: emailHtml,
    });

    console.log("📧 RESEND EMAIL SENT:", bookingId, type);

    return json({
      success: true,
      bookingId,
      type,
    });
  } catch (err) {
    console.error("❌ RESEND EMAIL ERROR:", err);

    return json({ error: "Failed to resend email" }, 500);
  }
}
