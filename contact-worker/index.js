const ALLOWED_ORIGINS = new Set([
  'https://kvwebservices.co.uk',
  'https://www.kvwebservices.co.uk',
]);

function clean(value, maxLength) {
  return String(value ?? '').replace(/\0/g, '').trim().slice(0, maxLength);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function allowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, data, status = 200) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
  };
  if (allowedOrigin(origin)) Object.assign(headers, corsHeaders(origin));
  return Response.json(data, { status, headers });
}

function findValue(entries, names, maxLength) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const match = entries.find(([name]) => wanted.has(name.toLowerCase()));
  return clean(match?.[1], maxLength);
}

function enquiryDetails(entries) {
  const ignored = new Set(['site', 'website', '_gotcha', '_subject', 'subject']);
  const lines = [];

  for (const [rawName, rawValue] of entries.slice(0, 40)) {
    const name = clean(rawName, 80);
    const value = clean(rawValue, name.toLowerCase() === 'message' ? 2500 : 250);
    if (!name || !value || ignored.has(name.toLowerCase())) continue;
    lines.push(`${name}: ${value}`);
  }

  return lines.join('\n').slice(0, 8000);
}

async function handleContact(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!allowedOrigin(origin)) return json(request, { ok: false, message: 'Origin not allowed.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') return json(request, { ok: false, message: 'Method not allowed.' }, 405);

  if (Number(request.headers.get('Content-Length') || 0) > 30_000) {
    return json(request, { ok: false, message: 'This enquiry is too large.' }, 413);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json(request, { ok: false, message: 'Please check the form and try again.' }, 400);
  }

  if (clean(form.get('website') || form.get('_gotcha'), 200)) return json(request, { ok: true });

  const entries = Array.from(form.entries()).filter(([, value]) => typeof value === 'string');
  const name = findValue(entries, ['name', 'fullName'], 120)
    || [findValue(entries, ['firstName'], 60), findValue(entries, ['lastName'], 60)].filter(Boolean).join(' ');
  const email = findValue(entries, ['email'], 254);
  const phone = findValue(entries, ['phone', 'mobile'], 40);
  const details = enquiryDetails(entries);

  if (!name || !validEmail(email) || !details) {
    return json(request, { ok: false, message: 'Please complete all required fields.' }, 400);
  }
  if (!env.FORM_ENDPOINT || !env.FORM_SECRET) {
    return json(request, { ok: false, message: 'Enquiries are temporarily unavailable. Please email us instead.' }, 503);
  }

  const response = await fetch(env.FORM_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ name, email, phone, details, secret: env.FORM_SECRET }),
    redirect: 'follow',
  });
  const result = await response.json().catch(() => null);

  if (!response.ok || result?.ok !== true) {
    console.error('Google form handler rejected the enquiry.', result);
    return json(request, { ok: false, message: 'We could not send that just now. Please email us or try again.' }, 502);
  }

  return json(request, { ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact-enquiry') return handleContact(request, env);
    return json(request, { ok: false, message: 'Not found.' }, 404);
  },
};
