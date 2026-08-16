import { Hono } from 'hono';
import { stripeRequest, verifyWebhook, StripeError } from './stripe.js';
import { localToUtcIso, utcIsoToLocalHHMM, localWeekday, todayLocal } from './time.js';
import { registerAdmin } from './admin.js';
import { sessionUser, readSessionCookie } from './auth.js';
import { sendEmail, bookingConfirmationEmail, bookingReminderEmail, membershipWelcomeEmail, packageConfirmationEmail } from './email.js';

const app = new Hono();

/** Everything the confirmation email needs, in one query round. */
async function bookingEmailData(db, id) {
  const b = await db.prepare(
    `SELECT b.id, b.starts_at, b.amount_pence, c.name, c.email
     FROM bookings b JOIN clients c ON c.id = b.client_id WHERE b.id = ?`
  ).bind(id).first();
  if (!b || !b.email || b.email.endsWith('@clinic.local')) return null;
  const items = (await db.prepare(
    `SELECT s.name FROM booking_items bi JOIN services s ON s.slug = bi.service_slug WHERE bi.booking_id = ?`
  ).bind(id).all()).results.map(r => r.name);
  return { ...b, items };
}

/* ---------- helpers ---------- */

async function getSettings(db) {
  const rows = (await db.prepare('SELECT key, value FROM settings').all()).results;
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    capacity: parseInt(s.capacity || '5', 10),
    dailyCap: parseInt(s.daily_cap || '5', 10),
    slotMinutes: parseInt(s.slot_minutes || '15', 10),
    leadTimeMinutes: parseInt(s.lead_time_minutes || '60', 10),
    cancelWindowHours: parseInt(s.cancel_window_hours || '24', 10),
    hours: JSON.parse(s.hours || '{}'),
  };
}

/** Slot-holding bookings that start on the given clinic-local day. */
async function dayBookingCount(db, date) {
  const dayStart = localToUtcIso(date, '00:00');
  const nextDate = new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  const dayEnd = localToUtcIso(nextDate, '00:00');
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM bookings WHERE (${HOLDING}) AND starts_at >= ? AND starts_at < ?`
  ).bind(dayStart, dayEnd).first();
  return row.n;
}

async function findOrCreateClient(db, { name, email, phone }) {
  const existing = await db.prepare('SELECT * FROM clients WHERE email = ?').bind(email).first();
  if (existing) {
    await db.prepare('UPDATE clients SET name = ?, phone = COALESCE(?, phone) WHERE id = ?')
      .bind(name, phone || null, existing.id).run();
    return { ...existing, name, phone: phone || existing.phone };
  }
  const r = await db.prepare('INSERT INTO clients (name, email, phone) VALUES (?, ?, ?) RETURNING *')
    .bind(name, email, phone || null).first();
  return r;
}

async function ensureStripeCustomer(env, db, clientRow) {
  if (clientRow.stripe_customer_id) return clientRow.stripe_customer_id;
  const cust = await stripeRequest(env, 'POST', '/customers', {
    name: clientRow.name,
    email: clientRow.email,
    ...(clientRow.phone ? { phone: clientRow.phone } : {}),
    metadata: { client_id: String(clientRow.id) },
  });
  await db.prepare('UPDATE clients SET stripe_customer_id = ? WHERE id = ?').bind(cust.id, clientRow.id).run();
  return cust.id;
}

/** Bookings that still hold a slot: confirmed/completed always; pending only for 15 min. */
const HOLDING = `status IN ('confirmed','completed')
  OR (status = 'pending' AND created_at > datetime('now','-15 minutes'))`;

/* ---------- public API ---------- */

app.get('/api/health', c => c.json({ ok: true }));

/* Everything except LPG is "coming soon" until Monday 17 Aug 2026, 00:00
   Europe/London (BST = UTC+1). Delete COMING_SOON_UNTIL_MS and its two
   checks after launch week — the lock lifts itself automatically. */
const COMING_SOON_UNTIL_MS = Date.UTC(2026, 7, 16, 23, 0, 0);
const comingSoonActive = () => Date.now() < COMING_SOON_UNTIL_MS;

app.get('/api/config', c => c.json({
  publishableKey: c.env.STRIPE_PUBLISHABLE_KEY || '',
  comingSoon: comingSoonActive()
}));

app.get('/api/catalogue', async c => {
  const db = c.env.DB;
  const services = (await db.prepare('SELECT slug, name, category, price_pence, duration_min FROM services WHERE active = 1').all()).results;
  const tiers = (await db.prepare('SELECT id, name, price_pence, sessions_per_month FROM membership_tiers').all()).results;
  const packages = (await db.prepare('SELECT slug, name, service_slug, sessions_total, price_pence, expires_months FROM packages WHERE active = 1').all()).results;
  return c.json({ services, tiers, packages });
});

/* GET /api/availability?date=YYYY-MM-DD&duration=60 → { slots: ["10:00", ...] } */
app.get('/api/availability', async c => {
  const db = c.env.DB;
  const date = c.req.query('date');
  const duration = parseInt(c.req.query('duration') || '0', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !duration || duration < 5 || duration > 480) {
    return c.json({ error: 'Invalid date or duration' }, 400);
  }

  const closed = await db.prepare('SELECT 1 FROM closed_dates WHERE date = ?').bind(date).first();
  if (closed) return c.json({ slots: [] });

  const settings = await getSettings(db);
  const hours = settings.hours[String(localWeekday(date))];
  if (!hours) return c.json({ slots: [] });

  // Daily treatment cap: the clinic takes at most N appointments a day (any type)
  if (await dayBookingCount(db, date) >= settings.dailyCap) return c.json({ slots: [] });

  const [open, close] = hours.split('-');
  const dayStart = localToUtcIso(date, open);
  const dayEnd = localToUtcIso(date, close);

  // All slot-holding bookings that overlap this day
  const rows = (await db.prepare(
    `SELECT starts_at, ends_at FROM bookings WHERE (${HOLDING}) AND starts_at < ? AND ends_at > ?`
  ).bind(dayEnd, dayStart).all()).results;

  const step = settings.slotMinutes * 60000;
  const durMs = duration * 60000;
  const startMs = Date.parse(dayStart);
  const closeMs = Date.parse(dayEnd);
  const earliest = Date.now() + settings.leadTimeMinutes * 60000;

  const slots = [];
  for (let t = startMs; t + durMs <= closeMs; t += step) {
    if (t < earliest) continue;
    const tEnd = t + durMs;
    // capacity check at the finest granularity: count bookings overlapping any part of the slot,
    // sampled at slot boundaries within [t, tEnd)
    let ok = true;
    for (let p = t; p < tEnd && ok; p += step) {
      const overlapping = rows.filter(b => Date.parse(b.starts_at) <= p && Date.parse(b.ends_at) > p).length;
      if (overlapping >= settings.capacity) ok = false;
    }
    if (ok) slots.push(utcIsoToLocalHHMM(new Date(t).toISOString()));
  }
  return c.json({ date, slots });
});

/* POST /api/bookings
   { items: ["hydrate-iv","b12"], date: "YYYY-MM-DD", time: "HH:MM",
     client: { name, email, phone }, notes? }
   → { bookingId, clientSecret, amountPence } (payment confirms via webhook)  */
app.post('/api/bookings', async c => {
  const db = c.env.DB;
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  const { items, date, time, client, notes } = body || {};
  if (!Array.isArray(items) || !items.length || items.length > 10) return c.json({ error: 'No treatments selected' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return c.json({ error: 'Invalid date or time' }, 400);
  if (!client?.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(client?.email || '')) return c.json({ error: 'Name and a valid email are required' }, 400);

  const placeholders = items.map(() => '?').join(',');
  const services = (await db.prepare(
    `SELECT slug, name, category, price_pence, duration_min FROM services WHERE active = 1 AND slug IN (${placeholders})`
  ).bind(...items).all()).results;
  if (services.length !== new Set(items).size) return c.json({ error: 'Unknown treatment in basket' }, 400);

  // duration = sum of items (one client, treatments run back-to-back in a visit)
  const bySlug = Object.fromEntries(services.map(s => [s.slug, s]));
  const chosen = items.map(slug => bySlug[slug]);

  if (comingSoonActive() && chosen.some(s => s.category !== 'lpg')) {
    return c.json({ error: 'IV drips and injections open for booking on Monday 17 August' }, 409);
  }
  const duration = chosen.reduce((a, s) => a + s.duration_min, 0);
  const amount = chosen.reduce((a, s) => a + s.price_pence, 0);

  const startsAt = localToUtcIso(date, time);
  const endsAt = new Date(Date.parse(startsAt) + duration * 60000).toISOString();

  // Re-validate the slot server-side (race-safe enough for a 5-capacity boutique)
  const settings = await getSettings(db);
  const closed = await db.prepare('SELECT 1 FROM closed_dates WHERE date = ?').bind(date).first();
  if (closed) return c.json({ error: 'The clinic is closed that day' }, 409);
  const clash = await db.prepare(
    `SELECT COUNT(*) AS n FROM bookings WHERE (${HOLDING}) AND starts_at < ? AND ends_at > ?`
  ).bind(endsAt, startsAt).first();
  if (clash.n >= settings.capacity) return c.json({ error: 'That time was just taken — please pick another slot' }, 409);
  if (await dayBookingCount(db, date) >= settings.dailyCap) {
    return c.json({ error: 'That day is now fully booked — please pick another day' }, 409);
  }

  const clientRow = await findOrCreateClient(db, client);
  const booking = await db.prepare(
    `INSERT INTO bookings (client_id, starts_at, ends_at, status, source, amount_pence, notes)
     VALUES (?, ?, ?, 'pending', 'online', ?, ?) RETURNING id`
  ).bind(clientRow.id, startsAt, endsAt, amount, notes || null).first();

  for (const s of chosen) {
    await db.prepare('INSERT INTO booking_items (booking_id, service_slug, price_pence) VALUES (?, ?, ?)')
      .bind(booking.id, s.slug, s.price_pence).run();
  }

  try {
    const pi = await stripeRequest(c.env, 'POST', '/payment_intents', {
      amount,
      currency: 'gbp',
      receipt_email: client.email,
      description: 'AREUM Wellness — ' + chosen.map(s => s.name).join(', '),
      metadata: { kind: 'booking', booking_id: String(booking.id) },
      payment_method_types: ['card'],
    });
    await db.prepare('UPDATE bookings SET payment_intent_id = ? WHERE id = ?').bind(pi.id, booking.id).run();
    return c.json({ bookingId: booking.id, clientSecret: pi.client_secret, amountPence: amount });
  } catch (e) {
    await db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(booking.id).run();
    const msg = e instanceof StripeError ? e.message : 'Payment setup failed';
    return c.json({ error: msg }, 502);
  }
});

app.get('/api/bookings/:id/status', async c => {
  const row = await c.env.DB.prepare('SELECT status FROM bookings WHERE id = ?')
    .bind(Number(c.req.param('id'))).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ status: row.status });
});

/* Belt-and-braces confirmation: the client calls this after Stripe reports the
   payment succeeded. We verify with Stripe server-side (never trust the client)
   and confirm the booking. In production the webhook usually wins the race. */
app.post('/api/bookings/:id/sync', async c => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const row = await db.prepare('SELECT id, status, payment_intent_id FROM bookings WHERE id = ?').bind(id).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.status === 'pending' && row.payment_intent_id) {
    try {
      const pi = await stripeRequest(c.env, 'GET', `/payment_intents/${row.payment_intent_id}`);
      if (pi.status === 'succeeded') {
        const r = await db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ? AND status = 'pending'").bind(id).run();
        if (r.meta.changes > 0) {
          const d = await bookingEmailData(db, id);
          if (d) await sendEmail(c.env, c.executionCtx, bookingConfirmationEmail(d.email, d.name, d.starts_at, d.items, d.amount_pence));
        }
        return c.json({ status: 'confirmed' });
      }
    } catch { /* fall through — report current status */ }
  }
  const fresh = await db.prepare('SELECT status FROM bookings WHERE id = ?').bind(id).first();
  return c.json({ status: fresh.status });
});

/* POST /api/memberships/subscribe  { tier, client:{name,email,phone} }
   → { membershipId, clientSecret, amountPence }  (first invoice paid on-site) */
app.post('/api/memberships/subscribe', async c => {
  const db = c.env.DB;
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  const { tier: tierId, client } = body || {};
  if (!client?.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(client?.email || '')) {
    return c.json({ error: 'Name and a valid email are required' }, 400);
  }
  const tier = await db.prepare('SELECT * FROM membership_tiers WHERE id = ?').bind(String(tierId || '')).first();
  if (!tier) return c.json({ error: 'Unknown membership' }, 400);
  if (!tier.stripe_price_id) return c.json({ error: 'Membership not available yet' }, 503);

  const clientRow = await findOrCreateClient(db, client);
  const existing = await db.prepare(
    "SELECT 1 FROM memberships WHERE client_id = ? AND status IN ('active','past_due')"
  ).bind(clientRow.id).first();
  if (existing) return c.json({ error: 'This email already has an active membership — contact the clinic to change plan' }, 409);

  try {
    const customerId = await ensureStripeCustomer(c.env, db, clientRow);
    const sub = await stripeRequest(c.env, 'POST', '/subscriptions', {
      customer: customerId,
      items: [{ price: tier.stripe_price_id }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription', payment_method_types: ['card'] },
      expand: ['latest_invoice.payment_intent'],
      metadata: { kind: 'membership', tier: tier.id, client_id: String(clientRow.id) },
    });
    const pi = sub.latest_invoice && sub.latest_invoice.payment_intent;
    if (!pi || !pi.client_secret) return c.json({ error: 'Could not start the subscription' }, 502);
    const row = await db.prepare(
      `INSERT INTO memberships (client_id, tier_id, stripe_subscription_id, status)
       VALUES (?, ?, ?, 'incomplete') RETURNING id`
    ).bind(clientRow.id, tier.id, sub.id).first();
    return c.json({ membershipId: row.id, clientSecret: pi.client_secret, amountPence: tier.price_pence });
  } catch (e) {
    const msg = e instanceof StripeError ? e.message : 'Subscription setup failed';
    return c.json({ error: msg }, 502);
  }
});

app.post('/api/memberships/:id/sync', async c => {
  const db = c.env.DB;
  const row = await db.prepare('SELECT * FROM memberships WHERE id = ?').bind(Number(c.req.param('id'))).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.status === 'incomplete' || row.status === 'past_due') {
    try {
      const sub = await stripeRequest(c.env, 'GET', `/subscriptions/${row.stripe_subscription_id}`);
      if (sub.status === 'active' || sub.status === 'trialing') {
        const wasFirst = row.status === 'incomplete';
        await db.prepare(
          `UPDATE memberships SET status = 'active', sessions_used_this_cycle = 0, cycle_started_at = datetime('now') WHERE id = ?`
        ).bind(row.id).run();
        if (wasFirst) {
          const d = await db.prepare(
            `SELECT c.name, c.email, t.name AS tier_name, t.sessions_per_month, t.price_pence
             FROM memberships m JOIN clients c ON c.id = m.client_id JOIN membership_tiers t ON t.id = m.tier_id
             WHERE m.id = ?`
          ).bind(row.id).first();
          if (d) await sendEmail(c.env, c.executionCtx, membershipWelcomeEmail(d.email, d.name, d.tier_name, d.sessions_per_month, d.price_pence));
        }
        return c.json({ status: 'active' });
      }
    } catch { /* report current */ }
  }
  const fresh = await db.prepare('SELECT status FROM memberships WHERE id = ?').bind(row.id).first();
  return c.json({ status: fresh.status });
});

/* POST /api/packages/purchase  { package, client } → { purchaseId, clientSecret, amountPence } */
app.post('/api/packages/purchase', async c => {
  const db = c.env.DB;
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  const { package: slug, client } = body || {};
  if (!client?.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(client?.email || '')) {
    return c.json({ error: 'Name and a valid email are required' }, 400);
  }
  const pkg = await db.prepare('SELECT * FROM packages WHERE slug = ? AND active = 1').bind(String(slug || '')).first();
  if (!pkg) return c.json({ error: 'Unknown programme' }, 400);

  const clientRow = await findOrCreateClient(db, client);
  const purchase = await db.prepare(
    `INSERT INTO package_purchases (client_id, package_slug, status) VALUES (?, ?, 'pending') RETURNING id`
  ).bind(clientRow.id, pkg.slug).first();

  try {
    const pi = await stripeRequest(c.env, 'POST', '/payment_intents', {
      amount: pkg.price_pence,
      currency: 'gbp',
      receipt_email: client.email,
      description: 'AREUM Wellness — ' + pkg.name,
      metadata: { kind: 'package', purchase_id: String(purchase.id) },
      payment_method_types: ['card'],
    });
    await db.prepare('UPDATE package_purchases SET payment_intent_id = ? WHERE id = ?').bind(pi.id, purchase.id).run();
    return c.json({ purchaseId: purchase.id, clientSecret: pi.client_secret, amountPence: pkg.price_pence });
  } catch (e) {
    await db.prepare("UPDATE package_purchases SET status = 'expired' WHERE id = ?").bind(purchase.id).run();
    const msg = e instanceof StripeError ? e.message : 'Payment setup failed';
    return c.json({ error: msg }, 502);
  }
});

app.post('/api/purchases/:id/sync', async c => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const row = await db.prepare('SELECT * FROM package_purchases WHERE id = ?').bind(id).first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.status === 'pending' && row.payment_intent_id) {
    try {
      const pi = await stripeRequest(c.env, 'GET', `/payment_intents/${row.payment_intent_id}`);
      if (pi.status === 'succeeded') {
        const r = await db.prepare(
          `UPDATE package_purchases SET status = 'active', purchased_at = datetime('now'),
             expires_at = datetime('now', '+' || (SELECT expires_months FROM packages WHERE slug = package_slug) || ' months')
           WHERE id = ? AND status = 'pending'`
        ).bind(id).run();
        if (r.meta.changes > 0) {
          const d = await db.prepare(
            `SELECT c.name, c.email, p.name AS pkg_name, p.sessions_total, p.expires_months
             FROM package_purchases pp JOIN clients c ON c.id = pp.client_id JOIN packages p ON p.slug = pp.package_slug
             WHERE pp.id = ?`
          ).bind(id).first();
          if (d) await sendEmail(c.env, c.executionCtx, packageConfirmationEmail(d.email, d.name, d.pkg_name, d.sessions_total, d.expires_months));
        }
        return c.json({ status: 'active' });
      }
    } catch { /* report current */ }
  }
  const fresh = await db.prepare('SELECT status FROM package_purchases WHERE id = ?').bind(id).first();
  return c.json({ status: fresh.status });
});

/* ---------- Stripe webhook ---------- */

app.post('/api/stripe/webhook', async c => {
  const payload = await c.req.text();
  const event = await verifyWebhook(c.env, payload, c.req.header('stripe-signature'));
  if (!event) return c.json({ error: 'Bad signature' }, 400);

  const db = c.env.DB;
  // Idempotency
  const dup = await db.prepare('SELECT 1 FROM webhook_events WHERE stripe_event_id = ?').bind(event.id).first();
  if (dup) return c.json({ received: true });
  await db.prepare('INSERT INTO webhook_events (stripe_event_id) VALUES (?)').bind(event.id).run();

  const obj = event.data?.object;
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const kind = obj.metadata?.kind;
      if (kind === 'booking' && obj.metadata.booking_id) {
        const id = Number(obj.metadata.booking_id);
        const r = await db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ? AND status = 'pending'")
          .bind(id).run();
        if (r.meta.changes > 0) {
          const d = await bookingEmailData(db, id);
          if (d) await sendEmail(c.env, c.executionCtx, bookingConfirmationEmail(d.email, d.name, d.starts_at, d.items, d.amount_pence));
        }
      } else if (kind === 'package' && obj.metadata.purchase_id) {
        const id = Number(obj.metadata.purchase_id);
        const r = await db.prepare(
          `UPDATE package_purchases SET status = 'active', purchased_at = datetime('now'),
             expires_at = datetime('now', '+' || (SELECT expires_months FROM packages WHERE slug = package_slug) || ' months')
           WHERE id = ? AND status = 'pending'`
        ).bind(id).run();
        if (r.meta.changes > 0) {
          const d = await db.prepare(
            `SELECT c.name, c.email, p.name AS pkg_name, p.sessions_total, p.expires_months
             FROM package_purchases pp JOIN clients c ON c.id = pp.client_id JOIN packages p ON p.slug = pp.package_slug
             WHERE pp.id = ?`
          ).bind(id).first();
          if (d) await sendEmail(c.env, c.executionCtx, packageConfirmationEmail(d.email, d.name, d.pkg_name, d.sessions_total, d.expires_months));
        }
      }
      break;
    }
    case 'invoice.paid': {
      const subId = obj.subscription;
      if (subId) {
        await db.prepare(
          `UPDATE memberships SET status = 'active', sessions_used_this_cycle = 0, cycle_started_at = datetime('now')
           WHERE stripe_subscription_id = ?`
        ).bind(subId).run();
      }
      break;
    }
    case 'invoice.payment_failed': {
      const subId = obj.subscription;
      if (subId) {
        await db.prepare("UPDATE memberships SET status = 'past_due' WHERE stripe_subscription_id = ?").bind(subId).run();
      }
      break;
    }
    case 'customer.subscription.deleted': {
      await db.prepare("UPDATE memberships SET status = 'cancelled' WHERE stripe_subscription_id = ?").bind(obj.id).run();
      break;
    }
  }
  return c.json({ received: true });
});

/* ---------- signed forms (medical assessment / treatment consent) ---------- */

const SIG_OK = s => typeof s === 'string' && s.startsWith('data:image/png;base64,') && s.length < 200000;

/* The forms kiosk is clinic-only: page and API both require an admin session
   (owner or staff account) so the public can't spam signed forms. */
async function formsUser(c) {
  return sessionUser(c.env.DB, readSessionCookie(c));
}

app.get('/forms', async c => {
  const user = await formsUser(c);
  const url = new URL(c.req.url);
  url.pathname = user ? '/forms.html' : '/admin/login.html';
  return c.env.ASSETS.fetch(new Request(url, { headers: c.req.raw.headers }));
});
app.get('/forms.html', c => c.redirect('/forms', 301));

app.post('/api/forms', async c => {
  if (!(await formsUser(c))) return c.json({ error: 'Not signed in' }, 401);
  let b;
  try { b = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
  const { kind, data, clientSignature, practitionerSignature } = b || {};
  if (kind !== 'medical' && kind !== 'consent') return c.json({ error: 'Unknown form type' }, 400);
  if (!data || typeof data !== 'object') return c.json({ error: 'Missing form data' }, 400);
  const name = String(data.full_name || '').trim();
  if (name.length < 2) return c.json({ error: 'Full name is required' }, 400);
  if (!SIG_OK(clientSignature)) return c.json({ error: 'Client signature is required' }, 400);
  if (practitionerSignature && !SIG_OK(practitionerSignature)) return c.json({ error: 'Bad practitioner signature' }, 400);
  if (kind === 'medical' && data.declaration !== true) return c.json({ error: 'Please tick the declaration' }, 400);
  if (kind === 'consent') {
    if (!['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].every(k => data[k] === true)) {
      return c.json({ error: 'All consent statements must be ticked' }, 400);
    }
    if (data.gdpr !== true) return c.json({ error: 'GDPR consent is required' }, 400);
  }
  const json = JSON.stringify(data);
  if (json.length > 40000) return c.json({ error: 'Form too large' }, 400);
  const row = await c.env.DB.prepare(
    `INSERT INTO form_submissions (kind, client_name, client_email, data, client_signature, practitioner_signature)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(kind, name, String(data.email || '').trim() || null, json, clientSignature, practitionerSignature || null).first();
  return c.json({ ok: true, id: row.id });
});

/* ---------- admin dashboard ---------- */

registerAdmin(app);

/* ---------- assets passthrough (site + admin shell served from /public) ---------- */

app.all('*', c => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  /* Cron every 30 min: housekeeping + next-day reminder emails */
  async scheduled(_event, env, ctx) {
    await env.DB.prepare(
      "UPDATE bookings SET status = 'cancelled' WHERE status = 'pending' AND created_at <= datetime('now','-30 minutes')"
    ).run();
    await env.DB.prepare(
      "UPDATE package_purchases SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < datetime('now')"
    ).run();

    /* Reminders: bookings starting 23.5–24h from now, not yet reminded.
       The 30-min window matches the cron cadence so each booking hits exactly one pass. */
    const due = (await env.DB.prepare(
      `SELECT b.id, b.starts_at, c.name, c.email
       FROM bookings b JOIN clients c ON c.id = b.client_id
       WHERE b.status = 'confirmed' AND b.reminded_at IS NULL
         AND b.starts_at > datetime('now', '+23 hours', '+30 minutes')
         AND b.starts_at <= datetime('now', '+24 hours')
         AND c.email NOT LIKE '%@clinic.local'`
    ).all()).results;
    for (const b of due) {
      const items = (await env.DB.prepare(
        `SELECT s.name FROM booking_items bi JOIN services s ON s.slug = bi.service_slug WHERE bi.booking_id = ?`
      ).bind(b.id).all()).results.map(r => r.name);
      await env.DB.prepare("UPDATE bookings SET reminded_at = datetime('now') WHERE id = ?").bind(b.id).run();
      await sendEmail(env, ctx, bookingReminderEmail(b.email, b.name, b.starts_at, items));
    }
  },
};
