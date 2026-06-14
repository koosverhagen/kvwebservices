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

async function clearBookingReservations(env, bookingId) {
  const safeBookingId = String(bookingId || "").trim();

  if (!safeBookingId) return;

  try {
    const list = await env.BOOKINGS_KV.list({ prefix: "reservation:" });

    const deletes = [];

    for (const key of list.keys) {
      if (String(key.name).endsWith(`:${safeBookingId}`)) {
        deletes.push(env.BOOKINGS_KV.delete(key.name));
      }
    }

    await Promise.allSettled(deletes);

    if (deletes.length) {
      console.log("🧹 Cleared checkout reservations:", safeBookingId);
    }
  } catch (err) {
    console.warn("⚠️ Could not clear checkout reservations:", err);
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
        const response = await handlePricingQuote(request, env);
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
   MIGRATION — EXPORT BACKUP
================================ */

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/migration/export-backup"
      ) {
        const response = await handleMigrationExportBackup(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
   MIGRATION — CLEAR TEST DATA
================================ */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/migration/clear-test-data"
      ) {
        const response = await handleMigrationClearTestData(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
   MIGRATION — IMPORT PLANYO
================================ */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/migration/import-planyo"
      ) {
        const response = await handleMigrationImportPlanyo(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
   MIGRATION — CLEAN IMPORTED CONTACTS
================================ */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/migration/clean-imported-contacts"
      ) {
        const response = await handleMigrationCleanImportedContacts(
          request,
          env,
        );
        return withCors(response, corsHeaders);
      }

      /* ===============================
   MIGRATION — PATCH MISSING LIVE DATA
================================ */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/migration/patch-live-data"
      ) {
        const response = await handleMigrationPatchLiveData(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
   MIGRATION — PATCH EARLY PICKUP EXTRAS
================================ */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/migration/patch-early-pickup-extras"
      ) {
        const response = await handleMigrationPatchEarlyPickupExtras(
          request,
          env,
        );
        return withCors(response, corsHeaders);
      }

      /* ===============================
   MIGRATION — PATCH COMPLETED FORMS
================================ */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/migration/patch-completed-forms"
      ) {
        const response = await handleMigrationPatchCompletedForms(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
   MIGRATION — IMPORT LEGACY FORM RECORDS
================================ */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/migration/import-legacy-form-records"
      ) {
        const response = await handleMigrationImportLegacyFormRecords(
          request,
          env,
        );
        return withCors(response, corsHeaders);
      }

      /* ===============================
   ADMIN ICALENDAR FEED
   Private subscription feed
================================ */

      if (
        request.method === "GET" &&
        url.pathname === "/api/admin/bookings.ics"
      ) {
        return handleAdminBookingsIcsFeed(request, env);
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
   BOOKING BY ID (NEW)
=============================== */

      if (request.method === "GET" && url.pathname === "/api/bookings/by-id") {
        const bookingId = url.searchParams.get("bookingId");

        if (!bookingId) {
          return withCors(
            json({ error: "Missing bookingId" }, 400),
            corsHeaders,
          );
        }

        try {
          const booking = await findBookingById(env, bookingId);

          if (!booking) {
            return withCors(json({ found: false }), corsHeaders);
          }

          return withCors(
            json({
              found: true,
              booking,
            }),
            corsHeaders,
          );
        } catch (err) {
          console.error("❌ by-id error:", err);

          return withCors(json({ error: "Server error" }, 500), corsHeaders);
        }
      }

      /* ===============================
   RESEND LINKS (PUBLIC)
================================ */

      if (
        request.method === "POST" &&
        url.pathname === "/api/bookings/resend-links"
      ) {
        const response = await handlePublicResendLinks(request, env);
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
   ADMIN VOUCHERS
================================ */

      if (request.method === "GET" && url.pathname === "/api/admin/vouchers") {
        const response = await handleAdminListVouchers(request, env);
        return withCors(response, corsHeaders);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/vouchers/save"
      ) {
        const response = await handleAdminSaveVoucher(request, env);
        return withCors(response, corsHeaders);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/vouchers/delete"
      ) {
        const response = await handleAdminDeleteVoucher(request, env);
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
        // FIND BOOKING (WITH RETRY)
        // ===============================

        let booking = null;

        for (let attempt = 0; attempt < 5; attempt++) {
          const list = await env.BOOKINGS_KV.list({
            prefix: "bookings:",
          });

          for (const key of list.keys) {
            const data = await env.BOOKINGS_KV.get(key.name);

            if (!data) continue;

            try {
              const parsed = JSON.parse(data);

              if (Array.isArray(parsed)) {
                const found = parsed.find(
                  (b) => String(b.id) === String(bookingId),
                );

                if (found) {
                  booking = found;
                  break;
                }
              }
            } catch {}
          }

          if (booking) break;

          console.log(`⏳ Deposit booking retry ${attempt + 1}/5`);

          await new Promise((r) => setTimeout(r, 800));
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

        /* ===============================
   SAVE DEPOSIT PAYMENT INTENT
=============================== */

        booking.depositPaymentIntentId = paymentIntent.id;

        booking.updatedAt = new Date().toISOString();

        await moveBookingInKv(env, booking, booking);

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
     CREATE / FIND CUSTOMER
     Admin customer records require:
     full name + email + mobile.
     Optional: address, dob, notes.
  ================================ */

      if (url.pathname === "/api/customers" && request.method === "POST") {
        let body;

        try {
          body = await request.json();
          console.log("📥 CUSTOMER BODY:", body);
        } catch (err) {
          return withCors(json({ error: "Invalid JSON" }, 400), corsHeaders);
        }

        const name = String(body.full_name || "").trim();
        const email = String(body.email || "")
          .trim()
          .toLowerCase();
        const mobile = String(body.mobile || "").trim();

        const address = String(body.address || "").trim() || null;
        const dob = String(body.dob || "").trim() || null;
        const notes = String(body.notes || "").trim() || null;

        if (!name) {
          return withCors(
            json({ error: "Full name required" }, 400),
            corsHeaders,
          );
        }

        if (!email) {
          return withCors(json({ error: "Email required" }, 400), corsHeaders);
        }

        if (!mobile) {
          return withCors(json({ error: "Mobile required" }, 400), corsHeaders);
        }

        if (!address) {
          return withCors(
            json({ error: "Address required" }, 400),
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
              address,
              dob,
              notes,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          )
            .bind(id, name, email, mobile, address, dob, notes, now, now)
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
         CUSTOMER SEARCH / LIST
         Empty q = list all A-Z.
         q = search name/email/mobile.
      =============================== */

      if (
        request.method === "GET" &&
        url.pathname === "/api/customers/search"
      ) {
        try {
          const q = String(url.searchParams.get("q") || "")
            .trim()
            .toLowerCase();

          let result;

          if (!q) {
            result = await env.DB.prepare(
              `
              SELECT
                id,
                full_name,
                email,
                mobile,
                address,
                dob,
                notes,
                hire_count,
                last_hire_at,
                created_at,
                updated_at
              FROM customers
              ORDER BY LOWER(full_name) ASC
              LIMIT 500
            `,
            ).all();
          } else {
            result = await env.DB.prepare(
              `
              SELECT
                id,
                full_name,
                email,
                mobile,
                address,
                dob,
                notes,
                hire_count,
                last_hire_at,
                created_at,
                updated_at
              FROM customers
              WHERE
                LOWER(full_name) LIKE ?
                OR LOWER(email) LIKE ?
                OR mobile LIKE ?
              ORDER BY LOWER(full_name) ASC
              LIMIT 500
            `,
            )
              .bind(`%${q}%`, `%${q}%`, `%${q}%`)
              .all();
          }

          return withCors(json({ results: result.results || [] }), corsHeaders);
        } catch (err) {
          console.error("❌ CUSTOMER SEARCH ERROR:", err);
          return withCors(json({ results: [] }), corsHeaders);
        }
      }

      /* ===============================
         ADMIN CUSTOMER UPDATE
      =============================== */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/customer-update"
      ) {
        try {
          const body = await request.json();

          const id = String(body.id || "").trim();
          const fullName = String(body.full_name || "").trim();
          const email = String(body.email || "")
            .trim()
            .toLowerCase();
          const mobile = String(body.mobile || "").trim();

          const address = String(body.address || "").trim() || null;
          const dob = String(body.dob || "").trim() || null;
          const notes = String(body.notes || "").trim() || null;

          if (!id) {
            return withCors(
              json({ error: "Missing customer id" }, 400),
              corsHeaders,
            );
          }

          if (!fullName) {
            return withCors(
              json({ error: "Full name required" }, 400),
              corsHeaders,
            );
          }

          if (!email) {
            return withCors(
              json({ error: "Email required" }, 400),
              corsHeaders,
            );
          }

          if (!mobile) {
            return withCors(
              json({ error: "Mobile required" }, 400),
              corsHeaders,
            );
          }

          if (!address) {
            return withCors(
              json({ error: "Address required" }, 400),
              corsHeaders,
            );
          }

          const now = new Date().toISOString();

          await env.DB.prepare(
            `
            UPDATE customers
            SET
              full_name = ?,
              email = ?,
              mobile = ?,
              address = ?,
              dob = ?,
              notes = ?,
              updated_at = ?
            WHERE id = ?
          `,
          )
            .bind(fullName, email, mobile, address, dob, notes, now, id)
            .run();

          const customer = await env.DB.prepare(
            "SELECT * FROM customers WHERE id = ?",
          )
            .bind(id)
            .first();

          return withCors(
            json({
              ok: true,
              customer,
            }),
            corsHeaders,
          );
        } catch (err) {
          console.error("❌ CUSTOMER UPDATE ERROR:", err);

          return withCors(
            json(
              {
                error: "Customer update failed",
                detail: err.message,
              },
              500,
            ),
            corsHeaders,
          );
        }
      }

      /* ===============================
         CUSTOMER BOOKING HISTORY
         Uses email address so old/new linked bookings show.
         Returns all past/current/future.
      =============================== */

      if (
        request.method === "GET" &&
        url.pathname === "/api/customers/bookings"
      ) {
        try {
          const email = String(url.searchParams.get("email") || "")
            .trim()
            .toLowerCase();

          if (!email) {
            return withCors(json({ bookings: [] }), corsHeaders);
          }

          const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

          const bookings = [];

          for (const key of list.keys) {
            const raw = await env.BOOKINGS_KV.get(key.name);
            if (!raw) continue;

            let parsed;

            try {
              parsed = JSON.parse(raw);
            } catch {
              continue;
            }

            if (!Array.isArray(parsed)) continue;

            parsed.forEach((booking) => {
              const bookingEmail = String(booking.customerEmail || "")
                .trim()
                .toLowerCase();

              if (bookingEmail === email) {
                bookings.push(booking);
              }
            });
          }

          bookings.sort((a, b) => {
            const da = new Date(a.pickupAt || a.pickupAtLocal || 0).getTime();
            const db = new Date(b.pickupAt || b.pickupAtLocal || 0).getTime();
            return db - da;
          });

          return withCors(
            json({
              bookings,
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

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/form-paper-received"
      ) {
        const response = await handleAdminPaperFormReceived(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
   ADMIN HANDOVER / DAMAGE REPORT
   STEP 1A — KV LOAD/SAVE SHELL ONLY
================================ */

      if (request.method === "GET" && url.pathname === "/api/admin/handover") {
        const response = await handleAdminHandoverView(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
   ADMIN HANDOVER EMAIL COPY
   STEP 3C — DRY RUN ONLY
   No email sending until go-live
================================ */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/handover/email-copy"
      ) {
        const response = await handleAdminHandoverEmailCopy(request, env);
        return withCors(response, corsHeaders);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/handover/customer-link"
      ) {
        const response = await handleAdminHandoverCustomerLink(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
   PUBLIC HANDOVER COPY VIEW
   STEP 3F — TOKEN ACCESS ONLY
================================ */

      if (request.method === "GET" && url.pathname === "/api/handover-copy") {
        const response = await handlePublicHandoverCopy(request, env);
        return withCors(response, corsHeaders);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/handover/save"
      ) {
        const response = await handleAdminHandoverSave(request, env);
        return withCors(response, corsHeaders);
      }

      /* ===============================
   BOOKING UPDATE (ADMIN)
=============================== */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/booking-update"
      ) {
        const response = await handleAdminBookingUpdate(request, env);
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
   💳 ADMIN ADD PAYMENT
=============================== */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/add-payment"
      ) {
        try {
          const { bookingId, amount } = await request.json();

          if (!bookingId || !amount || amount <= 0) {
            return withCors(json({ error: "Invalid input" }, 400), corsHeaders);
          }

          const booking = await findBookingById(env, bookingId);
          if (!booking) {
            return withCors(
              json({ error: "Booking not found" }, 404),
              corsHeaders,
            );
          }

          const newPaid = (booking.paidNow || 0) + Number(amount);
          const outstanding = Math.max(0, (booking.hireTotal || 0) - newPaid);

          booking.paidNow = newPaid;
          booking.outstandingAmount = outstanding;
          booking.outstanding = outstanding;
          booking.outstandingPaid = outstanding === 0;

          booking.updatedAt = new Date().toISOString();

          await moveBookingInKv(env, booking, booking);

          return withCors(json({ ok: true, booking }), corsHeaders);
        } catch (err) {
          return withCors(json({ error: "Payment failed" }, 500), corsHeaders);
        }
      }

      /* ===============================
   💸 ADMIN REFUND (FINAL)
=============================== */

      if (request.method === "POST" && url.pathname === "/api/admin/refund") {
        try {
          const { bookingId, amount } = await request.json();

          if (!bookingId || !amount || amount <= 0) {
            return withCors(json({ error: "Invalid input" }, 400), corsHeaders);
          }

          const booking = await findBookingById(env, bookingId);

          if (!booking) {
            return withCors(
              json({ error: "Booking not found" }, 404),
              corsHeaders,
            );
          }

          /* ===============================
   🔒 PREVENT OVER-REFUND
=============================== */

          const total = Number(booking.hireTotal || booking.total || 0);

          const refunded = Number(booking.refundedTotal || 0);

          const manualPaid = Number(
            booking.manualPayments || booking.manualPaymentsTotal || 0,
          );

          /* ===============================
   🔥 TRUE PAID
=============================== */

          let paid = Number(booking.paidNow || 0) + manualPaid;

          /* ===============================
   🔥 FALLBACK:
   FULLY PAID BOOKINGS
=============================== */

          if (Number(booking.outstandingAmount || 0) <= 0) {
            paid = total;
          }

          /* ===============================
   🔥 TRUE REMAINING
=============================== */

          const remaining = Math.max(0, paid - refunded);
          if (amount > remaining) {
            return withCors(
              json(
                {
                  error: `Max refundable is £${remaining.toFixed(2)}`,
                },
                400,
              ),
              corsHeaders,
            );
          }
          /* ===============================
       🔒 CANCEL SAFETY (IMPORTANT)
    =============================== */

          if (booking.status === "cancelled" || booking.cancelled === true) {
            return withCors(
              json({ error: "Cannot refund a cancelled booking" }, 400),
              corsHeaders,
            );
          }

          /* ===============================
       🔥 STRIPE REFUND (FINAL)
    =============================== */

          if (!booking.paymentIntentId) {
            console.log("⚠️ Manual payment refund (no Stripe)");

            // 🔄 Just update booking (no Stripe call)

            const newPaid = Math.max(0, (booking.paidNow || 0) - amount);
            const outstanding = Math.max(0, (booking.hireTotal || 0) - newPaid);

            booking.paidNow = newPaid;
            booking.outstandingAmount = outstanding;
            booking.outstanding = outstanding;

            booking.refundedTotal =
              (booking.refundedTotal || 0) + Number(amount);

            if (booking.refundedTotal >= (booking.paidNow || 0)) {
              booking.fullyRefunded = true;
            }

            booking.updatedAt = new Date().toISOString();

            await moveBookingInKv(env, booking, booking);

            // 🧾 audit log
            try {
              const auditKey = `audit:${booking.id}`;
              let audit = JSON.parse(await env.BOOKINGS_KV.get(auditKey)) || [];

              audit.unshift({
                type: "refund_manual",
                amount: Number(amount),
                at: new Date().toISOString(),
              });

              await env.BOOKINGS_KV.put(auditKey, JSON.stringify(audit));
            } catch {}

            return withCors(
              json({ ok: true, booking, mode: "manual" }),
              corsHeaders,
            );
          }

          /* ===============================
   🔥 MULTI PAYMENT SUPPORT
=============================== */

          const originalPaid =
            Number(booking.paidNow || 0) -
            Number(booking.outstandingAmountPaid || 0);

          const outstandingPaidAmount = Number(
            booking.outstandingAmountPaid || 0,
          );

          console.log("💰 originalPaid:", originalPaid);
          console.log("💰 outstandingPaidAmount:", outstandingPaidAmount);

          const stripe = new Stripe(env.STRIPE_SECRET_KEY);

          try {
            let remainingRefund = Number(amount);

            /* ===============================
     1️⃣ REFUND OUTSTANDING PAYMENT
  =============================== */

            if (remainingRefund > 0 && outstandingPaidAmount > 0) {
              const outstandingRefund = Math.min(
                remainingRefund,
                outstandingPaidAmount,
              );

              if (booking.outstandingSessionPaymentIntentId) {
                await stripe.refunds.create({
                  payment_intent: booking.outstandingSessionPaymentIntentId,
                  amount: Math.round(outstandingRefund * 100),
                });

                console.log("💸 Outstanding refunded:", outstandingRefund);
              }

              remainingRefund -= outstandingRefund;
            }

            /* ===============================
     2️⃣ REFUND ORIGINAL PAYMENT
  =============================== */

            if (remainingRefund > 0) {
              await stripe.refunds.create({
                payment_intent: booking.paymentIntentId,
                amount: Math.round(remainingRefund * 100),
              });

              console.log("💸 Original payment refunded:", remainingRefund);
            }
          } catch (err) {
            console.error("❌ Stripe refund failed:", err);

            return withCors(
              json(
                {
                  error: "Stripe refund failed",
                  detail: err.message,
                },
                500,
              ),
              corsHeaders,
            );
          }

          /* ===============================
       🧾 AUDIT LOG (NEW)
    =============================== */

          try {
            const auditKey = `audit:${booking.id}`;

            let audit = [];

            try {
              audit = JSON.parse(await env.BOOKINGS_KV.get(auditKey)) || [];
            } catch {}

            audit.unshift({
              type: "refund",
              amount: Number(amount),
              at: new Date().toISOString(),
            });

            await env.BOOKINGS_KV.put(auditKey, JSON.stringify(audit));
          } catch (err) {
            console.warn("⚠️ Audit log failed (non-blocking):", err);
          }

          /* ===============================
   🔄 UPDATE BOOKING FINANCIALS
=============================== */

          booking.refundedTotal =
            Number(booking.refundedTotal || 0) + Number(amount);

          /* ===============================
   💰 TRUE PAID TOTAL
=============================== */

          const totalPaid = Number(booking.hireTotal || booking.total || 0);

          /* ===============================
   💰 REMAINING AFTER REFUNDS
=============================== */

          const remainingPaid = Math.max(0, totalPaid - booking.refundedTotal);

          /* ===============================
   🔥 UPDATE DISPLAY VALUES
=============================== */

          booking.paidNow = remainingPaid;

          booking.outstandingAmount = 0;

          booking.outstanding = 0;

          /* ===============================
   🔥 FULLY REFUNDED
=============================== */

          if (remainingPaid <= 0) {
            booking.fullyRefunded = true;
          }

          /* ===============================
   UPDATED
=============================== */

          booking.updatedAt = new Date().toISOString();

          await moveBookingInKv(env, booking, booking);

          return withCors(json({ ok: true, booking }), corsHeaders);
        } catch (err) {
          console.error("❌ Refund route crash:", err);

          return withCors(
            json({ error: "Refund failed", detail: err.message }, 500),
            corsHeaders,
          );
        }
      }

      /* ===============================
   💳 ADMIN CAPTURE DEPOSIT
=============================== */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/capture-deposit"
      ) {
        try {
          const { bookingId, amount } = await request.json();

          if (!bookingId) {
            return withCors(
              json({ error: "Missing bookingId" }, 400),
              corsHeaders,
            );
          }

          /* ===============================
       FIND BOOKING
    =============================== */

          const booking = await findBookingById(env, bookingId);

          if (!booking) {
            return withCors(
              json({ error: "Booking not found" }, 404),
              corsHeaders,
            );
          }

          const paymentIntentId =
            booking.depositPaymentIntentId || booking.paymentIntentId;

          if (!paymentIntentId) {
            return withCors(
              json({ error: "No Stripe deposit found" }, 400),
              corsHeaders,
            );
          }

          /* ===============================
       LOAD STRIPE PAYMENT INTENT
    =============================== */

          const stripe = new Stripe(env.STRIPE_SECRET_KEY);

          const paymentIntent =
            await stripe.paymentIntents.retrieve(paymentIntentId);

          /* ===============================
       VALIDATE STATUS
    =============================== */

          if (paymentIntent.capture_method !== "manual") {
            return withCors(
              json({ error: "This is not a manual-capture deposit" }, 400),
              corsHeaders,
            );
          }

          if (paymentIntent.status !== "requires_capture") {
            return withCors(
              json(
                {
                  error: `Deposit cannot be captured (${paymentIntent.status})`,
                },
                400,
              ),
              corsHeaders,
            );
          }

          /* ===============================
       FULL OR PARTIAL CAPTURE
    =============================== */

          let captureAmount = null;

          if (amount && Number(amount) > 0) {
            captureAmount = Math.round(Number(amount) * 100);
          }

          const captured = await stripe.paymentIntents.capture(
            paymentIntentId,
            captureAmount
              ? {
                  amount_to_capture: captureAmount,
                }
              : {},
          );

          console.log("💳 Deposit captured:", captured.id);

          /* ===============================
       UPDATE BOOKING
    =============================== */

          const capturedPounds = captureAmount ? Number(amount) : 200;

          /* ===============================
   🔒 DEPOSIT SYSTEM (SEPARATE)
   Stripe releases any uncaptured remainder after capture.
================================ */

          const nowIso = new Date().toISOString();

          booking.depositPaid = false;
          booking.depositReleased = true;
          booking.depositReleasedAt = nowIso;
          booking.depositStatus = "captured_remainder_released";

          booking.depositCapturedAmount = capturedPounds;
          booking.depositCapturedAt = nowIso;

          /* ===============================
   🚫 DO NOT TOUCH HIRE PAYMENTS
================================ */

          /*
DO NOT update:
- paidNow
- outstandingAmount
- outstanding

Deposit is NOT booking revenue.
It is only a security hold.
*/

          booking.updatedAt = nowIso;
          /* ===============================
       AUDIT LOG
    =============================== */

          try {
            const auditKey = `audit:${booking.id}`;

            let audit = [];

            try {
              audit = JSON.parse(await env.BOOKINGS_KV.get(auditKey)) || [];
            } catch {}

            audit.unshift({
              type: "deposit_capture",
              amount: capturedPounds,
              at: new Date().toISOString(),
            });

            await env.BOOKINGS_KV.put(auditKey, JSON.stringify(audit));
          } catch {}

          /* ===============================
       SAVE BOOKING
    =============================== */

          await moveBookingInKv(env, booking, booking);

          return withCors(
            json({
              ok: true,
              booking,
            }),
            corsHeaders,
          );
        } catch (err) {
          console.error("❌ Capture failed:", err);

          return withCors(
            json(
              {
                error: "Deposit capture failed",
                detail: err.message,
              },
              500,
            ),
            corsHeaders,
          );
        }
      }

      /* ===============================
   ↩️ ADMIN CANCEL DEPOSIT
=============================== */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/cancel-deposit"
      ) {
        try {
          const { bookingId } = await request.json();

          if (!bookingId) {
            return withCors(
              json({ error: "Missing bookingId" }, 400),
              corsHeaders,
            );
          }

          const booking = await findBookingById(env, bookingId);

          if (!booking) {
            return withCors(
              json({ error: "Booking not found" }, 404),
              corsHeaders,
            );
          }

          const paymentIntentId = booking.depositPaymentIntentId;

          if (!paymentIntentId) {
            return withCors(
              json({ error: "No deposit hold found" }, 400),
              corsHeaders,
            );
          }

          const stripe = new Stripe(env.STRIPE_SECRET_KEY);

          const paymentIntent =
            await stripe.paymentIntents.retrieve(paymentIntentId);

          if (paymentIntent.capture_method !== "manual") {
            return withCors(
              json(
                {
                  error: "This is not a deposit hold",
                },
                400,
              ),
              corsHeaders,
            );
          }

          if (paymentIntent.status !== "requires_capture") {
            return withCors(
              json(
                {
                  error: "Deposit already captured or cancelled",
                },
                400,
              ),
              corsHeaders,
            );
          }

          await stripe.paymentIntents.cancel(paymentIntentId);

          console.log("↩️ Deposit cancelled");
          booking.depositCancelled = true;

          booking.depositPaid = false;

          booking.depositCapturedAmount = 0;

          booking.depositCancelledAt = new Date().toISOString();

          booking.updatedAt = new Date().toISOString();

          await moveBookingInKv(env, booking, booking);

          try {
            const auditKey = `audit:${booking.id}`;

            let audit = [];

            try {
              audit = JSON.parse(await env.BOOKINGS_KV.get(auditKey)) || [];
            } catch {}

            audit.unshift({
              type: "deposit_cancelled",
              at: new Date().toISOString(),
            });

            await env.BOOKINGS_KV.put(auditKey, JSON.stringify(audit));
          } catch {}

          return withCors(
            json({
              ok: true,
            }),
            corsHeaders,
          );
        } catch (err) {
          console.error("❌ Deposit cancel failed:", err);

          return withCors(
            json(
              {
                error: "Deposit cancel failed",
                detail: err.message,
              },
              500,
            ),
            corsHeaders,
          );
        }
      }

      /* ===============================
   ❌ ADMIN CANCEL BOOKING
=============================== */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/cancel-booking"
      ) {
        try {
          const { bookingId } = await request.json();

          const booking = await findBookingById(env, bookingId);
          if (!booking) {
            return withCors(
              json({ error: "Booking not found" }, 404),
              corsHeaders,
            );
          }

          booking.status = "cancelled";
          booking.cancelledAt = new Date().toISOString();
          booking.updatedAt = booking.cancelledAt;

          await moveBookingInKv(env, booking, booking);

          return withCors(json({ ok: true }), corsHeaders);
        } catch {
          return withCors(json({ error: "Cancel failed" }, 500), corsHeaders);
        }
      }

      /* ===============================
   🧾 GET AUDIT LOG
=============================== */
      if (request.method === "GET" && url.pathname === "/api/admin/audit") {
        const bookingId = url.searchParams.get("bookingId");

        if (!bookingId) {
          return withCors(
            json({ error: "Missing bookingId" }, 400),
            corsHeaders,
          );
        }

        const auditKey = `audit:${bookingId}`;

        let audit = [];

        try {
          audit = JSON.parse(await env.BOOKINGS_KV.get(auditKey)) || [];
        } catch {}

        return withCors(json({ audit }), corsHeaders);
      }

      /* ===============================
   ADMIN BLOCK AVAILABILITY (FINAL)
=============================== */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/block-date"
      ) {
        try {
          const {
            date,
            dateFrom,
            dateUntil,
            vehicleId,
            reason,
            note,
            slot = "full",
            fromTime = "",
            untilTime = "",
          } = await request.json();

          if (!vehicleId) {
            return withCors(
              json({ error: "Missing vehicleId" }, 400),
              corsHeaders,
            );
          }

          /* ===============================
       🔥 NORMALISE DATES
    =============================== */

          const start = dateFrom || date;
          const end = dateUntil || date;

          if (!start) {
            return withCors(json({ error: "Missing date" }, 400), corsHeaders);
          }

          const startDate = new Date(start);
          const endDate = new Date(end);

          if (isNaN(startDate) || isNaN(endDate)) {
            return withCors(
              json({ error: "Invalid date format" }, 400),
              corsHeaders,
            );
          }

          if (endDate < startDate) {
            return withCors(
              json({ error: "End date before start date" }, 400),
              corsHeaders,
            );
          }

          /* ===============================
       🔥 BUILD DATE RANGE
    =============================== */

          const dates = [];
          const current = new Date(startDate);

          while (current <= endDate) {
            dates.push(current.toISOString().slice(0, 10));
            current.setDate(current.getDate() + 1);
          }

          /* ===============================
       🔥 SAVE EACH DAY
    =============================== */

          const payloadBase = {
            dateFrom: start,
            dateUntil: end,
            vehicleId,
            reason: reason || "blocked",
            note: note || "",
            slot: slot || "full",
            fromTime: slot === "range" ? fromTime : "",
            untilTime: slot === "range" ? untilTime : "",
            createdAt: new Date().toISOString(),
          };

          for (const d of dates) {
            const key = `block:${d}:${vehicleId}`;

            const payload = {
              ...payloadBase,
              date: d, // 🔥 important: actual day
            };

            await env.BOOKINGS_KV.put(key, JSON.stringify(payload));
          }

          console.log("🚫 Block saved range:", start, "→", end, vehicleId);

          return withCors(
            json({
              ok: true,
              daysBlocked: dates.length,
            }),
            corsHeaders,
          );
        } catch (err) {
          console.error("❌ block-date error:", err);

          return withCors(
            json({ error: "Failed to save block" }, 500),
            corsHeaders,
          );
        }
      }

      /* ===============================
         ADMIN RESTORE AVAILABILITY
         Deletes admin block keys only.
         Does NOT touch bookings/reservations/payments.
      =============================== */

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/restore-availability"
      ) {
        try {
          const { date, dateFrom, dateUntil, vehicleId } = await request.json();

          if (!vehicleId) {
            return withCors(
              json({ error: "Missing vehicleId" }, 400),
              corsHeaders,
            );
          }

          const start = dateFrom || date;
          const end = dateUntil || date;

          if (!start) {
            return withCors(json({ error: "Missing date" }, 400), corsHeaders);
          }

          const startDate = new Date(start);
          const endDate = new Date(end);

          if (isNaN(startDate) || isNaN(endDate)) {
            return withCors(
              json({ error: "Invalid date format" }, 400),
              corsHeaders,
            );
          }

          if (endDate < startDate) {
            return withCors(
              json({ error: "End date before start date" }, 400),
              corsHeaders,
            );
          }

          const dates = [];
          const current = new Date(startDate);

          while (current <= endDate) {
            dates.push(current.toISOString().slice(0, 10));
            current.setDate(current.getDate() + 1);
          }

          let deleted = 0;

          for (const d of dates) {
            const key = `block:${d}:${vehicleId}`;

            const existing = await env.BOOKINGS_KV.get(key);

            if (existing) {
              await env.BOOKINGS_KV.delete(key);
              deleted++;
            }
          }

          console.log(
            "✅ Availability restored:",
            start,
            "→",
            end,
            vehicleId,
            "deleted:",
            deleted,
          );

          return withCors(
            json({
              ok: true,
              daysChecked: dates.length,
              daysRestored: deleted,
            }),
            corsHeaders,
          );
        } catch (err) {
          console.error("❌ restore availability error:", err);

          return withCors(
            json({ error: "Failed to restore availability" }, 500),
            corsHeaders,
          );
        }
      }

      /* ===============================
   GET BLOCKS FOR MONTH (FIXED)
=============================== */

      if (request.method === "GET" && url.pathname === "/api/admin/blocks") {
        try {
          const month = url.searchParams.get("month");

          if (!month) {
            return withCors(json({ error: "Missing month" }, 400), corsHeaders);
          }

          /* ===============================
       🔥 LOAD ALL BLOCK KEYS
    =============================== */

          const list = await env.BOOKINGS_KV.list({
            prefix: "block:",
          });

          const result = {};

          for (const key of list.keys) {
            // key format: block:YYYY-MM-DD:vehicleId
            const parts = key.name.split(":");
            const date = parts[1];

            if (!date || !date.startsWith(month)) continue;

            const raw = await env.BOOKINGS_KV.get(key.name);
            if (!raw) continue;

            try {
              const parsed = JSON.parse(raw);

              if (!result[parsed.date]) {
                result[parsed.date] = {};
              }

              result[parsed.date][parsed.vehicleId] = parsed;
            } catch {}
          }

          console.log("📅 Blocks loaded:", Object.keys(result).length);

          return withCors(json({ blocks: result }), corsHeaders);
        } catch (err) {
          console.error("❌ blocks fetch error:", err);

          return withCors(
            json({ error: "Failed to load blocks" }, 500),
            corsHeaders,
          );
        }
      }

      /* ===============================
   FALLBACK
=============================== */

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
   MIGRATION HELPERS
   Backup + Clear Test Data
================================ */

function requireMigrationAuth(request, env) {
  const expected = String(env.MIGRATION_TOKEN || "").trim();
  const supplied = String(
    request.headers.get("x-migration-token") ||
      new URL(request.url).searchParams.get("token") ||
      "",
  ).trim();

  if (!expected) {
    return { ok: false, error: "MIGRATION_TOKEN is not configured" };
  }

  if (!supplied || supplied !== expected) {
    return { ok: false, error: "Not authorised" };
  }

  return { ok: true };
}

async function listAllKvKeys(env, prefix) {
  const keys = [];
  let cursor = undefined;

  do {
    const page = await env.BOOKINGS_KV.list({ prefix, cursor });
    keys.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return keys;
}

async function getKvBackupForPrefix(env, prefix) {
  const keys = await listAllKvKeys(env, prefix);
  const items = [];

  for (const key of keys) {
    items.push({
      key,
      value: await env.BOOKINGS_KV.get(key),
    });
  }

  return items;
}

async function deleteKvPrefix(env, prefix) {
  const keys = await listAllKvKeys(env, prefix);
  await Promise.all(keys.map((key) => env.BOOKINGS_KV.delete(key)));
  return keys.length;
}

async function handleMigrationExportBackup(request, env) {
  const auth = requireMigrationAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const backup = {
    exportedAt: new Date().toISOString(),
    kv: {
      bookings: await getKvBackupForPrefix(env, "bookings:"),
      bookingIndexes: await getKvBackupForPrefix(env, "booking:"),
      reservations: await getKvBackupForPrefix(env, "reservation:"),
      reminders: await getKvBackupForPrefix(env, "reminder:"),
      audits: await getKvBackupForPrefix(env, "audit:"),
      sessions: await getKvBackupForPrefix(env, "session:"),
      forms: await getKvBackupForPrefix(env, "form:"),
    },
    d1: {},
  };

  try {
    backup.d1.bookings =
      (await env.DB.prepare("SELECT * FROM bookings").all()).results || [];
  } catch (err) {
    backup.d1.bookingsError = err.message;
  }

  try {
    backup.d1.customers =
      (await env.DB.prepare("SELECT * FROM customers").all()).results || [];
  } catch (err) {
    backup.d1.customersError = err.message;
  }

  try {
    backup.d1.forms =
      (await env.DB.prepare("SELECT * FROM forms").all()).results || [];
  } catch (err) {
    backup.d1.formsError = err.message;
  }

  return new Response(JSON.stringify(backup, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="etuk-pre-migration-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
    },
  });
}

async function handleMigrationClearTestData(request, env) {
  const auth = requireMigrationAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const migrationMode = String(env.MIGRATION_MODE || "").toLowerCase();

  if (migrationMode !== "true") {
    return json(
      {
        error: "MIGRATION_MODE must be true before clearing data",
      },
      400,
    );
  }

  let body = {};

  try {
    body = await request.json();
  } catch {}

  if (body.confirm !== "CLEAR_TEST_DATA") {
    return json(
      {
        error: "Missing confirmation. Send { confirm: 'CLEAR_TEST_DATA' }",
      },
      400,
    );
  }

  const report = {
    clearedAt: new Date().toISOString(),
    kv: {},
    d1: {},
  };

  report.kv.bookings = await deleteKvPrefix(env, "bookings:");
  report.kv.bookingIndexes = await deleteKvPrefix(env, "booking:");
  report.kv.reservations = await deleteKvPrefix(env, "reservation:");
  report.kv.reminders = await deleteKvPrefix(env, "reminder:");
  report.kv.audits = await deleteKvPrefix(env, "audit:");
  report.kv.sessions = await deleteKvPrefix(env, "session:");
  report.kv.forms = await deleteKvPrefix(env, "form:");

  try {
    const r = await env.DB.prepare("DELETE FROM bookings").run();
    report.d1.bookings = r.meta?.changes ?? null;
  } catch (err) {
    report.d1.bookingsError = err.message;
  }

  try {
    const r = await env.DB.prepare("DELETE FROM customers").run();
    report.d1.customers = r.meta?.changes ?? null;
  } catch (err) {
    report.d1.customersError = err.message;
  }

  try {
    const r = await env.DB.prepare("DELETE FROM forms").run();
    report.d1.forms = r.meta?.changes ?? null;
  } catch (err) {
    report.d1.formsError = err.message;
  }

  await env.BOOKINGS_KV.put("bookings:version", String(Date.now()));

  return json({ ok: true, report });
}

/* ===============================
   MIGRATION — IMPORT PLANYO PAYLOAD
================================ */

async function handleMigrationImportPlanyo(request, env) {
  const auth = requireMigrationAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const migrationMode = String(env.MIGRATION_MODE || "").toLowerCase();

  if (migrationMode !== "true") {
    return json(
      {
        error: "MIGRATION_MODE must be true before importing data",
      },
      400,
    );
  }

  let body;

  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid JSON payload", detail: err.message }, 400);
  }

  if (body.confirm !== "IMPORT_PLANYO") {
    return json(
      {
        error:
          "Missing confirmation. Send { confirm: 'IMPORT_PLANYO', ...payload }",
      },
      400,
    );
  }

  const customers = Array.isArray(body.customers) ? body.customers : [];
  const bookings = Array.isArray(body.bookings) ? body.bookings : [];

  if (!customers.length || !bookings.length) {
    return json(
      {
        error: "Payload must contain customers[] and bookings[]",
        customers: customers.length,
        bookings: bookings.length,
      },
      400,
    );
  }

  const existingBookingKeys = await listAllKvKeys(env, "bookings:");

  let existingD1Bookings = 0;
  let existingD1Customers = 0;

  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM bookings",
    ).first();
    existingD1Bookings = Number(row?.count || 0);
  } catch {}

  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM customers",
    ).first();
    existingD1Customers = Number(row?.count || 0);
  } catch {}

  if (
    body.force !== true &&
    (existingBookingKeys.length > 1 ||
      existingD1Bookings > 0 ||
      existingD1Customers > 0)
  ) {
    return json(
      {
        error:
          "System is not empty. Backup and clear test data first, or resend with force:true if you are intentionally re-importing.",
        existing: {
          kvBookingKeys: existingBookingKeys,
          d1Bookings: existingD1Bookings,
          d1Customers: existingD1Customers,
        },
      },
      409,
    );
  }

  const now = new Date().toISOString();

  const SITE_BASE =
    env.PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://kvwebservices.co.uk/equinetransportuk";

  function safeText(value) {
    if (value === undefined || value === null) return "";
    return String(value);
  }

  function safeNullable(value) {
    if (value === undefined || value === null || value === "") return null;
    return String(value);
  }

  function safeNumber(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function chunkArray(items, size = 50) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  function addLinksToBooking(booking) {
    const formType = booking.requiredFormType === "short" ? "short" : "long";
    const formBase =
      formType === "short"
        ? `${SITE_BASE}/forms/short-form.html`
        : `${SITE_BASE}/forms/long-form.html`;

    return {
      ...booking,
      requiredFormType: formType,
      requiredFormLink: `${formBase}?bookingId=${encodeURIComponent(
        booking.id,
      )}&vehicleName=${encodeURIComponent(
        booking.vehicleSnapshot?.name || booking.vehicleId || "",
      )}`,
      depositLink: `${SITE_BASE}/pay-deposit.html?bookingId=${encodeURIComponent(
        booking.id,
      )}`,
      outstandingLink: `${SITE_BASE}/pay-outstanding.html?bookingId=${encodeURIComponent(
        booking.id,
      )}`,
      migratedAt: now,
    };
  }

  const report = {
    importedAt: now,
    customers: {
      received: customers.length,
      inserted: 0,
      errors: [],
    },
    bookings: {
      received: bookings.length,
      insertedD1: 0,
      insertedKV: 0,
      errors: [],
    },
    kv: {
      monthBuckets: 0,
      versionUpdated: false,
    },
  };

  /* ===============================
     INSERT CUSTOMERS INTO D1
  =============================== */

  for (const chunk of chunkArray(customers, 50)) {
    const statements = chunk.map((customer) =>
      env.DB.prepare(
        `
        INSERT OR REPLACE INTO customers (
          id,
          full_name,
          email,
          mobile,
          address,
          dob,
          notes,
          hire_count,
          last_hire_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).bind(
        safeText(customer.id),
        safeText(customer.full_name || "Customer"),
        safeText(customer.email || ""),
        safeText(customer.mobile || ""),
        safeNullable(customer.address),
        safeNullable(customer.dob),
        safeNullable(customer.notes),
        safeNumber(customer.hire_count),
        safeNullable(customer.last_hire_at),
        safeNullable(customer.created_at) || now,
        now,
      ),
    );

    try {
      await env.DB.batch(statements);
      report.customers.inserted += chunk.length;
    } catch (err) {
      report.customers.errors.push({
        chunkSize: chunk.length,
        error: err.message,
      });
    }
  }

  /* ===============================
     ENRICH BOOKINGS + INSERT D1
  =============================== */

  const enrichedBookings = bookings.map(addLinksToBooking);

  for (const chunk of chunkArray(enrichedBookings, 50)) {
    const statements = chunk.map((booking) =>
      env.DB.prepare(
        `
        INSERT OR REPLACE INTO bookings (
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
      ).bind(
        safeText(booking.id),
        safeText(booking.customerId),
        safeText(booking.vehicleId),
        safeText(booking.pickupAt),
        safeText(booking.dropoffAt),
        safeNumber(booking.durationDays),
        safeNumber(booking.hireTotal || booking.priceTotal),
        safeNumber(booking.paidNow),
        safeText(booking.status || "confirmed"),
        safeText(booking.createdAt || now),
        now,
      ),
    );

    try {
      await env.DB.batch(statements);
      report.bookings.insertedD1 += chunk.length;
    } catch (err) {
      report.bookings.errors.push({
        chunkSize: chunk.length,
        error: err.message,
      });
    }
  }

  /* ===============================
     WRITE BOOKINGS TO KV MONTH BUCKETS
     This is what admin/calendar/availability use.
  =============================== */

  const byMonth = new Map();

  for (const booking of enrichedBookings) {
    const month = String(booking.pickupAt || "").slice(0, 7);

    if (!/^\d{4}-\d{2}$/.test(month)) {
      report.bookings.errors.push({
        bookingId: booking.id,
        error: "Invalid pickup month",
      });
      continue;
    }

    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(booking);
  }

  for (const [month, monthBookings] of byMonth.entries()) {
    monthBookings.sort(
      (a, b) => new Date(a.pickupAt).getTime() - new Date(b.pickupAt).getTime(),
    );

    await env.BOOKINGS_KV.put(
      `bookings:${month}`,
      JSON.stringify(monthBookings),
    );

    report.kv.monthBuckets += 1;
    report.bookings.insertedKV += monthBookings.length;
  }

  await env.BOOKINGS_KV.put("bookings:version", String(Date.now()));
  report.kv.versionUpdated = true;

  return json({
    ok: true,
    report,
  });
}

/* ===============================
   MIGRATION — CLEAN IMPORTED CONTACTS
   Fixes Planyo phone/email formatting after import
================================ */

function normalizeImportedEmail(value) {
  let email = String(value || "")
    .trim()
    .toLowerCase();

  // Planyo/export issue seen on import: +name@gmail.com
  if (email.startsWith("+") && email.includes("@")) {
    email = email.slice(1);
  }

  return email;
}

function normalizeImportedMobile(value) {
  let mobile = String(value || "").trim();

  if (!mobile) return "";

  mobile = mobile.replace(/\s+/g, "");

  // Planyo/import issue:
  // +4407815715944 should be +447815715944
  if (mobile.startsWith("+4407")) {
    mobile = "+44" + mobile.slice(4);
  }

  // Also protect against double-zero format if it appears.
  if (mobile.startsWith("004407")) {
    mobile = "+44" + mobile.slice(4);
  }

  return mobile;
}

async function handleMigrationCleanImportedContacts(request, env) {
  const auth = requireMigrationAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const migrationMode = String(env.MIGRATION_MODE || "").toLowerCase();

  if (migrationMode !== "true") {
    return json(
      {
        error: "MIGRATION_MODE must be true before cleaning imported contacts",
      },
      400,
    );
  }

  let body = {};

  try {
    body = await request.json();
  } catch {}

  if (body.confirm !== "CLEAN_IMPORTED_CONTACTS") {
    return json(
      {
        error:
          "Missing confirmation. Send { confirm: 'CLEAN_IMPORTED_CONTACTS' }",
      },
      400,
    );
  }

  const report = {
    cleanedAt: new Date().toISOString(),
    customers: {
      checked: 0,
      updated: 0,
      errors: [],
    },
    bookings: {
      bucketsChecked: 0,
      bookingsChecked: 0,
      bookingsUpdated: 0,
      bucketsUpdated: 0,
      errors: [],
    },
  };

  /* ===============================
     CLEAN D1 CUSTOMERS
  =============================== */

  try {
    const result =
      (
        await env.DB.prepare(
          `
        SELECT id, email, mobile
        FROM customers
      `,
        ).all()
      ).results || [];

    report.customers.checked = result.length;

    for (const row of result) {
      const nextEmail = normalizeImportedEmail(row.email);
      const nextMobile = normalizeImportedMobile(row.mobile);

      if (nextEmail !== row.email || nextMobile !== row.mobile) {
        await env.DB.prepare(
          `
          UPDATE customers
          SET email = ?, mobile = ?, updated_at = ?
          WHERE id = ?
        `,
        )
          .bind(nextEmail, nextMobile, new Date().toISOString(), row.id)
          .run();

        report.customers.updated += 1;
      }
    }
  } catch (err) {
    report.customers.errors.push(err.message);
  }

  /* ===============================
     CLEAN KV BOOKINGS
  =============================== */

  try {
    const keys = await listAllKvKeys(env, "bookings:");

    for (const key of keys) {
      // skip bookings:version
      if (!/^bookings:\d{4}-\d{2}$/.test(key)) continue;

      report.bookings.bucketsChecked += 1;

      const raw = await env.BOOKINGS_KV.get(key);
      if (!raw) continue;

      let bookings;

      try {
        bookings = JSON.parse(raw);
      } catch {
        report.bookings.errors.push(`Could not parse ${key}`);
        continue;
      }

      if (!Array.isArray(bookings)) continue;

      let changed = false;

      const nextBookings = bookings.map((booking) => {
        report.bookings.bookingsChecked += 1;

        const nextEmail = normalizeImportedEmail(booking.customerEmail);
        const nextMobile = normalizeImportedMobile(booking.customerMobile);

        if (
          nextEmail !== String(booking.customerEmail || "") ||
          nextMobile !== String(booking.customerMobile || "")
        ) {
          changed = true;
          report.bookings.bookingsUpdated += 1;

          return {
            ...booking,
            customerEmail: nextEmail,
            customerMobile: nextMobile,
            updatedAt: new Date().toISOString(),
            contactCleanedAt: new Date().toISOString(),
          };
        }

        return booking;
      });

      if (changed) {
        await env.BOOKINGS_KV.put(key, JSON.stringify(nextBookings));
        report.bookings.bucketsUpdated += 1;
      }
    }
  } catch (err) {
    report.bookings.errors.push(err.message);
  }

  await env.BOOKINGS_KV.put("bookings:version", String(Date.now()));

  return json({
    ok: true,
    report,
  });
}

/* ===============================
   MIGRATION — PATCH LIVE DATA
   Adds missing bookings + patches legacy deposits
================================ */

async function handleMigrationPatchLiveData(request, env) {
  const auth = requireMigrationAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const migrationMode = String(env.MIGRATION_MODE || "").toLowerCase();

  if (migrationMode !== "true") {
    return json(
      {
        error: "MIGRATION_MODE must be true before patching live data",
      },
      400,
    );
  }

  let body = {};

  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid JSON", detail: err.message }, 400);
  }

  if (body.confirm !== "PATCH_LIVE_DATA") {
    return json(
      {
        error: "Missing confirmation. Send { confirm: 'PATCH_LIVE_DATA' }",
      },
      400,
    );
  }

  const now = new Date().toISOString();

  const SITE_BASE =
    env.PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://kvwebservices.co.uk/equinetransportuk";

  const report = {
    patchedAt: now,
    customer: null,
    addedGeorgiaBooking: false,
    patchedDeposits: [],
    errors: [],
  };

  function buildBookingLinks(booking) {
    const formType = booking.requiredFormType === "short" ? "short" : "long";

    const formPath =
      formType === "short" ? "/forms/short-form.html" : "/forms/long-form.html";

    booking.requiredFormLink = `${SITE_BASE}${formPath}?bookingId=${encodeURIComponent(
      booking.id,
    )}&vehicleName=${encodeURIComponent(
      booking.vehicleSnapshot?.name || booking.vehicleId || "",
    )}`;

    booking.depositLink = `${SITE_BASE}/pay-deposit.html?bookingId=${encodeURIComponent(
      booking.id,
    )}`;

    booking.outstandingLink = `${SITE_BASE}/pay-outstanding.html?bookingId=${encodeURIComponent(
      booking.id,
    )}`;

    return booking;
  }

  async function upsertCustomer(customer) {
    await env.DB.prepare(
      `
      INSERT OR REPLACE INTO customers (
        id,
        full_name,
        email,
        mobile,
        address,
        dob,
        notes,
        hire_count,
        last_hire_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
      .bind(
        customer.id,
        customer.full_name,
        customer.email,
        customer.mobile,
        customer.address || null,
        customer.dob || null,
        customer.notes || null,
        Number(customer.hire_count || 1),
        customer.last_hire_at || null,
        customer.created_at || now,
        now,
      )
      .run();
  }

  async function insertBookingD1(booking) {
    await env.DB.prepare(
      `
      INSERT OR REPLACE INTO bookings (
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
        Number(booking.durationDays || 1),
        Number(booking.hireTotal || booking.priceTotal || 0),
        Number(booking.paidNow || 0),
        booking.status || "confirmed",
        booking.createdAt || now,
        now,
      )
      .run();
  }

  async function upsertBookingIntoMonthBucket(booking) {
    const month = String(booking.pickupAt || "").slice(0, 7);

    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new Error(`Invalid booking month for ${booking.id}`);
    }

    const key = `bookings:${month}`;
    const raw = await env.BOOKINGS_KV.get(key);

    let bookings = [];

    if (raw) {
      try {
        bookings = JSON.parse(raw);
        if (!Array.isArray(bookings)) bookings = [];
      } catch {
        bookings = [];
      }
    }

    const existingIndex = bookings.findIndex(
      (b) => String(b.id) === String(booking.id),
    );

    if (existingIndex >= 0) {
      bookings[existingIndex] = {
        ...bookings[existingIndex],
        ...booking,
        updatedAt: now,
      };
    } else {
      bookings.push(booking);
    }

    bookings.sort(
      (a, b) => new Date(a.pickupAt).getTime() - new Date(b.pickupAt).getTime(),
    );

    await env.BOOKINGS_KV.put(key, JSON.stringify(bookings));
  }

  async function patchDeposit(bookingId, patch) {
    const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

    let patched = false;

    for (const key of list.keys) {
      if (!/^bookings:\d{4}-\d{2}$/.test(key.name)) continue;

      const raw = await env.BOOKINGS_KV.get(key.name);
      if (!raw) continue;

      let bookings;

      try {
        bookings = JSON.parse(raw);
      } catch {
        continue;
      }

      if (!Array.isArray(bookings)) continue;

      let changed = false;

      const nextBookings = bookings.map((booking) => {
        if (String(booking.id) !== String(bookingId)) return booking;

        changed = true;
        patched = true;

        return {
          ...booking,
          depositAmount: 200,
          depositPaid: true,
          depositStatus: "legacy_authorized",
          depositLegacy: true,
          depositCapturedAmount: 0,
          depositPaymentIntentId:
            patch.depositPaymentIntentId ||
            booking.depositPaymentIntentId ||
            "",
          depositCardLast4: patch.cardLast4 || booking.depositCardLast4 || "",
          depositCardholderName:
            patch.cardholderName || booking.depositCardholderName || "",
          depositAuthorizedAt:
            patch.authorizedAt || booking.depositAuthorizedAt || now,
          updatedAt: now,
        };
      });

      if (changed) {
        await env.BOOKINGS_KV.put(key.name, JSON.stringify(nextBookings));
        report.patchedDeposits.push(bookingId);
        break;
      }
    }

    if (!patched) {
      report.errors.push(`Deposit booking not found: ${bookingId}`);
    }
  }

  /* ===============================
     1) ADD MISSING GEORGIA BOOKING
  =============================== */

  const georgiaCustomer = {
    id: "cus_planyo_P19657870",
    full_name: "Georgia Ashcroft",
    email: "georgia_ashcroft@icloud.com",
    mobile: "+447834785077",
    address: "22 Lower Village, Haywards Heath RH16 4GT, UK",
    dob: null,
    notes: "Migrated manually from Planyo missing P reservation.",
    hire_count: 1,
    last_hire_at: "2026-06-13T06:00:00Z",
    created_at: now,
  };

  try {
    await upsertCustomer(georgiaCustomer);
    report.customer = georgiaCustomer.id;
  } catch (err) {
    report.errors.push(`Georgia customer error: ${err.message}`);
  }

  let georgiaBooking = {
    id: "book_planyo_P19657870",
    legacySource: "planyo",
    legacyBookingId: "P19657870",
    legacyImported: true,
    migrationPatch: true,

    customerId: georgiaCustomer.id,
    customerName: "Georgia Ashcroft",
    customerEmail: "georgia_ashcroft@icloud.com",
    customerMobile: "+447834785077",

    vehicleId: "v35-2",
    vehicleSnapshot: {
      id: "v35-2",
      name: "3.5T Stallion Lorry",
      type: "3.5 tonne",
      code: "DL22",
    },

    pickupAt: "2026-06-13T06:00:00Z",
    dropoffAt: "2026-06-13T18:00:00Z",
    pickupAtLocal: "2026-06-13T07:00:00",
    dropoffAtLocal: "2026-06-13T19:00:00",
    durationDays: 1,
    pickupTime: "07:00",

    hireTotal: 125,
    priceTotal: 125,
    priceBase: 125,
    priceExtras: 0,
    extrasTotal: 0,
    extras: {},

    paidNow: 125,
    confirmationFee: 125,
    outstandingAmount: 0,
    outstanding: 0,
    outstandingPaid: true,

    paymentMode: "legacy_planyo",
    legacyPaymentImported: true,
    legacyPaymentNote: "Paid in Planyo / legacy migration patch.",

    depositAmount: 200,
    depositPaid: true,
    depositStatus: "legacy_authorized",
    depositLegacy: true,
    depositCapturedAmount: 0,
    depositPaymentIntentId: body.georgiaDepositPaymentIntentId || "",
    depositCardLast4: "1540",
    depositCardholderName: "Emily Stockwell",
    depositAuthorizedAt: "2026-06-03T19:13:00Z",

    formCompleted: false,
    dvlaVerified: false,
    requiredFormType: "long",

    customerNotes: "",
    adminNotes:
      "Manual migration patch: Planyo P19657870 was missing from CSV export.",

    status: "confirmed",
    createdAt: "2026-06-03T19:40:00Z",
    updatedAt: now,
  };

  georgiaBooking = buildBookingLinks(georgiaBooking);

  try {
    await insertBookingD1(georgiaBooking);
    await upsertBookingIntoMonthBucket(georgiaBooking);
    report.addedGeorgiaBooking = true;
  } catch (err) {
    report.errors.push(`Georgia booking error: ${err.message}`);
  }

  /* ===============================
     2) PATCH LORNA DEPOSIT
  =============================== */

  await patchDeposit("book_planyo_R19512237", {
    depositPaymentIntentId: body.lornaDepositPaymentIntentId || "",
    cardLast4: "3595",
    cardholderName: "Miss Lorna C Ewin",
    authorizedAt: "2026-05-28T13:04:00Z",
  });

  /* ===============================
     3) PATCH GEORGIA DEPOSIT TOO
  =============================== */

  await patchDeposit("book_planyo_P19657870", {
    depositPaymentIntentId: body.georgiaDepositPaymentIntentId || "",
    cardLast4: "1540",
    cardholderName: "Emily Stockwell",
    authorizedAt: "2026-06-03T19:13:00Z",
  });

  await env.BOOKINGS_KV.put("bookings:version", String(Date.now()));

  return json({
    ok: report.errors.length === 0,
    report,
  });
}

/* ===============================
   MIGRATION — PATCH EARLY PICKUP EXTRAS
   Adds itemised early pickup to known migrated bookings
   Does NOT change totals/paid/outstanding
================================ */

async function handleMigrationPatchEarlyPickupExtras(request, env) {
  const auth = requireMigrationAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const migrationMode = String(env.MIGRATION_MODE || "").toLowerCase();

  if (migrationMode !== "true") {
    return json(
      {
        error: "MIGRATION_MODE must be true before patching extras",
      },
      400,
    );
  }

  let body = {};

  try {
    body = await request.json();
  } catch {}

  if (body.confirm !== "PATCH_EARLY_PICKUP_EXTRAS") {
    return json(
      {
        error:
          "Missing confirmation. Send { confirm: 'PATCH_EARLY_PICKUP_EXTRAS' }",
      },
      400,
    );
  }

  const now = new Date().toISOString();

  const earlyPickupBookingIds = new Set([
    "book_planyo_R19364235", // Laura Lewis
    "book_planyo_R19451766", // Paul Hunt
    "book_planyo_R19647794", // Victoria Holden
    "book_planyo_R19656409", // Amy Howell
    "book_planyo_P19657870", // Georgia Ashcroft
  ]);

  const report = {
    patchedAt: now,
    targetCount: earlyPickupBookingIds.size,
    bookingsChecked: 0,
    bookingsPatched: 0,
    patched: [],
    missing: [],
    bucketsUpdated: 0,
    errors: [],
  };

  const found = new Set();

  try {
    const keys = await listAllKvKeys(env, "bookings:");

    for (const key of keys) {
      if (!/^bookings:\d{4}-\d{2}$/.test(key)) continue;

      const raw = await env.BOOKINGS_KV.get(key);
      if (!raw) continue;

      let bookings;

      try {
        bookings = JSON.parse(raw);
      } catch {
        report.errors.push(`Could not parse ${key}`);
        continue;
      }

      if (!Array.isArray(bookings)) continue;

      let changed = false;

      const nextBookings = bookings.map((booking) => {
        report.bookingsChecked += 1;

        if (!earlyPickupBookingIds.has(String(booking.id))) {
          return booking;
        }

        found.add(String(booking.id));
        changed = true;
        report.bookingsPatched += 1;

        const total = Number(
          booking.hireTotal || booking.priceTotal || booking.total || 0,
        );

        const existingExtras = booking.extras || {};

        return {
          ...booking,

          // Keep total/paid/outstanding exactly as imported
          hireTotal: total,
          priceTotal: total,

          // Itemise the imported paid early pickup
          extras: {
            ...existingExtras,
            dartford: Number(existingExtras.dartford || 0),
            earlyPickup: true,
            legacyUnspecified: false,
          },

          earlyPickupTotal: 20,
          dartfordTotal: Number(booking.dartfordTotal || 0),
          extrasTotal: 20 + Number(booking.dartfordTotal || 0),
          priceExtras: 20 + Number(booking.dartfordTotal || 0),

          // Base is informative only; total remains preserved
          priceBase: Math.max(
            0,
            total - 20 - Number(booking.dartfordTotal || 0),
          ),

          legacyExtrasPatched: true,
          legacyExtrasPatchNote:
            "Early pickup itemised after Planyo migration. Total/paid/outstanding preserved.",
          updatedAt: now,
        };
      });

      if (changed) {
        await env.BOOKINGS_KV.put(key, JSON.stringify(nextBookings));
        report.bucketsUpdated += 1;
      }
    }

    for (const id of earlyPickupBookingIds) {
      if (!found.has(id)) {
        report.missing.push(id);
      }
    }

    await env.BOOKINGS_KV.put("bookings:version", String(Date.now()));

    return json({
      ok: report.errors.length === 0 && report.missing.length === 0,
      report,
    });
  } catch (err) {
    report.errors.push(err.message);

    return json(
      {
        ok: false,
        report,
      },
      500,
    );
  }
}

/* ===============================
   MIGRATION — PATCH COMPLETED FORMS
   Marks known migrated bookings as form completed
================================ */

async function handleMigrationPatchCompletedForms(request, env) {
  const auth = requireMigrationAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const migrationMode = String(env.MIGRATION_MODE || "").toLowerCase();

  if (migrationMode !== "true") {
    return json(
      {
        error: "MIGRATION_MODE must be true before patching completed forms",
      },
      400,
    );
  }

  let body = {};

  try {
    body = await request.json();
  } catch {}

  if (body.confirm !== "PATCH_COMPLETED_FORMS") {
    return json(
      {
        error:
          "Missing confirmation. Send { confirm: 'PATCH_COMPLETED_FORMS' }",
      },
      400,
    );
  }

  const now = new Date().toISOString();

  const completedFormBookingIds = new Set([
    "book_planyo_R19512237", // Lorna Ewin
    "book_planyo_R19565280", // Georgie Jordan-Moore
    "book_planyo_R19364235", // Laura Lewis
    "book_planyo_P19657870", // Georgia Ashcroft
    "book_planyo_R19483765", // Carrie Thain
    "book_planyo_R19656409", // Amy Howell
    "book_planyo_R19640554", // Charlotte Eveson
  ]);

  const report = {
    patchedAt: now,
    targetCount: completedFormBookingIds.size,
    bookingsChecked: 0,
    bookingsPatched: 0,
    d1Patched: 0,
    patched: [],
    missing: [],
    bucketsUpdated: 0,
    errors: [],
  };

  const found = new Set();

  try {
    const keys = await listAllKvKeys(env, "bookings:");

    for (const key of keys) {
      if (!/^bookings:\d{4}-\d{2}$/.test(key)) continue;

      const raw = await env.BOOKINGS_KV.get(key);
      if (!raw) continue;

      let bookings;

      try {
        bookings = JSON.parse(raw);
      } catch {
        report.errors.push(`Could not parse ${key}`);
        continue;
      }

      if (!Array.isArray(bookings)) continue;

      let changed = false;

      const nextBookings = bookings.map((booking) => {
        report.bookingsChecked += 1;

        if (!completedFormBookingIds.has(String(booking.id))) {
          return booking;
        }

        found.add(String(booking.id));
        changed = true;
        report.bookingsPatched += 1;
        report.patched.push(String(booking.id));

        return {
          ...booking,
          formCompleted: true,
          formSubmitted: true,
          formSubmittedAt: booking.formSubmittedAt || now,
          legacyFormImported: true,
          legacyFormNote:
            "Form completed in previous Planyo/app system before migration.",
          updatedAt: now,
        };
      });

      if (changed) {
        await env.BOOKINGS_KV.put(key, JSON.stringify(nextBookings));
        report.bucketsUpdated += 1;
      }
    }

    for (const id of completedFormBookingIds) {
      if (!found.has(id)) {
        report.missing.push(id);
      }
    }

    /* ===============================
       Patch D1 booking flags if columns exist
    =============================== */

    for (const id of completedFormBookingIds) {
      try {
        const r = await env.DB.prepare(
          `
          UPDATE bookings
          SET form_completed = 1,
              updated_at = ?
          WHERE id = ?
        `,
        )
          .bind(now, id)
          .run();

        report.d1Patched += r.meta?.changes || 0;
      } catch (err) {
        // Some older D1 schemas may not have form_completed.
        report.errors.push(
          `D1 form_completed patch skipped for ${id}: ${err.message}`,
        );
      }
    }

    await env.BOOKINGS_KV.put("bookings:version", String(Date.now()));

    return json({
      ok: report.missing.length === 0,
      report,
    });
  } catch (err) {
    report.errors.push(err.message);

    return json(
      {
        ok: false,
        report,
      },
      500,
    );
  }
}

/* ===============================
   MIGRATION — IMPORT LEGACY FORM RECORDS
   Creates booking_forms rows from old PDF submissions
================================ */

async function handleMigrationImportLegacyFormRecords(request, env) {
  const auth = requireMigrationAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const migrationMode = String(env.MIGRATION_MODE || "").toLowerCase();

  if (migrationMode !== "true") {
    return json(
      {
        error: "MIGRATION_MODE must be true before importing legacy forms",
      },
      400,
    );
  }

  let body = {};

  try {
    body = await request.json();
  } catch {}

  if (body.confirm !== "IMPORT_LEGACY_FORM_RECORDS") {
    return json(
      {
        error:
          "Missing confirmation. Send { confirm: 'IMPORT_LEGACY_FORM_RECORDS' }",
      },
      400,
    );
  }

  const now = new Date().toISOString();

  const legacyForms = [
    {
      bookingId: "book_planyo_R19364235",
      legacyReservationId: "19364235",
      formType: "short",
      submittedAt: "2026-05-08T13:12:00Z",
      customerName: "Laura Lewis",
      customerEmail: "laura.lewis29@yahoo.com",
      customerMobile: "+447739019089",
      payload: {
        legacyFormImported: true,
        legacyFormSource: "previous_planyo_app_pdf",
        legacyFormNote:
          "Short form imported from previous Planyo/app PDF submission.",
        firstName: "Laura",
        lastName: "Lewis",
        email: "laura.lewis29@yahoo.com",
        mobile: "07739019089",
        licenceNumber: "LEWIS855294LM9KS",
        dvlaCode: "NRkbY8Gx",
        lastLongFormDate: "2026-03-07",
        dateOfThisHire: "2026-05-09",
        lastDvlaCodeDate: "2026-05-08",
        datePicker: "2026-05-08",
        legacyReservationId: "19364235",
        signatureImportedFromPdf: true,
        signatureImageAvailable: false,
      },
    },

    {
      bookingId: "book_planyo_R19483765",
      legacyReservationId: "19483765",
      formType: "long",
      submittedAt: "2026-05-17T18:13:00Z",
      customerName: "Carrie Thain",
      customerEmail: "carriethain2000@gmail.com",
      customerMobile: "+447766672038",
      payload: {
        legacyFormImported: true,
        legacyFormSource: "previous_planyo_app_pdf",
        legacyFormNote:
          "Long form imported from previous Planyo/app PDF submission.",
        firstName: "Carrie",
        lastName: "Thain",
        email: "carriethain2000@gmail.com",
        mobile: "07766672038",
        address:
          "Valley View Barn, Meres Lane, Cross in Hand, East Sussex, TN21 0UA",
        howLongHere: "2.5 years",
        occupation: "Assistant Headteacher",
        nationality: "British",
        hireFrom: "2026-06-14",
        hireUntil: "2026-06-14",
        reasonForTravel: "Horse Competition",
        travelTo: "Golden Cross Equestrian Centre",
        parkingArrangement: "",
        drivingLicenceNumber: "THAIN752087C99EH",
        dvlaCheckCode: "mPtL8KSS",
        dvlaCheckCodeDate: "2026-05-17",
        medicalOrDisability: "No",
        notifiedDvlaMedical: "No",
        issuedLicence: "No",
        medicalDetails: "",
        drivingFrequencyUk: "daily",
        drivingRegularlySince: "Since 1994",
        horseboxExperience:
          "Have driven transit vans and minibuses regularly, and horseboxes 3-4 times.",
        insuranceRefused: "No",
        insuranceCancelled: "No",
        insuranceRestrictions: "No",
        nonMotoringConvictions: "No",
        insuranceDetails: "",
        datePicker: "2026-05-17",
        legacyReservationId: "19483765",
        dvlaLicenceHolderChecked: true,
        nonDvlaLicenceHolderChecked: false,
        proofOfAddress1: true,
        proofOfAddress2: true,
        photoIdChecked: true,
        signatureImportedFromPdf: true,
        signatureImageAvailable: false,
      },
    },

    {
      bookingId: "book_planyo_R19512237",
      legacyReservationId: "19512237",
      formType: "long",
      submittedAt: "2026-05-28T13:13:00Z",
      customerName: "Lorna Ewin",
      customerEmail: "lornaewin@yahoo.co.uk",
      customerMobile: "+447815715944",
      payload: {
        legacyFormImported: true,
        legacyFormSource: "previous_planyo_app_pdf",
        legacyFormNote:
          "Long form imported from previous Planyo/app PDF submission.",
        firstName: "Lorna",
        lastName: "Ewin",
        email: "lornaewin@yahoo.co.uk",
        mobile: "07815715944",
        address: "2 BROOKLANDS COTTAGES, Coopers Wood",
        howLongHere: "20 years",
        occupation: "Facilities Manager",
        nationality: "British",
        hireFrom: "2026-06-05",
        hireUntil: "2026-06-05",
        reasonForTravel: "SOE Show",
        travelTo: "Ardingly",
        parkingArrangement:
          "A third party yard / Your own premisses / Parking on the road",
        drivingLicenceNumber: "EWIN9654139LC9VH",
        dvlaCheckCode: "xC5353mp",
        dvlaCheckCodeDate: "2026-05-28",
        medicalOrDisability: "No",
        notifiedDvlaMedical: "No",
        issuedLicence: "No",
        medicalDetails: "",
        drivingFrequencyUk: "Daily",
        drivingRegularlySince: "Since 18 yrs of age",
        horseboxExperience: "Have had my own 7.5t horseboxes",
        insuranceRefused: "No",
        insuranceCancelled: "No",
        insuranceRestrictions: "No",
        nonMotoringConvictions: "No",
        insuranceDetails: "",
        datePicker: "2026-05-28",
        legacyReservationId: "19512237",
        dvlaLicenceHolderChecked: true,
        nonDvlaLicenceHolderChecked: false,
        proofOfAddress1: true,
        proofOfAddress2: true,
        photoIdChecked: true,
        signatureImportedFromPdf: true,
        signatureImageAvailable: false,
      },
    },

    {
      bookingId: "book_planyo_R19640554",
      legacyReservationId: "19640554",
      formType: "long",
      submittedAt: "2026-06-01T10:22:00Z",
      customerName: "Charlotte Eveson",
      customerEmail: "charlotte.eveson@gmail.com",
      customerMobile: "+447930840455",
      payload: {
        legacyFormImported: true,
        legacyFormSource: "previous_planyo_app_pdf",
        legacyFormNote:
          "Long form imported from previous Planyo/app PDF submission.",
        firstName: "Charlotte",
        lastName: "Eveson",
        email: "charlotte.eveson@gmail.com",
        mobile: "07930840455",
        address: "3 Home Platt, Sharpthorne, East Grinstead RH19 4NZ, UK",
        howLongHere: "28 years",
        occupation: "HGV Driver",
        nationality: "British",
        hireFrom: "2026-07-03",
        hireUntil: "2026-07-05",
        reasonForTravel: "Holiday",
        travelTo: "Nottinghamshire",
        parkingArrangement:
          "A third party yard / Your own premisses / Parking on the road",
        drivingLicenceNumber: "EVESO960287CD9VY",
        dvlaCheckCode: "mSLQ295K",
        dvlaCheckCodeDate: "2026-06-01",
        medicalOrDisability: "No",
        notifiedDvlaMedical: "Yes",
        issuedLicence: "Yes",
        medicalDetails:
          "I have no medical conditions/disabilities that are notifiable to the DVLA",
        drivingFrequencyUk: "Daily",
        drivingRegularlySince: "11 years",
        horseboxExperience: "Used to own a 3.5T which I drove regularly",
        insuranceRefused: "No",
        insuranceCancelled: "No",
        insuranceRestrictions: "No",
        nonMotoringConvictions: "No",
        insuranceDetails: "",
        datePicker: "2026-06-01",
        legacyReservationId: "19640554",
        dvlaLicenceHolderChecked: false,
        nonDvlaLicenceHolderChecked: false,
        proofOfAddress1: true,
        proofOfAddress2: true,
        photoIdChecked: true,
        signatureImportedFromPdf: true,
        signatureImageAvailable: false,
      },
    },

    {
      bookingId: "book_planyo_R19565280",
      legacyReservationId: "19565280",
      formType: "long",
      submittedAt: "2026-06-03T09:19:00Z",
      customerName: "Georgia Jordan-Moore",
      customerEmail: "georgie.jez12@gmail.com",
      customerMobile: "+447931420612",
      payload: {
        legacyFormImported: true,
        legacyFormSource: "previous_planyo_app_pdf",
        legacyFormNote:
          "Long form imported from previous Planyo/app PDF submission.",
        firstName: "Georgia",
        lastName: "Jordan-Moore",
        email: "georgie.jez12@gmail.com",
        mobile: "07931420612",
        address: "21 Aldervale Cottages, Crowborough TN6 3BT, UK",
        howLongHere: "1 year 8 months",
        occupation: "Business relationship exec",
        nationality: "British",
        hireFrom: "2026-06-05",
        hireUntil: "2026-06-05",
        reasonForTravel: "Vet visit",
        travelTo: "Priors farm vets",
        parkingArrangement: "",
        drivingLicenceNumber: "JORDA954209GA9CS",
        dvlaCheckCode: "mLPRMDz2",
        dvlaCheckCodeDate: "2026-06-02",
        medicalOrDisability: "No",
        notifiedDvlaMedical: "No",
        issuedLicence: "No",
        medicalDetails: "",
        drivingFrequencyUk: "Everyday",
        drivingRegularlySince: "10 years",
        horseboxExperience: "Driven 3-5 times",
        insuranceRefused: "No",
        insuranceCancelled: "No",
        insuranceRestrictions: "No",
        nonMotoringConvictions: "No",
        insuranceDetails: "",
        datePicker: "2026-06-03",
        legacyReservationId: "19565280",
        dvlaLicenceHolderChecked: true,
        nonDvlaLicenceHolderChecked: false,
        proofOfAddress1: true,
        proofOfAddress2: true,
        photoIdChecked: true,
        signatureImportedFromPdf: true,
        signatureImageAvailable: false,
      },
    },

    {
      bookingId: "book_planyo_P19657870",
      legacyReservationId: "19657870",
      formType: "long",
      submittedAt: "2026-06-03T18:53:00Z",
      customerName: "Georgia Ashcroft",
      customerEmail: "georgia_ashcroft@icloud.com",
      customerMobile: "+447834785077",
      payload: {
        legacyFormImported: true,
        legacyFormSource: "previous_planyo_app_pdf",
        legacyFormNote:
          "Long form imported from previous Planyo/app PDF submission.",
        firstName: "Georgia",
        lastName: "Ashcroft",
        email: "georgia_ashcroft@icloud.com",
        mobile: "07834785077",
        address: "22 Lower Village",
        howLongHere: "23yrs",
        occupation: "Veterinary Nurse",
        nationality: "British",
        hireFrom: "2026-06-13",
        hireUntil: "2026-06-13",
        reasonForTravel: "Collection of new horse",
        travelTo: "Somerset",
        parkingArrangement:
          "A third party yard / Your own premisses / Parking on the road",
        drivingLicenceNumber: "ASHCR052020G99FT",
        dvlaCheckCode: "xyc3BWkz",
        dvlaCheckCodeDate: "2026-06-03",
        medicalOrDisability: "No",
        notifiedDvlaMedical: "No",
        issuedLicence: "No",
        medicalDetails: "",
        drivingFrequencyUk: "Multiple times Daily",
        drivingRegularlySince: "Since 2018",
        horseboxExperience:
          "Driving 7.5t for 2 years, done trailers and 3.5ts too",
        insuranceRefused: "No",
        insuranceCancelled: "No",
        insuranceRestrictions: "No",
        nonMotoringConvictions: "No",
        insuranceDetails: "",
        datePicker: "2026-06-03",
        legacyReservationId: "19657870",
        dvlaLicenceHolderChecked: true,
        nonDvlaLicenceHolderChecked: false,
        proofOfAddress1: true,
        proofOfAddress2: true,
        photoIdChecked: true,
        signatureImportedFromPdf: true,
        signatureImageAvailable: false,
      },
    },

    {
      bookingId: "book_planyo_R19656409",
      legacyReservationId: "19656409",
      formType: "long",
      submittedAt: "2026-06-03T15:43:00Z",
      customerName: "Amy Howell",
      customerEmail: "amyhowell0@gmail.com",
      customerMobile: "+447748740831",
      payload: {
        legacyFormImported: true,
        legacyFormSource: "previous_planyo_app_pdf",
        legacyFormNote:
          "Long form imported from previous Planyo/app PDF submission.",
        firstName: "Amy",
        lastName: "Howell",
        email: "amyhowell0@gmail.com",
        mobile: "07748740831",
        address: "12 Rosehip Ln, Tunbridge Wells TN2 3XU, UK",
        howLongHere: "2 years",
        occupation: "Groom",
        nationality: "British",
        hireFrom: "2026-06-28",
        hireUntil: "2026-06-28",
        reasonForTravel: "Show",
        travelTo: "South of England show ground",
        parkingArrangement:
          "A third party yard / Your own premisses / Parking on the road",
        drivingLicenceNumber: "HOWEL954080AJ9YD",
        dvlaCheckCode: "THXVRz3Q",
        dvlaCheckCodeDate: "2026-06-03",
        medicalOrDisability: "No",
        notifiedDvlaMedical: "No",
        issuedLicence: "No",
        medicalDetails: "N/A",
        drivingFrequencyUk: "Every day",
        drivingRegularlySince: "17 years",
        horseboxExperience: "Little",
        insuranceRefused: "No",
        insuranceCancelled: "No",
        insuranceRestrictions: "No",
        nonMotoringConvictions: "No",
        insuranceDetails: "",
        datePicker: "2026-06-03",
        legacyReservationId: "19656409",
        dvlaLicenceHolderChecked: true,
        nonDvlaLicenceHolderChecked: false,
        proofOfAddress1: true,
        proofOfAddress2: true,
        photoIdChecked: true,
        signatureImportedFromPdf: true,
        signatureImageAvailable: false,
      },
    },
  ];

  const report = {
    importedAt: now,
    targetCount: legacyForms.length,
    insertedForms: 0,
    d1BookingsUpdated: 0,
    kvBookingsUpdated: 0,
    bucketsUpdated: 0,
    missingBookings: [],
    errors: [],
  };

  function extractLicenceLast8(raw) {
    if (!raw) return "";
    return String(raw).replace(/\s+/g, "").toUpperCase().slice(-8);
  }

  try {
    for (const form of legacyForms) {
      const booking = await findBookingById(env, form.bookingId);

      if (!booking) {
        report.missingBookings.push(form.bookingId);
        continue;
      }

      const formId = `form_${form.bookingId}`;
      const payload = {
        ...form.payload,
        bookingId: form.bookingId,
        formType: form.formType,
      };

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
          submitted_at = excluded.submitted_at,
          updated_at = excluded.updated_at
      `,
      )
        .bind(
          formId,
          form.bookingId,
          form.formType,
          booking.customerId || null,
          form.customerName,
          form.customerEmail,
          form.customerMobile,
          JSON.stringify(payload),
          "",
          form.submittedAt,
          now,
        )
        .run();

      report.insertedForms += 1;

      const licenceRaw =
        payload.drivingLicenceNumber || payload.licenceNumber || "";
      const dvlaCode = payload.dvlaCheckCode || payload.dvlaCode || "";

      try {
        const r = await env.DB.prepare(
          `
          UPDATE bookings
          SET form_completed = 1,
              dvla_verified = 0,
              updated_at = ?
          WHERE id = ?
        `,
        )
          .bind(now, form.bookingId)
          .run();

        report.d1BookingsUpdated += r.meta?.changes || 0;
      } catch (err) {
        report.errors.push(
          `D1 booking update failed ${form.bookingId}: ${err.message}`,
        );
      }

      try {
        const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

        for (const key of list.keys) {
          if (!/^bookings:\d{4}-\d{2}$/.test(key.name)) continue;

          const raw = await env.BOOKINGS_KV.get(key.name);
          if (!raw) continue;

          let bookings;

          try {
            bookings = JSON.parse(raw);
          } catch {
            continue;
          }

          if (!Array.isArray(bookings)) continue;

          let changed = false;

          const nextBookings = bookings.map((b) => {
            if (String(b.id) !== String(form.bookingId)) return b;

            changed = true;

            return {
              ...b,
              formCompleted: true,
              formSubmitted: true,
              formType: form.formType,
              formSubmittedAt: form.submittedAt,
              formRecordId: formId,
              legacyFormImported: true,
              legacyFormSource: "previous_planyo_app_pdf",
              legacyFormNote:
                "Form data imported from previous Planyo/app PDF submission.",
              dvlaLicenceLast8: extractLicenceLast8(licenceRaw),
              dvlaCode,
              dvlaVerified: b.dvlaVerified === true ? true : false,
              updatedAt: now,
            };
          });

          if (changed) {
            await env.BOOKINGS_KV.put(key.name, JSON.stringify(nextBookings));
            report.kvBookingsUpdated += 1;
            report.bucketsUpdated += 1;
            break;
          }
        }
      } catch (err) {
        report.errors.push(
          `KV booking update failed ${form.bookingId}: ${err.message}`,
        );
      }
    }

    await env.BOOKINGS_KV.put("bookings:version", String(Date.now()));

    return json({
      ok:
        report.errors.length === 0 &&
        report.missingBookings.length === 0 &&
        report.insertedForms === legacyForms.length,
      report,
    });
  } catch (err) {
    report.errors.push(err.message);

    return json(
      {
        ok: false,
        report,
      },
      500,
    );
  }
}

/* ===============================
   PRICING + DISCOUNT ENGINE
   Vouchers are now managed from admin UI / KV only.
================================ */

/* ===============================
   ADMIN ICALENDAR FEED HELPERS
================================ */

function escapeIcsText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function formatIcsMoney(value) {
  const amount = Number(value || 0);

  if (!Number.isFinite(amount)) {
    return "£0.00";
  }

  return `£${amount.toFixed(2)}`;
}

function getBookingLorryLabel(booking) {
  const vehicleName =
    booking.vehicleSnapshot?.name ||
    booking.vehicleName ||
    booking.vehicleId ||
    "Lorry";

  const vehicleCode =
    booking.vehicleSnapshot?.code || booking.vehicleCode || booking.code || "";

  return vehicleCode ? `${vehicleCode} — ${vehicleName}` : vehicleName;
}

function getBookingExtrasText(booking) {
  const extras = booking.extras || {};
  const lines = [];

  if (extras.earlyPickup || booking.earlyPickupTotal) {
    lines.push(
      `Early pickup: ${formatIcsMoney(booking.earlyPickupTotal || 20)}`,
    );
  }

  const dartfordCount = Number(extras.dartford || 0);

  if (dartfordCount > 0) {
    lines.push(
      `Dartford crossings: ${dartfordCount} (${formatIcsMoney(
        booking.dartfordTotal || dartfordCount * 4.2,
      )})`,
    );
  }

  if (!lines.length) {
    return "None";
  }

  return lines.join("\n");
}

function bookingFormStatusText(booking) {
  if (booking.formCompleted || booking.formSubmitted) {
    return "Yes";
  }

  return "No";
}

function bookingDepositStatusText(booking) {
  if (booking.depositPaid || booking.depositStatus === "secured") {
    return "Yes";
  }

  if (booking.depositStatus) {
    return `No (${booking.depositStatus})`;
  }

  return "No";
}

async function loadAllBookingsForIcs(env) {
  const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

  const bookings = [];

  for (const key of list.keys) {
    const data = await env.BOOKINGS_KV.get(key.name);

    if (!data) continue;

    try {
      const parsed = JSON.parse(data);

      if (Array.isArray(parsed)) {
        bookings.push(...parsed);
      } else if (parsed && typeof parsed === "object") {
        bookings.push(parsed);
      }
    } catch (err) {
      console.warn("⚠️ Could not parse booking batch for ICS:", key.name);
    }
  }

  return bookings;
}

async function handleAdminBookingsIcsFeed(request, env) {
  const url = new URL(request.url);
  const token = String(url.searchParams.get("token") || "");
  const expectedToken = String(env.ICAL_FEED_TOKEN || "");

  if (!expectedToken || token !== expectedToken) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const now = new Date();

  let bookings = await loadAllBookingsForIcs(env);

  bookings = bookings
    .filter((booking) => booking && booking.pickupAt && booking.dropoffAt)
    .sort((a, b) => new Date(a.pickupAt) - new Date(b.pickupAt));

  const calendarLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Equine Transport UK//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Equine Transport UK Bookings",
    "X-WR-CALDESC:Private booking feed for Equine Transport UK admin",
    "X-WR-TIMEZONE:Europe/London",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];

  for (const booking of bookings) {
    const pickup = formatIcsDateTime(booking.pickupAt);
    const dropoff = formatIcsDateTime(booking.dropoffAt);

    if (!pickup || !dropoff) continue;

    const bookingId = String(booking.id || `booking-${pickup}`);
    const lorry = getBookingLorryLabel(booking);
    const customerName = booking.customerName || "Customer";

    const isCancelled =
      String(booking.status || "").toLowerCase() === "cancelled";

    const summary = isCancelled
      ? `CANCELLED — ${lorry} — ${customerName}`
      : `${lorry} — ${customerName}`;

    const customerNotes =
      booking.customerNotes ||
      booking.notesFromCustomer ||
      booking.notes ||
      "None";

    const adminNotes = booking.adminNotes || booking.adminNote || "";

    const descriptionLines = [
      `Booking ID: ${booking.id || "—"}`,
      `Lorry: ${lorry}`,
      `Customer: ${customerName}`,
      `Mobile: ${booking.customerMobile || "—"}`,
      `Email: ${booking.customerEmail || "—"}`,
      "",
      `Total amount: ${formatIcsMoney(
        booking.hireTotal || booking.priceTotal || booking.total,
      )}`,
      `Outstanding amount: ${formatIcsMoney(
        booking.outstandingAmount || booking.outstanding,
      )}`,
      `Deposit secured: ${bookingDepositStatusText(booking)}`,
      `Form completed: ${bookingFormStatusText(booking)}`,
      "",
      "Extras:",
      getBookingExtrasText(booking),
      "",
      "Customer notes:",
      customerNotes || "None",
    ];

    if (adminNotes) {
      descriptionLines.push("", "Admin notes:", adminNotes);
    }

    calendarLines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(bookingId)}@equinetransportuk.com`,
      `DTSTAMP:${formatIcsDateTime(now)}`,
      `DTSTART:${pickup}`,
      `DTEND:${dropoff}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(descriptionLines.join("\n"))}`,
      `LOCATION:${escapeIcsText("Equine Transport UK")}`,
      `STATUS:${isCancelled ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }

  calendarLines.push("END:VCALENDAR");

  return new Response(calendarLines.join("\r\n"), {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

const DISCOUNT_CODES = [];

async function handlePricingQuote(request, env) {
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

  if (
    Number(durationDays) === 0.5 &&
    String(vehicleId || "").startsWith("v35") &&
    isWeekendDate(pickupDate)
  ) {
    return json(
      {
        error: "Half-day hire is not available for 3.5T lorries at weekends",
      },
      400,
    );
  }

  const baseCost = calculateServerBaseCost(vehicleId, durationDays, pickupDate);

  const discount = await resolveDiscount({
    env,
    code: discountCode,
    vehicleId,
    durationDays,
    baseCost,
  });

  // ✅ Invalid / disabled / used vouchers should NOT block booking.
  // They are ignored and the customer can continue at normal price.
  let discountAmount = 0;
  let appliedDiscountCode = "";

  if (discount.error) {
    console.warn("🎟️ Voucher ignored during pricing:", discount.error);
  } else {
    discountAmount = Number(discount.discountAmount || 0);
    appliedDiscountCode =
      discountAmount > 0 ? String(discount.code || discountCode || "") : "";
  }

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
    discountCode: appliedDiscountCode,
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

async function resolveDiscount({
  env,
  code,
  vehicleId,
  durationDays,
  baseCost,
}) {
  if (!code) return { discountAmount: 0 };

  const discountCodes = await getActiveDiscountCodes(env);

  const entry = discountCodes.find(
    (d) =>
      String(d.code || "").toUpperCase() === String(code || "").toUpperCase(),
  );

  if (!entry) return { error: "Invalid code" };

  if (entry.enabled === false) {
    return { error: "Code is disabled" };
  }

  const maxUses = Number(entry.maxUses || 1);
  const usedCount = Number(entry.usedCount || 0);

  if (maxUses > 0 && usedCount >= maxUses) {
    return { error: "Code already used" };
  }

  const now = new Date();

  if (entry.expires) {
    const expiry = new Date(entry.expires + "T23:59:59");
    if (now > expiry) return { error: "Code expired" };
  }

  if (entry.vehicles !== "all" && !entry.vehicles.includes(vehicleId)) {
    return { error: "Code not valid for this vehicle" };
  }

  if (Number(durationDays) < Number(entry.minDuration || 0)) {
    return { error: "Code not valid for this duration" };
  }

  let discountAmount = 0;

  if (entry.type === "percent") {
    discountAmount = (baseCost * Number(entry.value || 0)) / 100;
  }

  if (entry.type === "fixed") {
    discountAmount = Number(entry.value || 0);
  }

  discountAmount = Math.min(discountAmount, baseCost);

  return {
    discountAmount: Number(discountAmount.toFixed(2)),
    code: entry.code,
  };
}

function isWeekendDate(dateStr) {
  if (!dateStr) return false;

  const [year, month, day] = String(dateStr).split("-").map(Number);

  if (!year || !month || !day) return false;

  const date = new Date(year, month - 1, day, 12, 0, 0);
  const weekday = date.getDay();

  return weekday === 0 || weekday === 6;
}

async function getActiveDiscountCodes(env) {
  const map = new Map();

  for (const item of DISCOUNT_CODES || []) {
    if (!item?.code) continue;
    map.set(String(item.code).toUpperCase(), {
      ...item,
      source: "code",
      enabled: item.enabled !== false,
    });
  }

  try {
    const list = await env.BOOKINGS_KV.list({ prefix: "voucher:" });

    for (const key of list.keys) {
      const raw = await env.BOOKINGS_KV.get(key.name);
      if (!raw) continue;

      try {
        const voucher = JSON.parse(raw);
        if (!voucher?.code) continue;

        // KV/admin vouchers override hardcoded vouchers with the same code.
        map.set(String(voucher.code).toUpperCase(), {
          ...voucher,
          source: "admin",
        });
      } catch {}
    }
  } catch (err) {
    console.warn("⚠️ Voucher KV load failed:", err);
  }

  return Array.from(map.values());
}

function requireAdminVoucherAuth(request, env) {
  const expected = String(env.ADMIN_VOUCHER_TOKEN || "").trim();

  if (!expected) {
    return { ok: false, error: "ADMIN_VOUCHER_TOKEN is not configured" };
  }

  const supplied = String(
    request.headers.get("x-admin-voucher-token") || "",
  ).trim();

  if (!supplied || supplied !== expected) {
    return { ok: false, error: "Not authorised" };
  }

  return { ok: true };
}

function normaliseVoucherPayload(input) {
  const code = String(input.code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");

  const type = String(input.type || "").trim();
  const value = Number(input.value || 0);
  const expires = String(input.expires || "").trim();
  const vehicleGroup = String(input.vehicleGroup || "all").trim();
  const minDuration = Number(input.minDuration || 0);
  const enabled = input.enabled !== false;
  const maxUses = Number(input.maxUses || 1);
  const usedCount = Number(input.usedCount || 0);
  if (!code) throw new Error("Voucher code required");
  if (!["fixed", "percent"].includes(type)) {
    throw new Error("Voucher type must be fixed or percent");
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Voucher value must be greater than 0");
  }
  if (type === "percent" && value > 100) {
    throw new Error("Percentage cannot be more than 100");
  }
  if (expires && Number.isNaN(new Date(expires + "T23:59:59").getTime())) {
    throw new Error("Expiry date is invalid");
  }

  let vehicles = "all";

  if (vehicleGroup === "35") {
    vehicles = ["v35-1", "v35-2", "v35-3"];
  }

  if (vehicleGroup === "75") {
    vehicles = ["v75-1", "v75-2"];
  }

  if (vehicleGroup === "all") {
    vehicles = "all";
  }

  return {
    code,
    type,
    value,
    expires,
    vehicles,
    vehicleGroup,
    minDuration,

    // ✅ one-use voucher by default
    maxUses: Number.isFinite(maxUses) && maxUses > 0 ? maxUses : 1,
    usedCount: Number.isFinite(usedCount) && usedCount >= 0 ? usedCount : 0,
    usedAt: input.usedAt || null,
    usedByBookingId: input.usedByBookingId || null,

    enabled,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function handleAdminListVouchers(request, env) {
  const auth = requireAdminVoucherAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const vouchers = await getActiveDiscountCodes(env);

  vouchers.sort((a, b) =>
    String(a.code || "").localeCompare(String(b.code || "")),
  );

  return json({ vouchers });
}

async function handleAdminSaveVoucher(request, env) {
  const auth = requireAdminVoucherAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  try {
    const body = await request.json();
    const voucher = normaliseVoucherPayload(body);

    await env.BOOKINGS_KV.put(
      `voucher:${voucher.code}`,
      JSON.stringify(voucher),
    );

    return json({ ok: true, voucher });
  } catch (err) {
    return json({ error: err.message || "Could not save voucher" }, 400);
  }
}

async function handleAdminDeleteVoucher(request, env) {
  const auth = requireAdminVoucherAuth(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  try {
    const body = await request.json();
    const code = String(body.code || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "");

    if (!code) return json({ error: "Missing voucher code" }, 400);

    await env.BOOKINGS_KV.delete(`voucher:${code}`);

    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message || "Could not delete voucher" }, 400);
  }
}

async function markVoucherUsed(env, code, bookingId) {
  const safeCode = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");

  if (!safeCode) return;

  const key = `voucher:${safeCode}`;
  const raw = await env.BOOKINGS_KV.get(key);

  if (!raw) {
    console.warn("⚠️ Voucher not found while marking used:", safeCode);
    return;
  }

  try {
    const voucher = JSON.parse(raw);

    const usedCount = Number(voucher.usedCount || 0);
    const maxUses = Number(voucher.maxUses || 1);

    voucher.usedCount = usedCount + 1;
    voucher.maxUses = Number.isFinite(maxUses) && maxUses > 0 ? maxUses : 1;
    voucher.usedAt = new Date().toISOString();
    voucher.usedByBookingId = bookingId || null;

    // ✅ disable after one use
    if (voucher.usedCount >= voucher.maxUses) {
      voucher.enabled = false;
    }

    voucher.updatedAt = new Date().toISOString();

    await env.BOOKINGS_KV.put(key, JSON.stringify(voucher));

    console.log("🎟️ Voucher marked used:", safeCode, bookingId);
  } catch (err) {
    console.error("❌ Failed to mark voucher used:", err);
  }
}

/* ===============================
   STRIPE CHECKOUT SESSION
================================ */

async function handleCreateCheckoutSession(request, env) {
  const booking = await request.json();
  const ignoreBookingId = booking.ignoreBookingId || null;
  const customerNotes = String(booking.customerNotes || "").slice(0, 500);
  const customerAddress = String(booking.customerAddress || "")
    .trim()
    .slice(0, 250);

  if (!customerAddress) {
    return json({ error: "Customer address is required" }, 400);
  }

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

  const discount = await resolveDiscount({
    env,
    code: booking.discountCode,
    vehicleId: booking.vehicleId,
    durationDays,
    baseCost,
  });

  // ✅ Invalid / disabled / already-used vouchers should NOT block checkout.
  // They are ignored and Stripe continues at the normal price.
  let discountAmount = 0;
  let appliedDiscountCode = "";

  if (discount.error) {
    console.warn("🎟️ Voucher ignored during checkout:", discount.error);
  } else {
    discountAmount = Number(discount.discountAmount || 0);
    appliedDiscountCode =
      discountAmount > 0
        ? String(discount.code || booking.discountCode || "")
        : "";
  }

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

  const rawConfirmationFee = getExpectedConfirmationFee(booking.vehicleId);

  // ✅ Pay now must never be more than the final discounted hire total
  const confirmationFee = Math.min(rawConfirmationFee, totalHire);

  const outstandingAmount = Math.max(0, totalHire - confirmationFee);

  /* ===============================
   🔒 LIVE AVAILABILITY CHECK
   Must match /api/vehicles/available.
   Checks:
   - confirmed bookings
   - temporary reservations
   - admin blocks
   - all relevant months
=============================== */

  let dropoffDate;

  if (durationDays === 0.5) {
    dropoffDate = new Date(pickupDate);
  } else {
    dropoffDate = new Date(pickupDate);
    dropoffDate.setDate(dropoffDate.getDate() + durationDays - 1);
  }

  const reservedDates = getDatesBetween(pickupDate, dropoffDate);
  const requestedSlot = getReservationSlot(durationDays, pickupTime);

  const monthKeys = [...new Set(reservedDates.map((d) => d.slice(0, 7)))];

  for (const month of monthKeys) {
    const existingMonth = await env.BOOKINGS_KV.get(`bookings:${month}`);

    if (!existingMonth) continue;

    let confirmedBookings = [];

    try {
      confirmedBookings = JSON.parse(existingMonth);
      if (!Array.isArray(confirmedBookings)) confirmedBookings = [];
    } catch {
      confirmedBookings = [];
    }

    for (const confirmed of confirmedBookings) {
      if (String(confirmed.vehicleId || "") !== String(booking.vehicleId)) {
        continue;
      }

      if (String(confirmed.status || "").toLowerCase() === "cancelled") {
        continue;
      }

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
   🔒 TEMP RESERVATIONS
=============================== */

  for (const reservedDate of reservedDates) {
    const list = await env.BOOKINGS_KV.list({
      prefix: `reservation:${booking.vehicleId}:${reservedDate}`,
    });

    for (const key of list.keys) {
      const parts = key.name.split(":");
      const reservationSlot = parts[3] || "full";

      if (slotsConflict(requestedSlot, reservationSlot)) {
        return json(
          {
            error:
              "This lorry is currently being checked out by another customer. Please try again shortly.",
          },
          409,
        );
      }
    }
  }

  /* ===============================
   🔒 ADMIN BLOCKS
=============================== */

  for (const reservedDate of reservedDates) {
    const block = await getBlockForVehicleDate(
      env,
      reservedDate,
      booking.vehicleId,
    );

    if (block && blockConflictsWithRequestedSlot(block, requestedSlot)) {
      return json(
        {
          error: "This lorry has been blocked by admin for the selected date.",
        },
        409,
      );
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

  /* ===============================
   🔒 TEMP CHECKOUT RESERVATION
   Holds selected lorry/date while customer is on Stripe.
   Auto-expires after 10 minutes.
=============================== */

  const reservationKeys = [];

  for (const reservedDate of reservedDates) {
    const reservationKey = `reservation:${booking.vehicleId}:${reservedDate}:${requestedSlot}:${bookingId}`;

    reservationKeys.push(reservationKey);

    await env.BOOKINGS_KV.put(
      reservationKey,
      JSON.stringify({
        bookingId,
        vehicleId: booking.vehicleId,
        date: reservedDate,
        slot: requestedSlot,
        createdAt: Date.now(),
      }),
      {
        expirationTtl: 10 * 60,
      },
    );
  }

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
        customerAddress,
        customerNotes,

        discountCode: appliedDiscountCode,

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
    await Promise.allSettled(
      reservationKeys.map((key) => env.BOOKINGS_KV.delete(key)),
    );

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
  const safeBookingId = String(bookingId || "").trim();

  if (!safeBookingId) return null;

  /* ===============================
     1) D1 FIRST (SOURCE OF TRUTH)
  =============================== */

  try {
    const row = await env.DB.prepare(
      `
      SELECT
        b.id,
        b.customer_id,
        b.vehicle_id,
        b.pickup_at,
        b.dropoff_at,
        b.duration_days,
        b.price_total,
        b.paid_now,
        b.status,
        b.created_at,
        b.updated_at,
        b.form_completed,
        b.dvla_verified,

        c.full_name,
        c.email,
        c.mobile
      FROM bookings b
      LEFT JOIN customers c
        ON c.id = b.customer_id
      WHERE b.id = ?
      LIMIT 1
      `,
    )
      .bind(safeBookingId)
      .first();

    if (row) {
      const booking = {
        id: row.id,
        customerId: row.customer_id,
        vehicleId: row.vehicle_id,

        vehicleSnapshot: {
          id: row.vehicle_id,
          name: "",
          type: String(row.vehicle_id || "").startsWith("v35")
            ? "3.5 tonne"
            : "7.5 tonne",
        },

        pickupAt: row.pickup_at,
        dropoffAt: row.dropoff_at,

        pickupAtLocal: row.pickup_at
          ? toLondonLocalISOString(new Date(row.pickup_at))
          : null,
        dropoffAtLocal: row.dropoff_at
          ? toLondonLocalISOString(new Date(row.dropoff_at))
          : null,

        durationDays: Number(row.duration_days || 0),
        pickupTime: row.pickup_at
          ? toLondonLocalISOString(new Date(row.pickup_at)).slice(11, 16)
          : "07:00",

        customerName: row.full_name || "",
        customerEmail: row.email || "",
        customerMobile: row.mobile || "",

        hireTotal: Number(row.price_total || 0),
        priceTotal: Number(row.price_total || 0),
        confirmationFee: Number(row.paid_now || 0),
        paidNow: Number(row.paid_now || 0),
        outstandingAmount: Math.max(
          0,
          Number(row.price_total || 0) - Number(row.paid_now || 0),
        ),
        outstanding: Math.max(
          0,
          Number(row.price_total || 0) - Number(row.paid_now || 0),
        ),

        formCompleted: row.form_completed === 1,
        dvlaVerified: row.dvla_verified === 1,

        status: row.status || "confirmed",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      /* ===============================
         2) ENRICH FROM KV IF AVAILABLE
      =============================== */

      try {
        const monthKey = `bookings:${String(booking.pickupAt || "").slice(0, 7)}`;
        const monthData = await env.BOOKINGS_KV.get(monthKey);

        if (monthData) {
          const parsed = JSON.parse(monthData);

          if (Array.isArray(parsed)) {
            const kvBooking = parsed.find(
              (b) => String(b.id) === String(safeBookingId),
            );

            if (kvBooking) {
              return {
                ...booking,
                ...kvBooking,
                id: booking.id,
                customerId: booking.customerId,
                vehicleId: booking.vehicleId,
                pickupAt: booking.pickupAt,
                dropoffAt: booking.dropoffAt,
                pickupAtLocal: booking.pickupAtLocal,
                dropoffAtLocal: booking.dropoffAtLocal,
                durationDays: booking.durationDays,
                pickupTime: kvBooking.pickupTime || booking.pickupTime,
                customerName: kvBooking.customerName || booking.customerName,
                customerEmail: kvBooking.customerEmail || booking.customerEmail,
                customerMobile:
                  kvBooking.customerMobile || booking.customerMobile,
                formCompleted:
                  kvBooking.formCompleted === true || booking.formCompleted,
                dvlaVerified:
                  kvBooking.dvlaVerified === true || booking.dvlaVerified,
              };
            }
          }
        }
      } catch (err) {
        console.log("⚠️ KV enrich failed:", err);
      }

      return booking;
    }
  } catch (err) {
    console.log("⚠️ D1 findBookingById failed:", err);
  }

  /* ===============================
     3) FALLBACK TO KV
  =============================== */

  const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

  for (const key of list.keys) {
    const data = await env.BOOKINGS_KV.get(key.name);
    if (!data) continue;

    try {
      const parsed = JSON.parse(data);

      if (Array.isArray(parsed)) {
        const found = parsed.find((b) => String(b.id) === safeBookingId);
        if (found) return found;
      }
    } catch {}
  }

  return null;
}

/* ===============================
   ADMIN BOOKING EDIT HELPERS
================================ */

function getVehicleTypeFromId(vehicleId) {
  return String(vehicleId || "").startsWith("v35") ? "3.5 tonne" : "7.5 tonne";
}

function getVehicleNameFromId(vehicleId) {
  const map = {
    "v35-1": "3.5T Safety Bar Lorry",
    "v35-2": "3.5T Stallion Lorry",
    "v35-3": "3.5T Breast Bar Lorry",
    "v75-1": "7.5T 3 Horse with Living",
    "v75-2": "7.5T 4 Horses No Living",
  };

  return map[String(vehicleId || "").trim()] || String(vehicleId || "").trim();
}

function getExpectedConfirmationFee(vehicleId) {
  const id = String(vehicleId || "").trim();
  if (id.startsWith("v35")) return 75;
  if (id.startsWith("v75")) return 100;
  return 75;
}

function getHalfDayDropoffTime(pickupTime, vehicleId) {
  if (!String(vehicleId || "").startsWith("v35")) return null;
  return pickupTime === "13:00" ? "19:00" : "13:00";
}

function getReservationSlot(durationDaysValue, pickupTimeValue) {
  if (Number(durationDaysValue) !== 0.5) return "full";
  return pickupTimeValue === "13:00" ? "pm" : "am";
}

function getBlockSlotFlags(block) {
  const slot = String(block?.slot || "full").toLowerCase();

  if (slot === "full") {
    return { full: true, am: true, pm: true };
  }

  if (slot === "am") {
    return { full: false, am: true, pm: false };
  }

  if (slot === "pm") {
    return { full: false, am: false, pm: true };
  }

  if (slot === "range") {
    const from = block?.fromTime || "07:00";
    const until = block?.untilTime || "19:00";

    const am = from < "13:00" && until > "07:00";
    const pm = from < "19:00" && until > "13:00";

    return {
      full: am && pm,
      am,
      pm,
    };
  }

  return { full: true, am: true, pm: true };
}

async function getBlockForVehicleDate(env, date, vehicleId) {
  if (!date || !vehicleId) return null;

  const raw = await env.BOOKINGS_KV.get(`block:${date}:${vehicleId}`);

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function applyBlockToBusyFlags(block, flags) {
  if (!block || !flags) return;

  const blockFlags = getBlockSlotFlags(block);

  if (blockFlags.full) {
    flags.fullBlocked = true;
    flags.amBlocked = true;
    flags.pmBlocked = true;
    return;
  }

  if (blockFlags.am) flags.amBlocked = true;
  if (blockFlags.pm) flags.pmBlocked = true;
}

function blockConflictsWithRequestedSlot(block, requestedSlot) {
  const flags = getBlockSlotFlags(block);

  if (requestedSlot === "full") {
    return flags.full || flags.am || flags.pm;
  }

  if (requestedSlot === "am") {
    return flags.full || flags.am;
  }

  if (requestedSlot === "pm") {
    return flags.full || flags.pm;
  }

  return flags.full || flags.am || flags.pm;
}

function getConfirmedSlot(confirmedBooking) {
  if (Number(confirmedBooking.durationDays) !== 0.5) return "full";
  return confirmedBooking.pickupTime === "13:00" ? "pm" : "am";
}

function getMonthKeysBetween(startIso, endIso) {
  const out = [];
  const start = new Date(startIso);
  const end = new Date(endIso);

  const cursor = new Date(start);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return out;
}

async function isAdminBookingEditAvailable(
  env,
  { bookingId, vehicleId, pickupAt, dropoffAt, durationDays, pickupTime },
) {
  const currentId = String(bookingId || "").trim();
  const requestedVehicleId = String(vehicleId || "").trim();

  const requestedDates = getDatesBetween(
    new Date(pickupAt),
    new Date(dropoffAt),
  );

  const requestedSlot = getReservationSlot(durationDays, pickupTime);
  const monthKeys = getMonthKeysBetween(pickupAt, dropoffAt);

  for (const month of monthKeys) {
    const raw = await env.BOOKINGS_KV.get(`bookings:${month}`);
    if (!raw) continue;

    let bookings = [];

    try {
      bookings = JSON.parse(raw);
    } catch {
      continue;
    }

    if (!Array.isArray(bookings)) continue;

    for (const confirmed of bookings) {
      const confirmedId = String(confirmed?.id || "").trim();

      if (!confirmedId) continue;

      // ✅ ignore the booking currently being edited
      if (confirmedId === currentId) continue;

      // ✅ only same vehicle can conflict
      if (String(confirmed.vehicleId || "") !== requestedVehicleId) continue;

      // ✅ cancelled bookings never block
      if (String(confirmed.status || "").toLowerCase() === "cancelled") {
        continue;
      }

      const confirmedDates = getDatesBetween(
        new Date(confirmed.pickupAt),
        new Date(confirmed.dropoffAt),
      );

      const confirmedSlot = getConfirmedSlot(confirmed);

      for (const d of confirmedDates) {
        if (
          requestedDates.includes(d) &&
          slotsConflict(requestedSlot, confirmedSlot)
        ) {
          return {
            ok: false,
            conflictWith: confirmedId,
          };
        }
      }
    }
  }

  /* ===============================
     🚫 ADMIN BLOCKS
  =============================== */

  for (const requestedDate of requestedDates) {
    const block = await getBlockForVehicleDate(
      env,
      requestedDate,
      requestedVehicleId,
    );

    if (!block) continue;

    if (blockConflictsWithRequestedSlot(block, requestedSlot)) {
      return {
        ok: false,
        conflictWith: `block:${requestedDate}:${requestedVehicleId}`,
      };
    }
  }

  return { ok: true };
}

async function moveBookingInKv(env, oldBooking, nextBooking) {
  const oldMonthKey = `bookings:${String(oldBooking.pickupAt || "").slice(0, 7)}`;
  const newMonthKey = `bookings:${String(nextBooking.pickupAt || "").slice(0, 7)}`;

  let oldMonthBookings = [];
  let newMonthBookings = [];

  try {
    const raw = await env.BOOKINGS_KV.get(oldMonthKey);
    if (raw) {
      oldMonthBookings = JSON.parse(raw);
      if (!Array.isArray(oldMonthBookings)) oldMonthBookings = [];
    }
  } catch {
    oldMonthBookings = [];
  }

  if (oldMonthKey === newMonthKey) {
    const updatedMonthBookings = oldMonthBookings.map((b) =>
      String(b.id) === String(nextBooking.id) ? nextBooking : b,
    );

    await env.BOOKINGS_KV.put(
      newMonthKey,
      JSON.stringify(updatedMonthBookings),
    );
    return;
  }

  try {
    const raw = await env.BOOKINGS_KV.get(newMonthKey);
    if (raw) {
      newMonthBookings = JSON.parse(raw);
      if (!Array.isArray(newMonthBookings)) newMonthBookings = [];
    }
  } catch {
    newMonthBookings = [];
  }

  const cleanedOldMonthBookings = oldMonthBookings.filter(
    (b) => String(b.id) !== String(nextBooking.id),
  );

  const cleanedNewMonthBookings = newMonthBookings.filter(
    (b) => String(b.id) !== String(nextBooking.id),
  );

  cleanedNewMonthBookings.push(nextBooking);

  await env.BOOKINGS_KV.put(
    oldMonthKey,
    JSON.stringify(cleanedOldMonthBookings),
  );
  await env.BOOKINGS_KV.put(
    newMonthKey,
    JSON.stringify(cleanedNewMonthBookings),
  );
}

/* ===============================
   ADMIN CREATE BOOKING HELPERS
   No-payment bookings created by admin
================================ */

async function upsertBookingInKv(env, booking) {
  const monthKey = `bookings:${String(booking.pickupAt || "").slice(0, 7)}`;

  let monthBookings = [];

  try {
    const raw = await env.BOOKINGS_KV.get(monthKey);

    if (raw) {
      monthBookings = JSON.parse(raw);
      if (!Array.isArray(monthBookings)) monthBookings = [];
    }
  } catch {
    monthBookings = [];
  }

  const cleaned = monthBookings.filter(
    (b) => String(b.id) !== String(booking.id),
  );

  cleaned.push(booking);

  await env.BOOKINGS_KV.put(monthKey, JSON.stringify(cleaned));
}

async function getCustomerById(env, customerId) {
  if (!customerId) return null;

  try {
    return await env.DB.prepare(
      `
      SELECT *
      FROM customers
      WHERE id = ?
      LIMIT 1
    `,
    )
      .bind(customerId)
      .first();
  } catch (err) {
    console.warn("⚠️ getCustomerById failed:", err);
    return null;
  }
}

async function sendAdminBookingLinksEmail(env, booking) {
  if (!booking?.customerEmail) {
    console.warn("⚠️ Admin booking has no customer email — email skipped");
    return false;
  }

  const emailHtml = buildModernEmail({
    title: "Equine Transport UK – Booking Links",
    customerName: booking.customerName,
    booking: {
      id: booking.id,
      vehicle: booking.vehicleSnapshot?.name || "Horsebox Hire",
      from: booking.pickupAtLocal,
      to: booking.dropoffAtLocal,
      email: booking.customerEmail,
      mobile: booking.customerMobile,
      paid: 0,
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
    subject: "Your Equine Transport UK booking links",
    html: emailHtml,
  });

  console.log("📧 Admin booking links email sent:", booking.id);

  return true;
}

/* ===============================
   ADMIN BOOKING HELPERS
   Used for no-payment admin bookings
================================ */

async function enrichBookingLinks(env, booking) {
  const SITE_BASE =
    env.PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://kvwebservices.co.uk/equinetransportuk";

  let requiredFormType = "long";

  try {
    if (booking.customerId) {
      const previous = await env.DB.prepare(
        `
        SELECT pickup_at
        FROM bookings
        WHERE customer_id = ?
          AND id != ?
          AND pickup_at < ?
        ORDER BY pickup_at DESC
        LIMIT 1
      `,
      )
        .bind(booking.customerId, booking.id, booking.pickupAt)
        .first();

      if (previous?.pickup_at) {
        const previousPickup = new Date(previous.pickup_at);
        const currentPickup = new Date(booking.pickupAt);

        const diffDays =
          (currentPickup.getTime() - previousPickup.getTime()) /
          (1000 * 60 * 60 * 24);

        if (diffDays >= 0 && diffDays <= 90) {
          requiredFormType = "short";
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ Admin form type check failed:", err);
  }

  const formBase =
    requiredFormType === "short"
      ? `${SITE_BASE}/forms/short-form.html`
      : `${SITE_BASE}/forms/long-form.html`;

  booking.requiredFormType = requiredFormType;

  booking.requiredFormLink = `${formBase}?bookingId=${encodeURIComponent(
    booking.id,
  )}&vehicleName=${encodeURIComponent(booking.vehicleSnapshot?.name || "")}`;

  booking.depositLink = `${SITE_BASE}/pay-deposit.html?bookingId=${encodeURIComponent(
    booking.id,
  )}`;

  booking.outstandingLink = `${SITE_BASE}/pay-outstanding.html?bookingId=${encodeURIComponent(
    booking.id,
  )}`;

  return booking;
}

async function handleAdminBookingUpdate(request, env) {
  try {
    const body = await request.json();

    const bookingId = String(body.bookingId || "").trim();

    /* ===============================
       🔥 NEW ACTION MODE
    =============================== */

    const action = body.action || null;
    const manualPayment = Number(body.manualPayment || 0);
    const refundAmount = Number(body.refundAmount || 0);

    const isNewAdminBooking = body.isNew === true || !bookingId;

    /* ===============================
       🆕 ADMIN CREATE BOOKING
       No Stripe payment required.
       Customer receives links by email.
    =============================== */

    if (isNewAdminBooking) {
      const vehicleId = String(body.vehicleId || "").trim();
      const pickupDate = String(body.pickupDate || "").trim();
      const pickupTime = String(body.pickupTime || "07:00").trim();
      const durationDays = Number(body.durationDays || 0);
      const hireTotal = Number(body.hireTotal || 0);
      const customerId = String(body.customerId || "").trim();
      const extras = body.extras || {};
      const adminNote = String(body.adminNote || "").trim();

      if (!vehicleId || !pickupDate || !pickupTime || !durationDays) {
        return json({ error: "Missing booking fields" }, 400);
      }

      if (!customerId) {
        return json(
          { error: "Please select or create a customer before saving." },
          400,
        );
      }

      if (!hireTotal || hireTotal <= 0) {
        return json({ error: "Invalid price" }, 400);
      }

      const customer = await getCustomerById(env, customerId);

      if (!customer) {
        return json({ error: "Customer not found" }, 404);
      }

      if (!customer.email) {
        return json(
          {
            error:
              "Customer needs an email address so form/deposit/outstanding links can be sent.",
          },
          400,
        );
      }

      if (durationDays === 0.5 && !String(vehicleId).startsWith("v35")) {
        return json(
          { error: "Half-day hire is only allowed for 3.5T vehicles" },
          400,
        );
      }

      if (
        durationDays === 0.5 &&
        String(vehicleId).startsWith("v35") &&
        isWeekendDate(pickupDate)
      ) {
        return json(
          {
            error:
              "Half-day hire is not available for 3.5T lorries at weekends",
          },
          400,
        );
      }

      if (durationDays !== 0.5 && pickupTime !== "07:00") {
        return json(
          { error: "Full-day and multi-day hires must use 07:00 pickup time" },
          400,
        );
      }

      let pickupAtDate = londonDateTimeToUtc(pickupDate, pickupTime);
      let dropoffAtDate;

      if (durationDays === 0.5) {
        const dropoffTime = getHalfDayDropoffTime(pickupTime, vehicleId);
        dropoffAtDate = londonDateTimeToUtc(pickupDate, dropoffTime);
      } else {
        const dropoffDate = new Date(`${pickupDate}T00:00:00`);
        dropoffDate.setDate(dropoffDate.getDate() + durationDays - 1);
        const dropoffDateStr = dropoffDate.toISOString().slice(0, 10);
        dropoffAtDate = londonDateTimeToUtc(dropoffDateStr, "19:00");
      }

      if (
        Number.isNaN(pickupAtDate.getTime()) ||
        Number.isNaN(dropoffAtDate.getTime())
      ) {
        return json({ error: "Invalid pickup/dropoff date" }, 400);
      }

      const pickupAt = pickupAtDate.toISOString();
      const dropoffAt = dropoffAtDate.toISOString();

      const availabilityCheck = await isAdminBookingEditAvailable(env, {
        bookingId: null,
        vehicleId,
        pickupAt,
        dropoffAt,
        durationDays,
        pickupTime,
      });

      if (!availabilityCheck.ok) {
        return json(
          {
            error: "Vehicle already booked",
            conflictWith: availabilityCheck.conflictWith,
          },
          409,
        );
      }

      const now = new Date().toISOString();

      const booking = {
        id: `book_${crypto.randomUUID()}`,

        adminCreated: true,
        paymentMode: "admin_no_payment",

        vehicleId,

        vehicleSnapshot: {
          id: vehicleId,
          name: getVehicleNameFromId(vehicleId),
          type: getVehicleTypeFromId(vehicleId),
        },

        pickupAt,
        dropoffAt,

        pickupAtLocal: toLondonLocalISOString(new Date(pickupAt)),
        dropoffAtLocal: toLondonLocalISOString(new Date(dropoffAt)),

        durationDays,
        pickupTime,

        customerId,
        customerName: customer.full_name || "Customer",
        customerEmail: customer.email || "",
        customerMobile: customer.mobile || "",

        extras,

        adminNote,
        note: adminNote,

        hireTotal,
        priceTotal: hireTotal,
        priceBase: hireTotal,
        priceExtras: 0,

        confirmationFee: 0,
        paidNow: 0,

        outstandingAmount: hireTotal,
        outstanding: hireTotal,
        outstandingPaid: false,

        depositAmount: 200,
        depositPaid: false,

        status: "admin_confirmed",

        createdAt: now,
        updatedAt: now,
      };

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
          0,
          booking.status,
          now,
          now,
        )
        .run();

      try {
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
          .bind(booking.pickupAt, now, customerId)
          .run();
      } catch (err) {
        console.warn("⚠️ Customer stats update failed:", err);
      }

      await enrichBookingLinks(env, booking);

      await upsertBookingInKv(env, booking);

      let emailSent = false;

      try {
        emailSent = await sendAdminBookingLinksEmail(env, booking);
      } catch (err) {
        console.warn("⚠️ Admin booking email failed:", err);
      }

      try {
        const auditKey = `audit:${booking.id}`;

        const audit = [
          {
            type: "admin_booking_created",
            emailSent,
            at: now,
          },
        ];

        if (adminNote) {
          audit.unshift({
            type: "admin_note_added",
            note: adminNote,
            at: now,
          });
        }

        await env.BOOKINGS_KV.put(auditKey, JSON.stringify(audit));
      } catch {}

      return json({
        ok: true,
        booking,
        emailSent,
      });
    }

    if (!bookingId) {
      return json({ error: "Missing bookingId" }, 400);
    }

    const existing = await findBookingById(env, bookingId);

    if (!existing) {
      return json({ error: "Booking not found" }, 404);
    }

    /* ===============================
   👤 TRACK ORIGINAL CUSTOMER
=============================== */

    const originalCustomerId = existing.customerId || null;

    const originalCustomerName = existing.customerName || "Unknown";

    /* ===============================
   🚚 TRACK ORIGINAL VEHICLE
=============================== */

    const originalVehicleId = String(existing.vehicleId || "").trim();

    const originalVehicleName =
      existing.vehicleSnapshot?.name ||
      VEHICLES.find((v) => v.id === originalVehicleId)?.name ||
      originalVehicleId ||
      "Unknown";

    const nextCustomerId = String(body.customerId || "").trim();

    /* ===============================
   🔥 ACTION HANDLING (FIXED)
=============================== */

    if (action) {
      const now = new Date().toISOString();

      let updated = { ...existing };

      const hireTotal = Number(updated.hireTotal || 0);
      const alreadyPaid = Number(updated.paidNow || 0);

      /* ===============================
   ❌ CANCEL
=============================== */

      if (action === "cancel") {
        updated.status = "cancelled";
        updated.cancelledAt = now;

        try {
          const auditKey = `audit:${updated.id}`;

          let audit = [];

          try {
            audit = JSON.parse(await env.BOOKINGS_KV.get(auditKey)) || [];
          } catch {}

          audit.unshift({
            type: "cancel",
            at: new Date().toISOString(),
          });

          await env.BOOKINGS_KV.put(auditKey, JSON.stringify(audit));
        } catch (err) {
          console.warn("⚠️ Audit log failed (non-blocking):", err);
        }
      }

      /* ===============================
   💳 MANUAL PAYMENT
=============================== */

      if (action === "manual_payment") {
        const existingManual = Number(updated.manualPayments || 0);

        const basePaid = Number(
          updated.confirmationFee || updated.paidNow || 0,
        );

        const paymentAmount = Number(manualPayment || 0);

        const newManual = existingManual + paymentAmount;

        updated.manualPayments = newManual;

        const totalPaid = basePaid + newManual;

        updated.paidNow = totalPaid;

        const total = Number(updated.hireTotal || 0);

        const outstanding = Math.max(0, total - totalPaid);

        updated.outstandingAmount = outstanding;
        updated.outstanding = outstanding;
        updated.outstandingPaid = outstanding === 0;

        try {
          const auditKey = `audit:${updated.id}`;

          let audit = [];

          try {
            audit = JSON.parse(await env.BOOKINGS_KV.get(auditKey)) || [];
          } catch {}

          audit.unshift({
            type: "payment",
            amount: paymentAmount,
            at: new Date().toISOString(),
          });

          await env.BOOKINGS_KV.put(auditKey, JSON.stringify(audit));
        } catch (err) {
          console.warn("⚠️ Audit log failed (non-blocking):", err);
        }
      }

      /* ===============================
     💸 REFUND
  =============================== */

      if (action === "refund") {
        const existingManual = Number(updated.manualPayments || 0);
        const basePaid = Number(updated.confirmationFee || 0);

        const newManual = Math.max(0, existingManual - refundAmount);

        updated.manualPayments = newManual;

        const totalPaid = basePaid + newManual;

        updated.paidNow = totalPaid;

        const total = Number(updated.hireTotal || 0);

        const outstanding = Math.max(0, total - totalPaid);

        updated.outstandingAmount = outstanding;
        updated.outstanding = outstanding;
        updated.outstandingPaid = outstanding === 0;

        updated.refundAmount =
          (Number(updated.refundAmount) || 0) + refundAmount;
      }

      updated.updatedAt = now;
      updated.adminEdited = true;

      await moveBookingInKv(env, existing, updated);

      console.log("✅ ADMIN ACTION:", action, bookingId);

      return json({
        ok: true,
        booking: updated,
      });
    }

    /* ===============================
       🔥 NORMAL EDIT FLOW
    =============================== */

    const vehicleId = String(body.vehicleId || "").trim();

    const pickupDate = String(body.pickupDate || "").trim();

    const pickupTime = String(body.pickupTime || "").trim();

    const durationDays = Number(body.durationDays || 0);

    const hireTotal = Number(body.hireTotal || 0);

    const extras = body.extras || {};

    const adminNote = String(body.adminNote || "").trim();

    /* ===============================
   👤 CUSTOMER
=============================== */

    const customerId = String(body.customerId || "").trim();

    const dartfordTotal = (extras.dartford || 0) * 4.2;

    const earlyPickupTotal = extras.earlyPickup ? 20 : 0;

    const extrasTotal = dartfordTotal + earlyPickupTotal;

    if (
      !vehicleId ||
      !pickupDate ||
      !pickupTime ||
      !durationDays ||
      hireTotal <= 0
    ) {
      return json({ error: "Missing or invalid edit fields" }, 400);
    }

    if (durationDays === 0.5 && !String(vehicleId).startsWith("v35")) {
      return json(
        { error: "Half-day hire is only allowed for 3.5T vehicles" },
        400,
      );
    }

    if (
      durationDays === 0.5 &&
      String(vehicleId).startsWith("v35") &&
      isWeekendDate(pickupDate)
    ) {
      return json(
        {
          error: "Half-day hire is not available for 3.5T lorries at weekends",
        },
        400,
      );
    }

    if (durationDays !== 0.5 && pickupTime !== "07:00") {
      return json(
        {
          error: "Full-day and multi-day hires must use 07:00 pickup time",
        },
        400,
      );
    }

    if (durationDays === 0.5 && !["07:00", "13:00"].includes(pickupTime)) {
      return json({ error: "Half-day pickup must be 07:00 or 13:00" }, 400);
    }

    /* ===============================
       🔒 CONCURRENT EDIT PROTECTION
    =============================== */

    if (body.updatedAt && existing.updatedAt) {
      const incoming = new Date(body.updatedAt).getTime();

      const current = new Date(existing.updatedAt).getTime();

      if (incoming < current) {
        return json(
          {
            error: "This booking was updated by someone else. Please refresh.",
          },
          409,
        );
      }
    }

    if (String(existing.status || "").toLowerCase() === "cancelled") {
      return json({ error: "Cancelled bookings cannot be edited here" }, 400);
    }

    /* ===============================
   🔥 CHANGE DETECTION
=============================== */

    const oldDartford = Number(existing.extras?.dartford || 0);

    const newDartford = Number(extras.dartford || 0);

    const oldEarly = Boolean(existing.extras?.earlyPickup);

    const newEarly = Boolean(extras.earlyPickup);

    const extrasChanged = oldDartford !== newDartford || oldEarly !== newEarly;

    const nextVehicleId = String(body.vehicleId || "").trim();

    /* ===============================
   🔥 FORCE VEHICLE CHANGE CHECK
=============================== */

    const previousVehicleId = String(
      body.originalVehicleId || existing.vehicleId || "",
    ).trim();

    const previousVehicleName = String(
      body.originalVehicleName ||
        existing.vehicleSnapshot?.name ||
        previousVehicleId ||
        "Unknown",
    ).trim();

    const vehicleChanged = previousVehicleId !== nextVehicleId;

    console.log("🚚 VEHICLE CHECK", {
      previousVehicleId,
      nextVehicleId,
      vehicleChanged,
    });

    /* ===============================
   🔒 FULLY PAID BOOKING SAFETY
   Allow operational/admin edits.
   Only block changes that alter the paid financial agreement.
================================ */

    const dateChanged =
      pickupDate !== (existing.pickupAtLocal || "").slice(0, 10);

    const timeChanged = pickupTime !== existing.pickupTime;

    const durationChanged = durationDays !== Number(existing.durationDays);

    const priceChanged = hireTotal !== Number(existing.hireTotal || 0);

    const financialChange = durationChanged || priceChanged || extrasChanged;

    /*
  Fully paid bookings may still need admin corrections:
  - lorry change
  - date/time correction
  - customer reassignment
  - DVLA/form/paper-form status
  - admin note
  - handover/admin details

  But changing duration, price or extras changes the paid agreement,
  so those should still use refund/payment tools first.
*/
    if (existing.outstandingPaid === true && financialChange) {
      return json(
        {
          error:
            "Outstanding already paid. You can save admin details, lorry, date/time, customer, form/DVLA and notes, but price, duration or extras changes need refund/payment tools first.",
        },
        400,
      );
    }

    const isEditChange =
      vehicleChanged || dateChanged || timeChanged || financialChange;

    /* ===============================
       🔥 DATE BUILD
    =============================== */

    let pickupAtDate = londonDateTimeToUtc(pickupDate, pickupTime);

    let dropoffAtDate;

    if (durationDays === 0.5) {
      const dropoffTime = getHalfDayDropoffTime(pickupTime, vehicleId);

      dropoffAtDate = londonDateTimeToUtc(pickupDate, dropoffTime);
    } else {
      const dropoffDate = new Date(pickupDate);

      dropoffDate.setDate(dropoffDate.getDate() + durationDays - 1);

      const dropoffDateStr = dropoffDate.toISOString().slice(0, 10);

      dropoffAtDate = londonDateTimeToUtc(dropoffDateStr, "19:00");
    }

    if (
      Number.isNaN(pickupAtDate.getTime()) ||
      Number.isNaN(dropoffAtDate.getTime())
    ) {
      return json({ error: "Invalid pickup/dropoff date" }, 400);
    }

    const pickupAt = pickupAtDate.toISOString();

    const dropoffAt = dropoffAtDate.toISOString();

    /* ===============================
       🔥 AVAILABILITY CHECK
    =============================== */

    const availabilityCheck = await isAdminBookingEditAvailable(env, {
      bookingId,
      vehicleId,
      pickupAt,
      dropoffAt,
      durationDays,
      pickupTime,
    });

    if (!availabilityCheck.ok) {
      return json(
        {
          error: "Vehicle already booked",
          conflictWith: availabilityCheck.conflictWith,
        },
        409,
      );
    }

    /* ===============================
       🔥 PRICING
    =============================== */

    /* ===============================
       🔥 PRICING / OUTSTANDING
       Admin-created no-payment bookings must NOT
       subtract the normal £75 / £100 confirmation fee.
    =============================== */

    const isAdminNoPaymentBooking =
      existing.adminCreated === true ||
      existing.paymentMode === "admin_no_payment" ||
      existing.status === "admin_confirmed";

    const existingPaidNow = Number(existing.paidNow || 0);
    const existingConfirmationFee = Number(existing.confirmationFee || 0);

    const amountAlreadyPaid = isAdminNoPaymentBooking
      ? existingPaidNow
      : Math.max(
          existingPaidNow,
          existingConfirmationFee,
          getExpectedConfirmationFee(vehicleId),
        );

    const baseCost = calculateServerBaseCost(
      vehicleId,
      durationDays,
      pickupDate,
    );

    const finalTotal =
      hireTotal > 0 ? hireTotal : Math.max(0, baseCost + extrasTotal);

    const outstandingAmount = Math.max(0, finalTotal - amountAlreadyPaid);

    const now = new Date().toISOString();

    /* ===============================
       🔥 UPDATE D1
    =============================== */

    await env.DB.prepare(
      `
      UPDATE bookings
      SET
        vehicle_id = ?,
        pickup_at = ?,
        dropoff_at = ?,
        duration_days = ?,
        price_total = ?,
        customer_id = ?,
        updated_at = ?
      WHERE id = ?
    `,
    )
      .bind(
        vehicleId,
        pickupAt,
        dropoffAt,
        durationDays,
        finalTotal,
        customerId || existing.customerId || null,
        now,
        bookingId,
      )
      .run();

    /* ===============================
   👤 LOAD CUSTOMER NAME
=============================== */
    let customerName = existing.customerName;
    let customerEmail = existing.customerEmail;
    let customerMobile = existing.customerMobile;

    if (customerId) {
      try {
        const customer = await env.DB.prepare(
          "SELECT * FROM customers WHERE id = ?",
        )
          .bind(customerId)
          .first();

        if (customer?.full_name) {
          customerName = customer.full_name;
        }

        if (customer?.email) {
          customerEmail = customer.email;
        }

        if (customer?.mobile) {
          customerMobile = customer.mobile;
        }
      } catch (err) {
        console.warn("⚠️ Customer lookup failed:", err);
      }
    }

    /* ===============================
       🔥 BUILD UPDATED OBJECT
    =============================== */

    const nextBooking = {
      ...existing,

      vehicleId,

      vehicleSnapshot: {
        id: vehicleId,
        name: getVehicleNameFromId(vehicleId),
        type: getVehicleTypeFromId(vehicleId),
      },

      pickupAt,
      dropoffAt,
      durationDays,
      pickupTime,

      hireTotal: finalTotal,
      priceTotal: finalTotal,

      paidNow: amountAlreadyPaid,

      outstandingAmount,
      outstanding: outstandingAmount,
      outstandingPaid: outstandingAmount === 0,

      customerId: customerId || existing.customerId || null,

      customerName,
      customerEmail,
      customerMobile,

      updatedAt: now,

      adminNote,
      note: adminNote,

      extras,
      dartfordTotal,
      earlyPickupTotal,
      extrasTotal,
    };

    /* ===============================
   👤 CUSTOMER CHANGE AUDIT
=============================== */

    if (customerId && customerId !== originalCustomerId) {
      try {
        const auditKey = `audit:${existing.id}`;

        let audit = [];

        try {
          audit = JSON.parse(await env.BOOKINGS_KV.get(auditKey)) || [];
        } catch {}

        audit.unshift({
          type: "customer_changed",

          fromCustomerId: originalCustomerId,
          fromCustomerName: originalCustomerName,

          toCustomerId: customerId,
          toCustomerName: customerName,

          at: new Date().toISOString(),
        });

        await env.BOOKINGS_KV.put(auditKey, JSON.stringify(audit));
      } catch (err) {
        console.warn("⚠️ Customer audit failed:", err);
      }
    }

    /* ===============================
   🧾 AUDIT: EXTRAS CHANGED
=============================== */

    if (extrasChanged) {
      try {
        const auditKey = `audit:${bookingId}`;

        let audit = [];

        try {
          audit = JSON.parse(await env.BOOKINGS_KV.get(auditKey)) || [];
        } catch {}

        audit.unshift({
          type: "extras_changed",

          fromDartford: oldDartford,
          toDartford: newDartford,

          fromEarlyPickup: oldEarly,
          toEarlyPickup: newEarly,

          at: new Date().toISOString(),
        });

        await env.BOOKINGS_KV.put(auditKey, JSON.stringify(audit));
      } catch (err) {
        console.warn("⚠️ Extras audit failed:", err);
      }
    }

    /* ===============================
       📝 AUDIT: ADMIN NOTE CHANGED
    =============================== */

    const oldAdminNote = String(
      existing.adminNote || existing.note || "",
    ).trim();
    const newAdminNote = String(adminNote || "").trim();

    if (oldAdminNote !== newAdminNote) {
      try {
        const auditKey = `audit:${bookingId}`;

        let audit = [];

        try {
          audit = JSON.parse(await env.BOOKINGS_KV.get(auditKey)) || [];
        } catch {}

        audit.unshift({
          type: oldAdminNote ? "admin_note_changed" : "admin_note_added",
          fromNote: oldAdminNote,
          toNote: newAdminNote,
          note: newAdminNote,
          at: new Date().toISOString(),
        });

        await env.BOOKINGS_KV.put(auditKey, JSON.stringify(audit));
      } catch (err) {
        console.warn("⚠️ Admin note audit failed:", err);
      }
    }

    /* ===============================
   🔥 SAVE BOOKING FIRST
=============================== */

    await enrichBookingLinks(env, nextBooking);

    await moveBookingInKv(env, existing, nextBooking);

    /* ===============================
       📧 CUSTOMER REASSIGNED
       Send links to the new customer automatically.
    =============================== */

    if (customerId && customerId !== originalCustomerId) {
      try {
        await sendAdminBookingLinksEmail(env, nextBooking);
      } catch (err) {
        console.warn("⚠️ Customer reassignment email failed:", err);
      }
    }

    /* ===============================
   🧾 AUDIT: FINAL EDIT CHANGES
=============================== */

    try {
      const auditKey = `audit:${bookingId}`;

      let audit = [];

      try {
        audit = JSON.parse(await env.BOOKINGS_KV.get(auditKey)) || [];
      } catch {
        audit = [];
      }

      /* ===============================
   🚚 LORRY CHANGED
=============================== */

      const oldVehicleId = String(
        body.originalVehicleId || existing.vehicleId || "",
      ).trim();

      const newVehicleId = String(vehicleId || "").trim();

      console.log("🚚 VEHICLE CHECK:", {
        oldVehicleId,
        newVehicleId,
      });

      if (oldVehicleId && newVehicleId && oldVehicleId !== newVehicleId) {
        const fromVehicleName =
          body.originalVehicleName ||
          getVehicleNameFromId(oldVehicleId) ||
          "Unknown";

        const toVehicleName = getVehicleNameFromId(newVehicleId) || "Unknown";

        audit.unshift({
          type: "vehicle_changed",

          fromVehicleId: oldVehicleId,
          toVehicleId: newVehicleId,

          fromVehicle: fromVehicleName,
          toVehicle: toVehicleName,

          at: new Date().toISOString(),
        });

        console.log("✅ VEHICLE AUDIT ADDED", {
          fromVehicleName,
          toVehicleName,
        });
      }

      /* ===============================
     ⏱️ DURATION CHANGED
  =============================== */

      if (Number(existing.durationDays) !== Number(durationDays)) {
        audit.unshift({
          type: "duration_changed",
          fromDuration: Number(existing.durationDays),
          toDuration: Number(durationDays),
          at: new Date().toISOString(),
        });

        console.log("✅ DURATION AUDIT ADDED");
      }

      await env.BOOKINGS_KV.put(auditKey, JSON.stringify(audit));
    } catch (err) {
      console.error("❌ FINAL EDIT AUDIT FAILED:", err);
    }

    return json({
      ok: true,
      booking: nextBooking,
    });
  } catch (err) {
    console.error("❌ ADMIN BOOKING UPDATE ERROR:", err);

    return json(
      {
        error: "Failed to update booking",
        detail: err?.message || "Unknown error",
      },
      500,
    );
  }
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

  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      sig,
      env.STRIPE_WEBHOOK_SECRET,
    );

    console.log("📩 STRIPE EVENT TYPE:", event?.type);
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

      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null;

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
                /* ===============================
     ✅ OUTSTANDING FULLY PAID
  =============================== */

                b.outstandingPaid = true;

                b.outstandingAmount = 0;

                b.outstanding = 0;

                /* ===============================
     🔥 SAVE SECOND PAYMENT INTENT
  =============================== */

                b.outstandingSessionPaymentIntentId = paymentIntentId;

                /* ===============================
     🔥 SAVE OUTSTANDING PAYMENT VALUE
  =============================== */

                b.outstandingAmountPaid =
                  Number(session.amount_total || 0) / 100;

                console.log("💰 Outstanding payment stored:", {
                  paymentIntent: b.outstandingSessionPaymentIntentId,
                  amount: b.outstandingAmountPaid,
                });
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

        paymentIntentId,

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
        customerAddress: session.metadata.customerAddress || "",
        customerNotes,
        priceBase: baseCost,
        priceExtras: extrasTotal,
        priceTotal: totalHire,
        paidNow: confirmationFee,
        outstanding: outstandingAmount,

        baseCost,
        discountAmount,
        discountCode: session.metadata.discountCode || "",

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
  id, full_name, email, mobile, address, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          )
            .bind(
              customerId,
              finalCustomerName || "Customer",
              booking.customerEmail,
              booking.customerMobile,
              booking.customerAddress || null,
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

      /* ===============================
       🏠 UPDATE CUSTOMER ADDRESS
       If customer already exists but address is missing/changed
    =============================== */

      if (
        customer &&
        customer.id &&
        booking.customerAddress &&
        String(customer.address || "").trim() !==
          String(booking.customerAddress).trim()
      ) {
        console.log("🏠 Updating customer address:", customer.id);

        await env.DB.prepare(
          `
        UPDATE customers
        SET address = ?, updated_at = ?
        WHERE id = ?
      `,
        )
          .bind(booking.customerAddress, new Date().toISOString(), customer.id)
          .run();

        customer.address = booking.customerAddress;
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
   Long form by default.
   Short form only if the customer had a PREVIOUS hire
   before this booking and within the last 90 days.
=============================== */

      let requiredFormType = "long";

      try {
        if (booking.customerId) {
          const currentPickup = new Date(booking.pickupAt);

          const result = await env.DB.prepare(
            `
      SELECT id, pickup_at
      FROM bookings
      WHERE customer_id = ?
        AND id != ?
        AND pickup_at < ?
        AND COALESCE(status, '') != 'cancelled'
      ORDER BY pickup_at DESC
      LIMIT 1
    `,
          )
            .bind(booking.customerId, booking.id, booking.pickupAt)
            .first();

          if (result?.pickup_at) {
            const previousPickup = new Date(result.pickup_at);

            const diffDays =
              (currentPickup.getTime() - previousPickup.getTime()) /
              (1000 * 60 * 60 * 24);

            console.log("🧪 FORM CHECK:", {
              previousBookingId: result.id,
              previousPickup: result.pickup_at,
              currentPickup: booking.pickupAt,
              diffDays,
            });

            if (diffDays >= 0 && diffDays <= 90) {
              requiredFormType = "short";
            }
          } else {
            console.log(
              "🧪 FORM CHECK: no previous hire found — long form required",
            );
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

      await clearBookingReservations(env, booking.id);

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

      /* ===============================
         🎟️ MARK VOUCHER USED
         Only after normal booking was successfully created
      =============================== */

      if (booking.discountCode) {
        await markVoucherUsed(env, booking.discountCode, booking.id);
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
   🔐 ENRICH WITH DVLA STATUS
   Chunked to avoid D1 SQL variable limit
================================ */

  const ids = bookings.map((b) => b.id).filter(Boolean);

  let dvlaMap = {};

  if (ids.length) {
    const chunkSize = 80;

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");

      try {
        const result = await env.DB.prepare(
          `
        SELECT
          id,
          dvla_verified
        FROM bookings
        WHERE id IN (${placeholders})
      `,
        )
          .bind(...chunk)
          .all();

        for (const row of result.results || []) {
          dvlaMap[row.id] = row.dvla_verified === 1;
        }
      } catch (err) {
        console.warn("⚠️ DVLA chunk load failed:", err.message);
      }
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

      // ✅ D1 value wins, then fallback to existing KV value
      dvlaVerified:
        dvlaMap[booking.id] ??
        (booking.dvla_verified === 1 || booking.dvlaVerified === true),
    };
  });

  return json({
    bookings: transformedBookings,
    reservations,
  });
}

async function handleBookingBySession(request, env) {
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
   SESSION ID
================================ */

  const url = new URL(request.url);
  const sessionId = String(url.searchParams.get("session_id") || "").trim();

  if (!sessionId) {
    return json({ error: "Missing session_id" }, 400);
  }

  /* ===============================
   ⚡ FAST PATH — SESSION → BOOKING KV
   Webhook saves this as session:{session.id}
================================ */

  const sessionKey = `session:${sessionId}`;

  try {
    const cached = await env.BOOKINGS_KV.get(sessionKey);

    if (cached) {
      const booking = JSON.parse(cached);

      console.log("⚡ Booking by session fast path:", sessionKey);

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
    console.log("⚠️ Session cache lookup failed:", err);
  }

  /* ===============================
   STRIPE LOOKUP (fallback)
================================ */

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "Stripe not configured" }, 500);
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
  });

  let session;

  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.log("❌ Stripe lookup failed:", {
      sessionId,
      message: err?.message,
      type: err?.type,
      code: err?.code,
      statusCode: err?.statusCode,
    });

    return json(
      {
        found: false,
        notReady: true,
        error: "Stripe lookup failed",
        detail: err?.message || "Unknown Stripe error",
      },
      200,
    );
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

  /* ===============================
     🚫 ADMIN BLOCKS
  =============================== */

  const blockList = await env.BOOKINGS_KV.list({ prefix: "block:" });

  for (const key of blockList.keys) {
    const raw = await env.BOOKINGS_KV.get(key.name);
    if (!raw) continue;

    try {
      const block = JSON.parse(raw);

      if (!block.date || block.date < fromParam || block.date > toParam) {
        continue;
      }

      availability.push({
        vehicleId: block.vehicleId,
        date: block.date,
        slot: block.slot || "full",
        status: "blocked",
        reason: block.reason || "",
        note: block.note || "",
        fromTime: block.fromTime || "",
        untilTime: block.untilTime || "",
      });
    } catch {}
  }

  return json({ availability });
}

async function handleVehicleAvailability(request, env) {
  const url = new URL(request.url);
  const ignoreBookingId = url.searchParams.get("ignoreBookingId");

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
        // 🔥 CRITICAL FIX — ignore current booking
        if (ignoreBookingId && String(b.id) === String(ignoreBookingId)) {
          continue;
        }

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

      const block = await getBlockForVehicleDate(env, date, vehicleId);

      applyBlockToBusyFlags(block, {
        get fullBlocked() {
          return fullBlocked;
        },
        set fullBlocked(value) {
          fullBlocked = value;
        },
        get amBlocked() {
          return amBlocked;
        },
        set amBlocked(value) {
          amBlocked = value;
        },
        get pmBlocked() {
          return pmBlocked;
        },
        set pmBlocked(value) {
          pmBlocked = value;
        },
      });

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
          // 🔥 CRITICAL FIX — ignore current booking
          if (ignoreBookingId && String(b.id) === String(ignoreBookingId)) {
            continue;
          }

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

        const block = await getBlockForVehicleDate(
          env,
          requestedDate,
          vehicleId,
        );

        applyBlockToBusyFlags(block, {
          get fullBlocked() {
            return fullBlocked;
          },
          set fullBlocked(value) {
            fullBlocked = value;
          },
          get amBlocked() {
            return amBlocked;
          },
          set amBlocked(value) {
            amBlocked = value;
          },
          get pmBlocked() {
            return pmBlocked;
          },
          set pmBlocked(value) {
            pmBlocked = value;
          },
        });

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

  /* ===============================
     🔥 LOAD RELEVANT MONTH KEYS (FIX)
  =============================== */

  const monthDate = new Date(month + "-01");

  const prevMonth = new Date(monthDate);
  prevMonth.setMonth(prevMonth.getMonth() - 1);

  const nextMonth = new Date(monthDate);
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  const monthKeys = [
    `bookings:${month}`,
    `bookings:${prevMonth.toISOString().slice(0, 7)}`,
    `bookings:${nextMonth.toISOString().slice(0, 7)}`,
  ];

  let bookings = [];

  for (const key of monthKeys) {
    const raw = await env.BOOKINGS_KV.get(key);

    try {
      const parsed = JSON.parse(raw || "[]");
      if (Array.isArray(parsed)) bookings.push(...parsed);
    } catch {}
  }

  /* ===============================
     🔥 LOAD BLOCKS (NEW)
  =============================== */

  const blockList = await env.BOOKINGS_KV.list({
    prefix: "block:",
  });

  const blocks = [];

  for (const key of blockList.keys) {
    const parts = key.name.split(":");
    const date = parts[1];

    if (!date || !date.startsWith(month)) continue;

    const raw = await env.BOOKINGS_KV.get(key.name);
    if (!raw) continue;

    try {
      blocks.push(JSON.parse(raw));
    } catch {}
  }

  /* ===============================
     🔥 BUILD DAY MAP
  =============================== */

  const daysMap = {};

  /* ===== BOOKINGS ===== */

  for (const b of bookings) {
    if (!b.pickupAt || !b.vehicleId) continue;
    if (String(b.status).toLowerCase() === "cancelled") continue;

    const start = new Date(b.pickupAt);
    const end = b.dropoffAt ? new Date(b.dropoffAt) : new Date(b.pickupAt);

    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().slice(0, 10);

      if (!dateStr.startsWith(month)) {
        current.setDate(current.getDate() + 1);
        continue;
      }

      if (!daysMap[dateStr]) daysMap[dateStr] = {};

      if (!daysMap[dateStr][b.vehicleId]) {
        daysMap[dateStr][b.vehicleId] = {
          full: false,
          am: false,
          pm: false,
          source: "booking", // 🔥 track source
          bookingId: b.id,
        };
      }

      if (Number(b.durationDays) !== 0.5) {
        daysMap[dateStr][b.vehicleId].full = true;
      } else {
        if (b.pickupTime === "13:00") {
          daysMap[dateStr][b.vehicleId].pm = true;
        } else {
          daysMap[dateStr][b.vehicleId].am = true;
        }
      }

      current.setDate(current.getDate() + 1);
    }
  }

  /* ===== BLOCKS ===== */

  for (const block of blocks) {
    if (!block.date || !block.vehicleId) continue;

    if (!daysMap[block.date]) daysMap[block.date] = {};

    if (!daysMap[block.date][block.vehicleId]) {
      daysMap[block.date][block.vehicleId] = {
        full: false,
        am: false,
        pm: false,
      };
    }

    const entry = daysMap[block.date][block.vehicleId];

    entry.source = "block"; // 🔥 override
    entry.reason = block.reason || "";
    entry.note = block.note || "";

    if (block.slot === "full") {
      entry.full = true;
      entry.am = true;
      entry.pm = true;
    } else if (block.slot === "am") {
      entry.am = true;
    } else if (block.slot === "pm") {
      entry.pm = true;
    } else if (block.slot === "range") {
      const flags = getBlockSlotFlags(block);

      entry.full = flags.full;
      entry.am = flags.am;
      entry.pm = flags.pm;
    }
  }

  /* ===============================
     🔥 BUILD FINAL DAYS ARRAY
  =============================== */

  const days = [];

  const start = new Date(month + "-01");
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setDate(0);

  const current = new Date(start);

  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);

    const vehicleData = daysMap[dateStr] || {};

    days.push({
      date: dateStr,
      vehicles: vehicles.map((v) => {
        const status = vehicleData[v] || {
          full: false,
          am: false,
          pm: false,
        };

        return {
          vehicleId: v,
          full: status.full,
          am: status.am,
          pm: status.pm,
          source: status.source || null, // 🔥 NEW
          bookingId: status.bookingId || null,
          reason: status.reason || null,
          note: status.note || null,
        };
      }),
    });

    current.setDate(current.getDate() + 1);
  }

  console.log("📅 Month availability built:", days.length);

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
  try {
    /* ===============================
       🔥 CLEAN INPUT
    =============================== */

    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanMobile = mobile ? String(mobile).trim() : null;

    console.log("🔎 LOOKUP INPUT:", { cleanEmail, cleanMobile });

    /* ===============================
       🔥 SINGLE QUERY (FIXED)
    =============================== */

    const result = await env.DB.prepare(
      `
      SELECT *
      FROM customers
      WHERE
        (email IS NOT NULL AND LOWER(email) = ?)
        OR
        (mobile IS NOT NULL AND mobile = ?)
      LIMIT 1
    `,
    )
      .bind(cleanEmail || "", cleanMobile || "")
      .first();

    console.log("🔎 LOOKUP RESULT:", result);

    return result || null;
  } catch (err) {
    console.error("❌ CUSTOMER LOOKUP FAILED:", err);
    return null;
  }
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
  // full day blocks everything
  if (a === "full" || b === "full") return true;

  // same half-day slot blocks
  if (a === b) return true;

  // am + pm can share same day
  return false;
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

const EMAIL_BRAND_BLOCK = `
  <div style="
    margin:0 0 24px;
    padding:18px 22px;
    background:#ffffff;
    border:1px solid #dbe1e8;
    border-radius:22px;
  ">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
      <tr>
        <td width="18%" style="vertical-align:middle;font-size:0;line-height:0;">
          &nbsp;
        </td>

        <td width="64%" style="vertical-align:middle;text-align:center;">
          <div style="
            font-size:30px;
            font-weight:900;
            color:#1d2530;
            line-height:1.12;
            letter-spacing:0.5px;
          ">
            Equine Transport UK
          </div>

          <div style="
            margin-top:8px;
            font-size:15px;
            font-weight:800;
            color:#5a6675;
            line-height:1.35;
          ">
            Part of the East Grinstead Tyre Service Group
          </div>

          <div style="
            margin-top:8px;
            font-size:17px;
            font-weight:900;
            color:#2f6fe4;
            line-height:1.35;
          ">
            Self Drive or Driven
          </div>
        </td>

        <td width="18%" style="vertical-align:middle;text-align:right;">
          <img
            src="https://kvwebservices.co.uk/equinetransportuk/images/logo.png"
            alt="Equine Transport UK"
            style="
              display:block;
              width:104px;
              max-width:104px;
              height:auto;
              margin-left:auto;
            "
          >
        </td>
      </tr>
    </table>
  </div>
`;

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


            ${EMAIL_BRAND_BLOCK}

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
   Thank you for your booking with <strong>Equine Transport UK</strong>,
part of the <strong>East Grinstead Tyre Service Group</strong>.
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

            <!-- PICKUP LOCATION -->
      <div style="
        margin:30px 0 0;
        padding:18px;
        border:1px solid #dbe1e8;
        border-radius:16px;
        background:#f8fafc;
      ">
        <h3 style="
          margin:0 0 10px;
          font-size:20px;
          color:#1d2530;
        ">
          Pickup Location
        </h3>

        <p style="
          margin:0 0 14px;
          font-size:15px;
          line-height:1.6;
          color:#374151;
        ">
          Please collect the lorry from:
        </p>

        <div style="
          padding:16px;
          border-radius:14px;
          background:#ffffff;
          border:1px solid #e5e7eb;
          line-height:1.6;
          color:#1f2937;
          font-size:15px;
        ">
          <strong>Equine Transport UK</strong><br>
          Upper Broadreed Farm<br>
          Stonehurst Lane<br>
          Five Ashes<br>
          TN20 6LL<br>
          United Kingdom
        </div>

        <p style="
          margin:14px 0 0;
          font-size:14px;
          line-height:1.6;
          color:#5a6675;
        ">
          Tap the button below for directions. Please come to the yard.
        </p>

        <div style="margin-top:16px;">
          <a
            href="https://www.google.com/maps/search/?api=1&query=Equine%20Transport%20UK%2C%20Upper%20Broadreed%20Farm%2C%20Stonehurst%20Lane%2C%20Five%20Ashes%2C%20TN20%206LL"
            target="_blank"
            style="
              display:inline-block;
              padding:13px 18px;
              border-radius:12px;
              background:#1f6feb;
              color:#ffffff;
              text-decoration:none;
              font-weight:700;
              font-size:15px;
            "
          >
            Open in Google Maps
          </a>
        </div>
      </div>

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
  Part of the East Grinstead Tyre Service Group<br>
  <strong>Self Drive or Driven</strong><br>
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

  ${EMAIL_BRAND_BLOCK}

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
           PICKUP LOCATION
      =============================== -->

      <div style="
        margin-top:28px;
        padding:18px;
        border:1px solid #dbe1e8;
        border-radius:16px;
        background:#f8fafc;
      ">
        <h3 style="
          margin:0 0 10px;
          font-size:20px;
          color:#1d2530;
        ">
          Location
        </h3>

        <p style="
          margin:0 0 14px;
          font-size:15px;
          line-height:1.6;
          color:#374151;
        ">
          Please collect the lorry from:
        </p>

        <div style="
          padding:16px;
          border-radius:14px;
          background:#ffffff;
          border:1px solid #e5e7eb;
          line-height:1.6;
          color:#1f2937;
          font-size:15px;
        ">
          <strong>Equine Transport UK</strong><br>
          Upper Broadreed Farm<br>
          Stonehurst Lane<br>
          Five Ashes<br>
          TN20 6LL<br>
          United Kingdom<br><br>
          <strong>Tel:</strong> 07812 188871
        </div>

        <p style="
          margin:14px 0 0;
          font-size:14px;
          line-height:1.6;
          color:#5a6675;
        ">
          Tap the button below for directions. Please come to the yard.
        </p>

        <div style="margin-top:16px;">
          <a
            href="https://www.google.com/maps/search/?api=1&query=Equine%20Transport%20UK%2C%20Upper%20Broadreed%20Farm%2C%20Stonehurst%20Lane%2C%20Five%20Ashes%2C%20TN20%206LL"
            target="_blank"
            style="
              display:inline-block;
              padding:13px 18px;
              border-radius:12px;
              background:#1f6feb;
              color:#ffffff;
              text-decoration:none;
              font-weight:700;
              font-size:15px;
            "
          >
            Open in Google Maps
          </a>
        </div>
      </div>

      <!-- ===============================
           FOOTER
      =============================== -->

      <p style="margin-top:30px;">
  With kind regards,<br>
  Koos & Avril<br>
  Equine Transport UK<br>
  <span style="color:#5a6675;font-size:13px;">
    Part of the East Grinstead Tyre Service Group<br>
    Self Drive or Driven
  </span>
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
    "access-control-allow-headers":
      "content-type,stripe-signature,x-admin-voucher-token",
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

    /* ===============================
   🔥 FIND BOOKING (D1 + KV SAFE)
=============================== */

    const booking = await findBookingById(env, bookingId);

    if (!booking) {
      console.log("❌ FORM: booking not found", bookingId);
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
   UPDATE BOOKING IN KV (BULLETPROOF)
=============================== */

    try {
      let updated = false;

      const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

      for (const key of list.keys) {
        const raw = await env.BOOKINGS_KV.get(key.name);
        if (!raw) continue;

        let parsed;

        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }

        if (!Array.isArray(parsed)) continue;

        const next = parsed.map((b) => {
          if (String(b.id) !== String(bookingId)) return b;

          updated = true;

          return {
            ...b,
            formCompleted: true,
            formType,
            formSubmittedAt: now,
            formRecordId: formId,
            dvlaLicenceLast8: licenceLast8 || "",
            dvlaCode: dvlaCode || "",
            dvlaVerified: b.dvlaVerified === true ? true : false,
          };
        });

        if (updated) {
          await env.BOOKINGS_KV.put(key.name, JSON.stringify(next));
          console.log("✅ KV updated (scan fallback):", bookingId);
          break;
        }
      }

      if (!updated) {
        console.log(
          "⚠️ KV booking not found (still OK, D1 is source of truth)",
        );
      }
    } catch (err) {
      console.log("⚠️ KV update failed:", err);
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
      booking, // ✅ ADD THIS
    });
  } catch (err) {
    console.error("❌ FORM ERROR:", err);

    return json({ error: "Form submission failed" }, 500);
  }
}

/* ===============================
   ADMIN HANDOVER / DAMAGE REPORT
   STEP 1A — KV LOAD/SAVE SHELL ONLY

   Routes:
   GET  /api/admin/handover?bookingId=...
   POST /api/admin/handover/save

   KV key:
   handover:{bookingId}

   Notes:
   - No D1 schema changes
   - No PDF generation
   - No email sending
   - No drawing/image handling yet
================================ */

function getHandoverKvKey(bookingId) {
  return `handover:${bookingId}`;
}

function cleanHandoverBookingId(value) {
  return String(value || "").trim();
}

async function handleAdminHandoverView(request, env) {
  const url = new URL(request.url);
  const bookingId = cleanHandoverBookingId(url.searchParams.get("bookingId"));

  if (!bookingId) {
    return json(
      {
        ok: false,
        error: "Missing bookingId",
      },
      400,
    );
  }

  const key = getHandoverKvKey(bookingId);

  const existing = await env.BOOKINGS_KV.get(key);

  if (!existing) {
    return json({
      ok: true,
      found: false,
      bookingId,
      handover: null,
    });
  }

  try {
    const handover = JSON.parse(existing);

    return json({
      ok: true,
      found: true,
      bookingId,
      handover,
    });
  } catch (err) {
    console.log("⚠️ Handover KV parse error:", err);

    return json(
      {
        ok: false,
        error: "Stored handover data could not be read",
        bookingId,
      },
      500,
    );
  }
}

async function handleAdminHandoverSave(request, env) {
  let body;

  try {
    body = await request.json();
  } catch (err) {
    return json(
      {
        ok: false,
        error: "Invalid JSON body",
      },
      400,
    );
  }

  const bookingId = cleanHandoverBookingId(body.bookingId);

  if (!bookingId) {
    return json(
      {
        ok: false,
        error: "Missing bookingId",
      },
      400,
    );
  }

  const key = getHandoverKvKey(bookingId);

  let existing = null;

  const existingRaw = await env.BOOKINGS_KV.get(key);

  if (existingRaw) {
    try {
      existing = JSON.parse(existingRaw);
    } catch (err) {
      console.log("⚠️ Existing handover KV parse error:", err);
      existing = null;
    }
  }

  const now = new Date().toISOString();

  const incomingHandover =
    body.handover && typeof body.handover === "object" ? body.handover : {};

  const handover = {
    ...(existing || {}),
    ...incomingHandover,

    bookingId,

    status: incomingHandover.status || existing?.status || "draft",

    comments:
      typeof incomingHandover.comments === "string"
        ? incomingHandover.comments
        : existing?.comments || "",

    termsSignature:
      incomingHandover.termsSignature || existing?.termsSignature || null,

    customerSignature:
      incomingHandover.customerSignature || existing?.customerSignature || null,

    drawings:
      incomingHandover.drawings && typeof incomingHandover.drawings === "object"
        ? incomingHandover.drawings
        : existing?.drawings || {},

    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const serialised = JSON.stringify(handover);

  // Safety guard for now. We are not storing drawing images yet in STEP 1A.
  // This prevents accidentally saving a huge payload while building the shell.
  if (serialised.length > 1024 * 1024) {
    return json(
      {
        ok: false,
        error: "Handover data is too large for STEP 1A shell save",
      },
      413,
    );
  }

  await env.BOOKINGS_KV.put(key, serialised);

  return json({
    ok: true,
    saved: true,
    bookingId,
    handover,
  });
}

function buildHandoverCopyEmailHtml({
  customerName,
  bookingId,
  vehicleName,
  pickupText,
  dropoffText,
  customerLink,
}) {
  const safeName = escapeHtml(customerName || "Customer");
  const safeBookingId = escapeHtml(bookingId || "");
  const safeVehicleName = escapeHtml(vehicleName || "your lorry");
  const safePickupText = escapeHtml(pickupText || "—");
  const safeDropoffText = escapeHtml(dropoffText || "—");
  const safeCustomerLink = escapeHtml(customerLink || "");

  return ` 
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbe1e8;">
         <tr>
  <td style="padding:22px 24px 0;background:#ffffff;">
    ${EMAIL_BRAND_BLOCK}

    <div style="
      margin:0 0 22px;
      text-align:center;
      color:#5a6675;
      font-size:15px;
      font-weight:800;
      line-height:1.4;
    ">
      Signed handover / damage report copy
    </div>
  </td>
</tr>

            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 14px;font-size:16px;line-height:1.5;">
                  Dear ${safeName},
                </p>

                <p style="margin:0 0 14px;font-size:16px;line-height:1.5;">
                  Thank you for completing the vehicle handover for your Equine Transport UK hire.
                </p>

                <p style="margin:0 0 18px;font-size:16px;line-height:1.5;">
                  Your signed handover and damage report copy is now available using the secure link below.
                  This report records the agreed vehicle condition, fuel level, comments, and signatures before you take the lorry.
                </p>

                <p style="margin:22px 0;text-align:center;">
                  <a href="${safeCustomerLink}"
                     style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:800;font-size:16px;">
                    View signed handover report
                  </a>
                </p>

                <p style="margin:0 0 18px;font-size:13px;line-height:1.5;color:#64748b;word-break:break-all;">
                  If the button does not work, copy and paste this link into your browser:<br>
                  ${safeCustomerLink}
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
                  <tr>
                    <td style="padding:10px 12px;font-size:13px;color:#64748b;font-weight:800;">Booking reference</td>
                    <td style="padding:10px 12px;font-size:14px;font-weight:800;">${safeBookingId}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 12px;font-size:13px;color:#64748b;font-weight:800;">Vehicle</td>
                    <td style="padding:10px 12px;font-size:14px;font-weight:800;">${safeVehicleName}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 12px;font-size:13px;color:#64748b;font-weight:800;">Hire from</td>
                    <td style="padding:10px 12px;font-size:14px;font-weight:800;">${safePickupText}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 12px;font-size:13px;color:#64748b;font-weight:800;">Hire until</td>
                    <td style="padding:10px 12px;font-size:14px;font-weight:800;">${safeDropoffText}</td>
                  </tr>
                </table>

                <p style="margin:22px 0 0;font-size:16px;line-height:1.5;">
                  Please keep this copy for your records.
                </p>

                <p style="margin:22px 0 0;font-size:16px;line-height:1.5;">
                  With kind regards,<br>
                  <strong>Koos & Avril</strong><br>
                  Equine Transport UK
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:13px;line-height:1.5;">
                <strong>Equine Transport UK</strong><br>
                Part of the East Grinstead Tyre Service Group<br>
                info@equinetransportuk.com<br>
                07812 188871 / 07584 578654
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `;
}

async function handleAdminHandoverEmailCopy(request, env) {
  /*
    STEP 3I — FINAL SAFETY / SEND SWITCH

    🔒 CURRENT STATE:
    HANDOVER_EMAIL_DRY_RUN = true means NO customer handover email can send.

    GO-LIVE LATER:
    Only after final domain/email go-live:
    1) Set HANDOVER_EMAIL_DRY_RUN = false
    2) Set Cloudflare secret EMAILS_ENABLED=true
    3) Set Cloudflare secret MIGRATION_MODE=false
    4) Deploy Worker

    All 3 conditions must be correct before a SendGrid call is allowed.
  */
  const HANDOVER_EMAIL_DRY_RUN = true;

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const bookingId = cleanHandoverBookingId(body.bookingId);

  if (!bookingId) {
    return json({ ok: false, error: "Missing bookingId" }, 400);
  }

  const handoverRaw = await env.BOOKINGS_KV.get(getHandoverKvKey(bookingId));

  if (!handoverRaw) {
    return json(
      { ok: false, error: "No saved handover found for this booking" },
      404,
    );
  }

  let handover;

  try {
    handover = JSON.parse(handoverRaw);
  } catch {
    return json(
      { ok: false, error: "Saved handover data could not be read" },
      500,
    );
  }

  const status = String(handover?.status || "draft").toLowerCase();

  if (status !== "complete") {
    return json(
      {
        ok: false,
        error: "Handover must be complete before emailing customer copy",
        status,
      },
      400,
    );
  }

  let booking = null;

  try {
    booking = await findBookingById(env, bookingId);
  } catch (err) {
    console.warn("⚠️ Could not load booking for handover email copy:", err);
  }

  const customerEmail = String(
    body.customerEmail ||
      booking?.customerEmail ||
      booking?.email ||
      booking?.customer_email ||
      "",
  )
    .trim()
    .toLowerCase();

  const customerName = String(
    body.customerName ||
      booking?.customerName ||
      booking?.customer_name ||
      "Customer",
  ).trim();

  const vehicleName = String(
    body.vehicleName ||
      booking?.vehicleSnapshot?.name ||
      booking?.vehicleName ||
      booking?.vehicleId ||
      "Horsebox hire",
  ).trim();

  const customerLink = String(body.customerLink || "").trim();

  if (!customerEmail) {
    return json(
      { ok: false, error: "No customer email found for this booking" },
      400,
    );
  }

  if (!customerLink) {
    return json(
      {
        ok: false,
        error: "Missing customer handover copy link",
      },
      400,
    );
  }

  const pickupText =
    body.pickupText || booking?.pickupAtLocal || booking?.pickupAt || "—";

  const dropoffText =
    body.dropoffText || booking?.dropoffAtLocal || booking?.dropoffAt || "—";

  const subject = "Your Equine Transport UK signed handover / damage report";

  const html = buildHandoverCopyEmailHtml({
    customerName,
    bookingId,
    vehicleName,
    pickupText,
    dropoffText,
    customerLink,
  });

  const emailsEnabled =
    String(env.EMAILS_ENABLED || "")
      .trim()
      .toLowerCase() === "true";

  const migrationMode =
    String(env.MIGRATION_MODE || "")
      .trim()
      .toLowerCase() === "true";

  const canSend =
    HANDOVER_EMAIL_DRY_RUN === false &&
    emailsEnabled === true &&
    migrationMode === false;

  const blockedReasons = [];

  if (HANDOVER_EMAIL_DRY_RUN) blockedReasons.push("HANDOVER_EMAIL_DRY_RUN");
  if (!emailsEnabled) blockedReasons.push("EMAILS_DISABLED");
  if (migrationMode) blockedReasons.push("MIGRATION_MODE");

  const sentKey = `handover-email-sent:${bookingId}`;

  /*
    🔒 DRY RUN / BLOCKED MODE
    This is the current live state. It returns the exact email preview,
    but makes ZERO SendGrid calls.
  */
  if (!canSend) {
    console.log("📧 Handover customer email prepared — NOT sent", {
      bookingId,
      customerEmail,
      customerName,
      vehicleName,
      customerLink,
      emailsEnabled,
      migrationMode,
      dryRun: HANDOVER_EMAIL_DRY_RUN,
      blockedReasons,
    });

    return json({
      ok: true,
      sent: false,
      dryRun: true,
      reason: blockedReasons[0] || "EMAIL_BLOCKED",
      blockedReasons,
      message:
        "Customer handover email prepared, but not sent. Email sending is disabled until go-live.",
      bookingId,
      customerEmail,
      customerName,
      vehicleName,
      customerLink,
      subject,
      htmlPreview: html,
      emailsEnabled,
      migrationMode,
    });
  }

  /*
    ✅ LIVE SEND MODE
    This block only runs after go-live when:
    - HANDOVER_EMAIL_DRY_RUN === false
    - EMAILS_ENABLED === true
    - MIGRATION_MODE === false
  */

  const alreadySent = await env.BOOKINGS_KV.get(sentKey);

  if (alreadySent) {
    console.log(
      "📧 Handover customer email already sent — skipping duplicate",
      {
        bookingId,
        customerEmail,
      },
    );

    return json({
      ok: true,
      sent: false,
      alreadySent: true,
      dryRun: false,
      reason: "ALREADY_SENT",
      message:
        "Customer handover email was already sent for this booking. Duplicate send skipped.",
      bookingId,
      customerEmail,
      customerName,
      vehicleName,
      customerLink,
      subject,
      htmlPreview: html,
      emailsEnabled,
      migrationMode,
    });
  }

  try {
    await sendBookingEmail(env, {
      to: customerEmail,
      subject,
      html,
    });

    await env.BOOKINGS_KV.put(
      sentKey,
      JSON.stringify({
        bookingId,
        customerEmail,
        sentAt: new Date().toISOString(),
        subject,
        customerLink,
      }),
      {
        expirationTtl: 60 * 60 * 24 * 90,
      },
    );

    console.log("✅ Handover customer email SENT", {
      bookingId,
      customerEmail,
      vehicleName,
    });

    return json({
      ok: true,
      sent: true,
      dryRun: false,
      reason: "SENT",
      message: "Customer handover email sent.",
      bookingId,
      customerEmail,
      customerName,
      vehicleName,
      customerLink,
      subject,
      emailsEnabled,
      migrationMode,
    });
  } catch (err) {
    console.error("❌ Handover customer email send failed:", err);

    return json(
      {
        ok: false,
        sent: false,
        dryRun: false,
        reason: "SEND_FAILED",
        error: err.message || "Failed to send customer handover email.",
        bookingId,
        customerEmail,
        customerName,
        vehicleName,
        customerLink,
        subject,
        emailsEnabled,
        migrationMode,
      },
      500,
    );
  }
}

async function handleAdminHandoverCustomerLink(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        ok: false,
        error: "Invalid JSON body",
      },
      400,
    );
  }

  const bookingId = cleanHandoverBookingId(body.bookingId);

  if (!bookingId) {
    return json(
      {
        ok: false,
        error: "Missing bookingId",
      },
      400,
    );
  }

  const handoverRaw = await env.BOOKINGS_KV.get(getHandoverKvKey(bookingId));

  if (!handoverRaw) {
    return json(
      {
        ok: false,
        error: "No saved handover found for this booking",
      },
      404,
    );
  }

  let handover;

  try {
    handover = JSON.parse(handoverRaw);
  } catch {
    return json(
      {
        ok: false,
        error: "Saved handover data could not be read",
      },
      500,
    );
  }

  const status = String(handover?.status || "draft").toLowerCase();

  if (status !== "complete") {
    return json(
      {
        ok: false,
        error: "Handover must be complete before creating customer copy link",
        status,
      },
      400,
    );
  }

  let booking = null;

  try {
    booking = await findBookingById(env, bookingId);
  } catch (err) {
    console.warn("⚠️ Could not load booking for customer handover link:", err);
  }

  const customerEmail = String(
    body.customerEmail ||
      booking?.customerEmail ||
      booking?.email ||
      booking?.customer_email ||
      "",
  )
    .trim()
    .toLowerCase();

  const customerName = String(
    body.customerName || booking?.customerName || booking?.customer_name || "",
  ).trim();

  const vehicleName = String(
    body.vehicleName ||
      booking?.vehicleSnapshot?.name ||
      booking?.vehicleName ||
      booking?.vehicleId ||
      "",
  ).trim();

  if (!customerEmail) {
    return json(
      {
        ok: false,
        error: "No customer email found for this booking",
      },
      400,
    );
  }

  const token = crypto.randomUUID().replace(/-/g, "");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);

  const tokenRecord = {
    token,
    bookingId,
    customerEmail,
    customerName,
    vehicleName,
    purpose: "handover_customer_copy",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await env.BOOKINGS_KV.put(
    `handover-copy-token:${token}`,
    JSON.stringify(tokenRecord),
    {
      expirationTtl: 60 * 60 * 24 * 30,
    },
  );

  const publicSiteUrl = String(
    env.PUBLIC_SITE_URL || "https://kvwebservices.co.uk/equinetransportuk",
  ).replace(/\/+$/, "");

  const customerLink = `${publicSiteUrl}/handover-copy.html?token=${encodeURIComponent(
    token,
  )}`;

  console.log("🔗 Customer handover copy link created — email NOT sent", {
    bookingId,
    customerEmail,
    customerName,
    vehicleName,
    customerLink,
    expiresAt: tokenRecord.expiresAt,
  });

  return json({
    ok: true,
    created: true,
    sent: false,
    dryRun: true,
    reason: "CUSTOMER_LINK_CREATED_EMAIL_NOT_SENT",
    message:
      "Customer handover copy link created. Email sending is still disabled until go-live.",
    bookingId,
    customerEmail,
    customerName,
    vehicleName,
    customerLink,
    expiresAt: tokenRecord.expiresAt,
  });
}

async function handlePublicHandoverCopy(request, env) {
  const url = new URL(request.url);
  const token = String(url.searchParams.get("token") || "").trim();

  if (!token) {
    return json(
      {
        ok: false,
        error: "Missing token",
      },
      400,
    );
  }

  const tokenRaw = await env.BOOKINGS_KV.get(`handover-copy-token:${token}`);

  if (!tokenRaw) {
    return json(
      {
        ok: false,
        error: "This handover copy link is invalid or has expired.",
      },
      404,
    );
  }

  let tokenRecord;

  try {
    tokenRecord = JSON.parse(tokenRaw);
  } catch {
    return json(
      {
        ok: false,
        error: "This handover copy link could not be read.",
      },
      500,
    );
  }

  const expiresAtMs = new Date(tokenRecord.expiresAt || 0).getTime();

  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
    return json(
      {
        ok: false,
        error: "This handover copy link has expired.",
      },
      410,
    );
  }

  const bookingId = cleanHandoverBookingId(tokenRecord.bookingId);

  if (!bookingId) {
    return json(
      {
        ok: false,
        error: "This handover copy link is missing a booking reference.",
      },
      400,
    );
  }

  const handoverRaw = await env.BOOKINGS_KV.get(getHandoverKvKey(bookingId));

  if (!handoverRaw) {
    return json(
      {
        ok: false,
        error: "No handover report found for this booking.",
      },
      404,
    );
  }

  let handover;

  try {
    handover = JSON.parse(handoverRaw);
  } catch {
    return json(
      {
        ok: false,
        error: "The handover report could not be read.",
      },
      500,
    );
  }

  const status = String(handover?.status || "draft").toLowerCase();

  if (status !== "complete") {
    return json(
      {
        ok: false,
        error: "This handover report is not complete yet.",
      },
      403,
    );
  }

  let booking = null;

  try {
    booking = await findBookingById(env, bookingId);
  } catch (err) {
    console.warn("⚠️ Could not load booking for public handover copy:", err);
  }

  const safeBooking = booking
    ? {
        id: booking.id,
        vehicleId: booking.vehicleId || "",
        vehicleSnapshot: booking.vehicleSnapshot || null,

        vehicleName:
          booking.vehicleSnapshot?.name ||
          booking.vehicleName ||
          tokenRecord.vehicleName ||
          "",

        pickupAt: booking.pickupAt || "",
        dropoffAt: booking.dropoffAt || "",
        pickupAtLocal: booking.pickupAtLocal || "",
        dropoffAtLocal: booking.dropoffAtLocal || "",

        customerName: booking.customerName || tokenRecord.customerName || "",
        customerEmail: booking.customerEmail || tokenRecord.customerEmail || "",
        customerMobile: booking.customerMobile || "",
        customerAddress: booking.customerAddress || booking.address || "",
        customerDob:
          booking.customerDob ||
          booking.dateOfBirth ||
          booking.customerDateOfBirth ||
          "",

        requiredFormType: booking.requiredFormType || "",
        formCompleted: booking.formCompleted === true,

        depositPaid: booking.depositPaid === true,
        outstandingPaid:
          booking.outstandingPaid === true ||
          Number(booking.outstandingAmount || booking.outstanding || 0) <= 0,

        outstandingAmount: Number(
          booking.outstandingAmount || booking.outstanding || 0,
        ),
        hireTotal: Number(booking.hireTotal || booking.priceTotal || 0),

        dvlaVerified:
          booking.dvlaVerified === true || booking.dvla_verified === 1,

        dvlaLicenceLast8:
          booking.dvlaLicenceLast8 ||
          booking.dvla_last_8 ||
          booking.dvlaLicence ||
          "",

        dvlaCode:
          booking.dvlaCode ||
          booking.dvlaCheckCode ||
          booking.dvla_check_code ||
          "",
      }
    : {
        id: bookingId,
        vehicleName: tokenRecord.vehicleName || "",
        customerName: tokenRecord.customerName || "",
        customerEmail: tokenRecord.customerEmail || "",
        customerMobile: "",
        customerAddress: "",
        customerDob: "",
        requiredFormType: "",
        formCompleted: false,
        depositPaid: false,
        outstandingPaid: false,
        outstandingAmount: 0,
        hireTotal: 0,
        dvlaVerified: false,
        dvlaLicenceLast8: "",
        dvlaCode: "",
      };

  return json({
    ok: true,
    found: true,
    bookingId,
    booking: safeBooking,
    handover: {
      status: handover.status || "complete",
      comments: handover.comments || "",
      termsSignature: handover.termsSignature || null,
      customerSignature: handover.customerSignature || null,
      drawings: handover.drawings || {},
      completedAt: handover.completedAt || handover.updatedAt || "",
      updatedAt: handover.updatedAt || "",
    },
    token: {
      expiresAt: tokenRecord.expiresAt,
    },
  });
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

async function handleAdminPaperFormReceived(request, env) {
  try {
    const body = await request.json();

    const bookingId = String(body.bookingId || "").trim();
    const formType = String(body.formType || "")
      .trim()
      .toLowerCase();

    if (!bookingId) {
      return json({ ok: false, error: "Missing bookingId" }, 400);
    }

    if (!["short", "long"].includes(formType)) {
      return json({ ok: false, error: "Invalid formType" }, 400);
    }

    const booking = await findBookingById(env, bookingId);

    if (!booking) {
      return json({ ok: false, error: "Booking not found" }, 404);
    }

    const now = new Date().toISOString();
    const formId = `form_${bookingId}`;

    const payload = {
      source: "paper",
      paperFormReceived: true,
      paperFormReceivedAt: now,
      bookingId,
      formType,
      customerName: booking.customerName || "",
      customerEmail: booking.customerEmail || "",
      customerMobile: booking.customerMobile || "",
      vehicleName: booking.vehicleSnapshot?.name || booking.vehicleName || "",
      pickupAt: booking.pickupAt || "",
      dropoffAt: booking.dropoffAt || "",
    };

    /* ===============================
       SAVE / UPSERT INTO booking_forms
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
        booking.customerName || null,
        booking.customerEmail || null,
        booking.customerMobile || null,
        JSON.stringify(payload),
        "", // no digital signature for paper form
        now,
        now,
      )
      .run();

    /* ===============================
       UPDATE bookings table
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

    /* ===============================
       UPDATE KV booking copy
    =============================== */

    try {
      let updated = false;
      const list = await env.BOOKINGS_KV.list({ prefix: "bookings:" });

      for (const key of list.keys) {
        const raw = await env.BOOKINGS_KV.get(key.name);
        if (!raw) continue;

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }

        if (!Array.isArray(parsed)) continue;

        const next = parsed.map((b) => {
          if (String(b.id) !== String(bookingId)) return b;

          updated = true;

          return {
            ...b,
            formCompleted: true,
            formType,
            formSource: "paper",
            paperFormReceived: true,
            paperFormReceivedAt: now,
            formSubmittedAt: now,
            formRecordId: formId,
          };
        });

        if (updated) {
          await env.BOOKINGS_KV.put(key.name, JSON.stringify(next));
          break;
        }
      }
    } catch (err) {
      console.warn("⚠️ KV update failed:", err);
    }

    return json({
      ok: true,
      bookingId,
      formType,
      formSource: "paper",
      paperFormReceived: true,
      paperFormReceivedAt: now,
    });
  } catch (err) {
    console.error("❌ PAPER FORM RECEIVE ERROR:", err);
    return json(
      { ok: false, error: "Failed to mark paper form received" },
      500,
    );
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

async function handlePublicResendLinks(request, env) {
  try {
    const { bookingId } = await request.json();

    if (!bookingId) {
      return json({ error: "Missing bookingId" }, 400);
    }

    const booking = await findBookingById(env, bookingId);

    if (!booking) {
      return json({ error: "Booking not found" }, 404);
    }

    if (!booking.customerEmail) {
      return json({ error: "No customer email found" }, 400);
    }

    // simple abuse protection
    const resendKey = `resend_links:${bookingId}`;
    const alreadySent = await env.BOOKINGS_KV.get(resendKey);

    if (alreadySent) {
      return json(
        {
          error:
            "Links were already resent recently. Please wait a few minutes.",
        },
        429,
      );
    }

    const emailHtml = buildModernEmail({
      title: "Equine Transport UK – Booking Links",
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
      subject: "Your Equine Transport UK booking links",
      html: emailHtml,
    });

    await env.BOOKINGS_KV.put(resendKey, "1", {
      expirationTtl: 60 * 10, // 10 minutes
    });

    return json({ ok: true });
  } catch (err) {
    console.error("❌ PUBLIC RESEND LINKS ERROR:", err);
    return json({ error: "Failed to resend links" }, 500);
  }
}
