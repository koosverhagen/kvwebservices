# Equine Booking Backend Integration Notes

## Best free email setup

For your use case, the best free starter stack is:

- Cloudflare Worker (free tier) for API + automation logic
- Workers KV (free tier) for booking records
- Stripe Checkout + Stripe Webhooks (no monthly fee, transaction fees only)
- Brevo Transactional Email API (free daily quota)

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

## Required secrets/env vars (Worker)

Set these with `wrangler secret put ...` or Worker dashboard:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUCCESS_URL`
- `STRIPE_CANCEL_URL`
- `BREVO_API_KEY`
- `EMAIL_FROM`
- `EMAIL_FROM_NAME` (optional)
- `PUBLIC_ICAL_URL` (your deployed `/api/bookings/ical` URL)
- `CORS_ORIGIN` (e.g. `https://kvwebservices.co.uk`)

## Frontend values to fill

In [equinetransportuk/app.js](equinetransportuk/app.js):

- `BACKEND_API_BASE` = your Worker domain (example: `https://equine-bookings-api.<subdomain>.workers.dev`)
- `OUTSTANDING_PAYMENT_LINK`
- `DEPOSIT_PAYMENT_LINK`
- `FORM_LINK_A`
- `FORM_LINK_B`

Optional fallback links:

- `STRIPE_PAYMENT_LINK_35T`
- `STRIPE_PAYMENT_LINK_75T`

## Deployment steps

1. Create KV namespace and paste ID into [equinetransportuk/backend-worker/wrangler.toml](equinetransportuk/backend-worker/wrangler.toml).
2. Deploy Worker from `equinetransportuk/backend-worker`.
3. Add Stripe webhook endpoint:
   - `https://<your-worker-domain>/api/bookings/stripe-webhook`
4. Configure Brevo sender/domain.
5. Set `BACKEND_API_BASE` in [equinetransportuk/app.js](equinetransportuk/app.js).
6. Deploy frontend site.

## Reminder behavior (implemented)

When booking is confirmed and reminder time is reached (day before pickup):

- Sends customer email with:
  - outstanding payment link
  - £200 deposit link
  - form link A
  - form link B

## iCalendar behavior

The Worker exposes a live `.ics` feed at `/api/bookings/ical`.

Subscribe to that URL in your calendar app (Google/Apple/Outlook) so bookings auto-update.

