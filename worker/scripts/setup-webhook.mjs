/* Creates (or reuses) the Stripe webhook endpoint for the deployed Worker and
   writes a secrets.json for `wrangler secret bulk`. Never prints secret values.
   Usage: node scripts/setup-webhook.mjs https://worker-url */
import { readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2];
if (!base) { console.error('Usage: node setup-webhook.mjs <worker-base-url>'); process.exit(1); }
const url = base.replace(/\/$/, '') + '/api/stripe/webhook';

let KEY = process.env.STRIPE_SECRET_KEY;
let PK = process.env.STRIPE_PUBLISHABLE_KEY;
if (!KEY || !PK) {
  const devVars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  KEY = KEY || devVars.match(/^STRIPE_SECRET_KEY=(.+)$/m)[1].trim();
  PK = PK || devVars.match(/^STRIPE_PUBLISHABLE_KEY=(.+)$/m)[1].trim();
}

async function stripe(method, path, body) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? new URLSearchParams(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || res.status);
  return json;
}

const existing = await stripe('GET', '/webhook_endpoints?limit=20');
let endpoint = existing.data.find(e => e.url === url);
if (endpoint) {
  console.error('Webhook endpoint already exists:', endpoint.id, '(secret not retrievable — delete and rerun if needed)');
  if (!endpoint.secret) process.exit(2);
} else {
  endpoint = await stripe('POST', '/webhook_endpoints', new URLSearchParams([
    ['url', url],
    ['enabled_events[]', 'payment_intent.succeeded'],
    ['enabled_events[]', 'invoice.paid'],
    ['enabled_events[]', 'invoice.payment_failed'],
    ['enabled_events[]', 'customer.subscription.deleted'],
  ]));
  console.error('Created webhook endpoint:', endpoint.id, '→', url);
}

writeFileSync(new URL('../secrets.json', import.meta.url), JSON.stringify({
  STRIPE_SECRET_KEY: KEY,
  STRIPE_PUBLISHABLE_KEY: PK,
  STRIPE_WEBHOOK_SECRET: endpoint.secret,
}));
console.error('secrets.json written (delete after `wrangler secret bulk`).');
