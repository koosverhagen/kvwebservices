# Equine Booking Worker

Cloudflare Worker backend for:
- Stripe checkout session creation
- Stripe deposit hold workflow (create/cancel/capture/status/list/send-link)
- Hosted deposit page (`/deposit/pay?bookingID=...`)
- Stripe webhook confirmation handling
- Confirmation/reminder emails via SendGrid
- iCalendar feed generation

## Quick start

1. Install dependencies:
   - `npm install`
2. Create KV namespace:
   - `npx wrangler kv namespace create BOOKINGS_KV`
   - put returned `id` into `wrangler.toml`
3. Set secrets:
   - `npx wrangler secret put STRIPE_SECRET_KEY`
   - `npx wrangler secret put STRIPE_WEBHOOK_SECRET`
   - `npx wrangler secret put STRIPE_SUCCESS_URL`
   - `npx wrangler secret put STRIPE_CANCEL_URL`
   - `npx wrangler secret put SENDGRID_API_KEY`
   - `npx wrangler secret put EMAIL_FROM`
   - optional: `EMAIL_FROM_NAME`, `PUBLIC_ICAL_URL`, `CORS_ORIGIN`
4. Run locally:
   - `npm run dev`
5. Deploy:
   - `npm run deploy`

After deploy, set `BACKEND_API_BASE` in `../app.js` to your worker URL.

## Optional env vars for deposit flow

- `DEPOSIT_PENCE` (default 20000)
- `DEPOSIT_PAYMENT_LINK_TEMPLATE` (supports `{bookingID}` token)
- `DEPOSIT_PAYMENT_PAGE_BASE` (fallback URL for deposit link creation)
- `STRIPE_PUBLISHABLE_KEY` (required for hosted deposit card page)
- `SHORT_FORM_URL` (optional override for short form URL)
- `LONG_FORM_URL` (optional override for long form URL)
