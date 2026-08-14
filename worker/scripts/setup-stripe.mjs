/* One-off: create Stripe Products/Prices for membership tiers + packages.
   Idempotent via price lookup_keys. Reads the secret key from .dev.vars
   (test mode) or STRIPE_SECRET_KEY env var (live, at cutover).
   Prints SQL to store the price ids in D1. */
import { readFileSync } from 'node:fs';

function keyFromDevVars() {
  try {
    const txt = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
    const m = txt.match(/^STRIPE_SECRET_KEY=(.+)$/m);
    return m && m[1].trim();
  } catch { return null; }
}
const KEY = process.env.STRIPE_SECRET_KEY || keyFromDevVars();
if (!KEY || KEY.includes('REPLACE')) { console.error('No Stripe secret key found'); process.exit(1); }

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

async function ensurePrice(lookupKey, productName, amountPence, recurringMonthly) {
  const existing = await stripe('GET', `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&limit=1`);
  if (existing.data.length) return existing.data[0].id;
  const product = await stripe('POST', '/products', { name: productName });
  const price = await stripe('POST', '/prices', {
    product: product.id,
    unit_amount: String(amountPence),
    currency: 'gbp',
    lookup_key: lookupKey,
    ...(recurringMonthly ? { 'recurring[interval]': 'month' } : {}),
  });
  return price.id;
}

const tiers = [
  ['foundation', 'AREUM Foundation Membership', 29500],
  ['signature', 'AREUM Signature Membership', 49500],
  ['private', 'AREUM Private Membership', 79500],
];
const packages = [
  ['lpg-face-8', 'Face Lift & Sculpt — 8 Session Programme', 68000],
  ['lpg-face-10', 'Face Lift & Sculpt — 10 Session Programme', 82000],
  ['lpg-body-6', 'Targeted Body Contouring — 6 Session Programme', 75000],
  ['lpg-body-10', 'Targeted Body Contouring — 10 Session Programme', 120000],
  ['lpg-combo-10', 'Face Lift & Sculpt + Targeted Body — 10 Session Programme', 175000],
  ['lpg-full-6', 'Full Body Sculpting — 6 Session Programme', 150000],
  ['lpg-full-10', 'Full Body Sculpting — 10 Session Programme', 235000],
];

const sql = [];
for (const [id, name, pence] of tiers) {
  const priceId = await ensurePrice(`tier_${id}`, name, pence, true);
  sql.push(`UPDATE membership_tiers SET stripe_price_id = '${priceId}' WHERE id = '${id}';`);
  console.error(`tier ${id} -> ${priceId}`);
}
for (const [slug, name, pence] of packages) {
  const priceId = await ensurePrice(`pkg_${slug}`, name, pence, false);
  sql.push(`UPDATE packages SET stripe_price_id = '${priceId}' WHERE slug = '${slug}';`);
  console.error(`package ${slug} -> ${priceId}`);
}
console.log(sql.join('\n'));
