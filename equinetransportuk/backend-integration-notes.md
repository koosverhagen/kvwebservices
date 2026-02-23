# Equine Booking Backend Integration Notes

## Best free email setup

For your use case, the best free starter stack is:

- Cloudflare Worker (free tier) for API + automation logic
- Workers KV (free tier) for booking records
- Stripe Checkout + Stripe Webhooks (no monthly fee, transaction fees only)
- SendGrid Transactional Email API

Why this is best:

- Very low/zero monthly cost to start
- Real API/webhook security (unlike static-only frontend)
- Reliable transactional email delivery
- Built-in scheduled reminders via Worker cron

## What is already scaffolded

Backend scaffold lives in [equinetransportuk/backend-worker/wrangler.toml](equinetransportuk/backend-worker/wrangler.toml), [equinetransportuk/backend-worker/package.json](equinetransportuk/backend-worker/package.json), and [equinetransportuk/backend-worker/src/index.js](equinetransportuk/backend-worker/src/index.js).

Frontend integration is wired in [equinetransportuk/app.js](equinetransportuk/app.js) through `BACKEND_API_BASE`.

## API endpoints

- `POST /api/bookings/create-checkout-session`
  - Creates Stripe session for confirmation fee only (£70 for 3.5t, £100 for 7.5t).
- `POST /api/bookings/stripe-webhook`
  - Marks booking confirmed after successful Stripe payment.
  - Sends confirmation email.
- `POST /api/bookings/automation`
  - Stores booking payload for follow-up automation.
- `GET /api/bookings/ical`
  - Live iCalendar feed for confirmed bookings.
- `GET /api/bookings/reminders/run`
  - Manual trigger for due reminders (also runs from cron every 30 min).

### Deposit workflow endpoints (Planyo-free)

- `POST /api/deposit/create-intent`
  - Creates Stripe PaymentIntent with `capture_method=manual` (deposit hold flow).
- `POST /api/deposit/cancel`
  - Cancels deposit hold PaymentIntent.
- `POST /api/deposit/capture`
  - Captures held deposit PaymentIntent.
- `GET /api/deposit/status/:bookingID`
  - Returns current deposit status for booking.
- `GET /api/deposit/list/:bookingID`
  - Returns deposit records for one booking.
- `GET /api/deposit/list-all`
  - Returns all bookings with deposit records.
- `POST /api/deposit/send-link`
  - Sends customer deposit payment link email (with duplicate-send guard).
- `GET /deposit/pay?bookingID=...`
  - Hosted Stripe deposit page (card entry + hold confirmation).
- `GET /api/bookings/:bookingID`
  - Returns booking details used by internal pages/tools.

## Required secrets/env vars (Worker)

Set these with `wrangler secret put ...` or Worker dashboard:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUCCESS_URL`
- `STRIPE_CANCEL_URL`
- `SENDGRID_API_KEY`
- `EMAIL_FROM`
- `EMAIL_FROM_NAME` (optional)
- `PUBLIC_ICAL_URL` (your deployed `/api/bookings/ical` URL)
- `CORS_ORIGIN` (e.g. `https://kvwebservices.co.uk`)
- `DEPOSIT_PENCE` (optional, default `20000`)
- `DEPOSIT_PAYMENT_LINK_TEMPLATE` (optional, use `{bookingID}` placeholder)
- `DEPOSIT_PAYMENT_PAGE_BASE` (optional, e.g. your hosted deposit page URL)
- `STRIPE_PUBLISHABLE_KEY` (required for hosted deposit page)
- `SHORT_FORM_URL` (optional override for short form URL)
- `LONG_FORM_URL` (optional override for long form URL)

## Frontend values to fill

In [equinetransportuk/app.js](equinetransportuk/app.js):

- `BACKEND_API_BASE` = your Worker domain (example: `https://equine-bookings-api.<subdomain>.workers.dev`)
- `OUTSTANDING_PAYMENT_LINK`
- `DEPOSIT_PAYMENT_LINK`
- `FORM_LINK_A` (`https://www.equinetransportuk.com/shortformsubmit`)
- `FORM_LINK_B` (`https://www.equinetransportuk.com/longformsubmit`)

Optional fallback links:

- `STRIPE_PAYMENT_LINK_35T`
- `STRIPE_PAYMENT_LINK_75T`

## Deployment steps

1. Create KV namespace and paste ID into [equinetransportuk/backend-worker/wrangler.toml](equinetransportuk/backend-worker/wrangler.toml).
2. Deploy Worker from `equinetransportuk/backend-worker`.
3. Add Stripe webhook endpoint:
   - `https://<your-worker-domain>/api/bookings/stripe-webhook`
4. Configure SendGrid sender authentication/domain.
5. Set `BACKEND_API_BASE` in [equinetransportuk/app.js](equinetransportuk/app.js).
6. Deploy frontend site.

## Reminder behavior (implemented)

When booking is confirmed and reminder time is reached (day before pickup):

- Sends customer email with:
  - outstanding payment link
  - £200 deposit link
  - required short/long form link
  - DVLA licence code reminder

Required form selection rule:

- If customer marked “hired within last 3 months” (or has a recent booking in the last 90 days), use Short Form.
- Otherwise, use Long Form.

## iCalendar behavior

The Worker exposes a live `.ics` feed at `/api/bookings/ical`.

Subscribe to that URL in your calendar app (Google/Apple/Outlook) so bookings auto-update.

