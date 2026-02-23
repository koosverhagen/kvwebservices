# Staging Setup Commands (Safe: does not touch current live site)

Use these commands from:

`/Users/koosverhagen/Documents/GitHub/kvwebservices/equinetransportuk/backend-worker`

## 1) Install and login

```bash
npm install
npx wrangler login
```

## 2) Create KV namespace

```bash
npx wrangler kv namespace create BOOKINGS_KV
```

Copy the returned `id` into:

- [equinetransportuk/backend-worker/wrangler.toml](equinetransportuk/backend-worker/wrangler.toml)

Replace:

- `REPLACE_WITH_KV_NAMESPACE_ID`

## 3) Set Worker secrets (staging)

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_SUCCESS_URL
npx wrangler secret put STRIPE_CANCEL_URL
npx wrangler secret put SENDGRID_API_KEY
npx wrangler secret put EMAIL_FROM
npx wrangler secret put EMAIL_FROM_NAME
npx wrangler secret put PUBLIC_ICAL_URL
npx wrangler secret put CORS_ORIGIN
```

Recommended values for staging:

- `STRIPE_SUCCESS_URL`: `https://kvwebservices.co.uk/equinetransportuk/?pay=success`
- `STRIPE_CANCEL_URL`: `https://kvwebservices.co.uk/equinetransportuk/?pay=cancel`
- `CORS_ORIGIN`: `https://kvwebservices.co.uk`

## 4) Deploy Worker (staging API)

```bash
npm run deploy
```

You’ll get a URL like:

- `https://equine-bookings-api.<your-subdomain>.workers.dev`

## 5) Point frontend to staging Worker

Edit:

- [equinetransportuk/app.js](equinetransportuk/app.js)

Set `BACKEND_API_BASE` to your Worker URL, for example:

```js
const BACKEND_API_BASE = "https://equine-bookings-api.<your-subdomain>.workers.dev";
```

## 6) Add your payment/form links in frontend

In [equinetransportuk/app.js](equinetransportuk/app.js), set:

- `OUTSTANDING_PAYMENT_LINK`
- `DEPOSIT_PAYMENT_LINK`
- `FORM_LINK_A`
- `FORM_LINK_B`

Optional fallback links:

- `STRIPE_PAYMENT_LINK_35T`
- `STRIPE_PAYMENT_LINK_75T`

## 7) Add Stripe webhook (staging only)

In Stripe dashboard, create webhook endpoint:

- `https://equine-bookings-api.<your-subdomain>.workers.dev/api/bookings/stripe-webhook`

Event to send:

- `checkout.session.completed`

## 8) Test endpoints quickly

Replace `<worker-url>` first.

```bash
curl -i <worker-url>/api/bookings/ical
curl -i <worker-url>/api/bookings/reminders/run
```

## 9) Keep current live site untouched

Until cutover day:

- Do not change DNS for `www.equinetransportuk.com`
- Do not replace forms/links on current production site
- Keep Stripe webhook for current live flow unchanged
- Only test via `kvwebservices.co.uk/equinetransportuk/` + Worker staging URL

## 10) Cutover checklist (when ready)

1. Final test successful in staging
2. Update production frontend entrypoint to new booking URL
3. Point production webhook to production Worker endpoint
4. Monitor first live booking + confirmation email + reminder
5. Keep rollback path ready (old links still available)
