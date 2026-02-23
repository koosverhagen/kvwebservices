# Equine Booking Worker

Cloudflare Worker backend for:
- Stripe checkout session creation
- Stripe webhook confirmation handling
- Confirmation/reminder emails via Brevo
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
   - `npx wrangler secret put BREVO_API_KEY`
   - `npx wrangler secret put EMAIL_FROM`
   - optional: `EMAIL_FROM_NAME`, `PUBLIC_ICAL_URL`, `CORS_ORIGIN`
4. Run locally:
   - `npm run dev`
5. Deploy:
   - `npm run deploy`

After deploy, set `BACKEND_API_BASE` in `../app.js` to your worker URL.
