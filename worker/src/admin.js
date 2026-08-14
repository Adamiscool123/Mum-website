import { hashPassword, verifyPassword, createSession, sessionUser, destroySession, readSessionCookie, sessionCookieHeader, loginAllowed, recordAttempt } from './auth.js';
import { sendEmail, bookingConfirmationEmail } from './email.js';
import { localToUtcIso, utcIsoToLocalHHMM } from './time.js';
import { stripeRequest, StripeError } from './stripe.js';

/* Registers all /admin routes on the main Hono app. */
export function registerAdmin(app) {

  /* ---------- pages (gated) ---------- */
  const servePage = async (c, file) => {
    const url = new URL(c.req.url);
    url.pathname = '/admin/' + file;
    const res = await c.env.ASSETS.fetch(new Request(url, { headers: c.req.raw.headers }));
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  };
  const gate = async c => {
    const user = await sessionUser(c.env.DB, readSessionCookie(c));
    return servePage(c, user ? 'app.html' : 'login.html');
  };
  app.get('/admin', gate);
  app.get('/admin/', gate);
  app.get('/admin/app.html', gate);

  /* ---------- auth ---------- */
  app.post('/admin/api/login', async c => {
    const db = c.env.DB;
    const ip = c.req.header('cf-connecting-ip') || 'local';
    if (!(await loginAllowed(db, ip))) return c.json({ error: 'Too many attempts — try again in 15 minutes' }, 429);
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Bad request' }, 400); }
    const user = await db.prepare('SELECT * FROM admin_users WHERE username = ?').bind(String(body.username || '').trim()).first();
    const ok = user && await verifyPassword(String(body.password || ''), user.password_hash);
    if (!ok) {
      await recordAttempt(db, ip);
      return c.json({ error: 'Wrong username or password' }, 401);
    }
    const token = await createSession(db, user.id);
    c.header('Set-Cookie', sessionCookieHeader(token));
    return c.json({ ok: true });
  });

  app.post('/admin/api/logout', async c => {
    await destroySession(c.env.DB, readSessionCookie(c));
    c.header('Set-Cookie', sessionCookieHeader('', true));
    return c.json({ ok: true });
  });

  /* everything below requires a session */
  const OWNER_ONLY = /^\/admin\/api\/(clients|sales|settings|closed-dates|redeem|account|team-password)(\/|$)/;
  app.use('/admin/api/*', async (c, next) => {
    if (c.req.path === '/admin/api/login' || c.req.path === '/admin/api/logout') return next();
    const user = await sessionUser(c.env.DB, readSessionCookie(c));
    if (!user) return c.json({ error: 'Not signed in' }, 401);
    if (user.role !== 'owner' && OWNER_ONLY.test(c.req.path)) {
      return c.json({ error: 'Not available on this account' }, 403);
    }
    c.set('adminUser', user);
    return next();
  });

  /* ---------- signed forms (both roles can view; delete is owner-only) ---------- */
  app.get('/admin/api/forms', async c => {
    const db = c.env.DB;
    const kind = c.req.query('kind') || '';
    const q = (c.req.query('q') || '').trim();
    let sql = 'SELECT id, kind, client_name, client_email, created_at FROM form_submissions';
    const where = [], bind = [];
    if (kind === 'medical' || kind === 'consent') { where.push('kind = ?'); bind.push(kind); }
    if (q) { where.push('client_name LIKE ? COLLATE NOCASE'); bind.push('%' + q + '%'); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 200';
    const rows = (await db.prepare(sql).bind(...bind).all()).results;
    return c.json({ forms: rows });
  });

  app.get('/admin/api/forms/:id', async c => {
    const row = await c.env.DB.prepare('SELECT * FROM form_submissions WHERE id = ?')
      .bind(c.req.param('id')).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    row.data = JSON.parse(row.data);
    return c.json(row);
  });

  app.delete('/admin/api/forms/:id', async c => {
    if (c.get('adminUser').role !== 'owner') return c.json({ error: 'Owner only' }, 403);
    await c.env.DB.prepare('DELETE FROM form_submissions WHERE id = ?').bind(c.req.param('id')).run();
    return c.json({ ok: true });
  });

  /* ---------- staff daily logs: check-in/out + clinic checks (both roles) ---------- */
  app.get('/admin/api/logs', async c => {
    const rows = (await c.env.DB.prepare(
      'SELECT * FROM staff_logs ORDER BY log_date DESC, created_at DESC LIMIT 60'
    ).all()).results;
    return c.json({ logs: rows });
  });

  app.post('/admin/api/logs', async c => {
    let b;
    try { b = await c.req.json(); } catch { return c.json({ error: 'Bad JSON' }, 400); }
    const name = String(b.staff_name || '').trim();
    if (name.length < 2) return c.json({ error: 'Your name is required' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.log_date || '')) return c.json({ error: 'Bad date' }, 400);
    const time = s => { s = String(s || '').trim(); return /^\d{2}:\d{2}$/.test(s) ? s : null; };
    const text = s => String(s || '').trim().slice(0, 300) || null;
    const flag = s => (s === 'ok' || s === 'issue') ? s : null;
    const row = await c.env.DB.prepare(
      `INSERT INTO staff_logs (log_date, staff_name, check_in, check_out, touch_count, freezer_temp,
         emergency_drugs, emergency_drugs_notes, cleanliness, cleanliness_notes, room_temp, notes, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(
      b.log_date, name, time(b.check_in), time(b.check_out), text(b.touch_count), text(b.freezer_temp),
      flag(b.emergency_drugs), text(b.emergency_drugs_notes), flag(b.cleanliness), text(b.cleanliness_notes),
      text(b.room_temp), text(b.notes), c.get('adminUser').username
    ).first();
    return c.json({ ok: true, id: row.id });
  });

  app.post('/admin/api/logs/:id/checkout', async c => {
    let b;
    try { b = await c.req.json(); } catch { b = {}; }
    const t = String(b.time || '').trim();
    if (!/^\d{2}:\d{2}$/.test(t)) return c.json({ error: 'Bad time' }, 400);
    await c.env.DB.prepare('UPDATE staff_logs SET check_out = ? WHERE id = ?').bind(t, c.req.param('id')).run();
    return c.json({ ok: true });
  });

  app.delete('/admin/api/logs/:id', async c => {
    if (c.get('adminUser').role !== 'owner') return c.json({ error: 'Owner only' }, 403);
    await c.env.DB.prepare('DELETE FROM staff_logs WHERE id = ?').bind(c.req.param('id')).run();
    return c.json({ ok: true });
  });

  /* who am I — both roles need this to shape the UI */
  app.get('/admin/api/me', c => {
    const me = c.get('adminUser');
    return c.json({ username: me.username, role: me.role });
  });

  /* owner resets the shared staff login password (their own password confirms it) */
  app.post('/admin/api/team-password', async c => {
    const db = c.env.DB;
    const me = c.get('adminUser');
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Bad request' }, 400); }
    const row = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(me.id).first();
    if (!(await verifyPassword(String(body.currentPassword || ''), row.password_hash))) {
      return c.json({ error: 'Your password is wrong' }, 403);
    }
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 8) return c.json({ error: 'New password must be at least 8 characters' }, 400);
    const staff = await db.prepare("SELECT id FROM admin_users WHERE role = 'staff' LIMIT 1").first();
    if (!staff) return c.json({ error: 'No staff account found' }, 404);
    await db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(newPassword), staff.id).run();
    await db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').bind(staff.id).run();
    return c.json({ ok: true });
  });

  app.post('/admin/api/account', async c => {
    const db = c.env.DB;
    const me = c.get('adminUser');
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Bad request' }, 400); }
    const row = await db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(me.id).first();
    if (!(await verifyPassword(String(body.currentPassword || ''), row.password_hash))) {
      return c.json({ error: 'Current password is wrong' }, 403);
    }
    const newUsername = String(body.username || '').trim();
    const newPassword = String(body.newPassword || '');
    if (newUsername && newUsername !== row.username) {
      await db.prepare('UPDATE admin_users SET username = ? WHERE id = ?').bind(newUsername, me.id).run();
    }
    if (newPassword) {
      if (newPassword.length < 8) return c.json({ error: 'New password must be at least 8 characters' }, 400);
      await db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
        .bind(await hashPassword(newPassword), me.id).run();
      /* log every other device out */
      const keep = readSessionCookie(c);
      const sessions = (await db.prepare('SELECT token_hash FROM admin_sessions WHERE user_id = ?').bind(me.id).all()).results;
      void sessions; // simplest: keep current session, drop the rest
      await db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').bind(me.id).run();
      const token = await createSession(db, me.id);
      void keep;
      c.header('Set-Cookie', sessionCookieHeader(token));
    }
    return c.json({ ok: true });
  });

  /* ---------- day view ---------- */
  app.get('/admin/api/day', async c => {
    const db = c.env.DB;
    const date = c.req.query('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return c.json({ error: 'Bad date' }, 400);
    const start = localToUtcIso(date, '00:00');
    const end = new Date(Date.parse(start) + 36 * 3600000).toISOString(); // generous window, filtered below
    const rows = (await db.prepare(
      `SELECT b.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email
       FROM bookings b JOIN clients c ON c.id = b.client_id
       WHERE b.starts_at >= ? AND b.starts_at < ? ORDER BY b.starts_at`
    ).bind(start, end).all()).results;
    const dayRows = rows.filter(r => {
      const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(r.starts_at));
      return local === date;
    });
    const ids = dayRows.map(r => r.id);
    let items = [];
    if (ids.length) {
      items = (await db.prepare(
        `SELECT bi.booking_id, s.name FROM booking_items bi JOIN services s ON s.slug = bi.service_slug
         WHERE bi.booking_id IN (${ids.map(() => '?').join(',')})`
      ).bind(...ids).all()).results;
    }
    const closed = await db.prepare('SELECT reason FROM closed_dates WHERE date = ?').bind(date).first();
    return c.json({
      date,
      closed: closed ? (closed.reason || 'Closed') : null,
      bookings: dayRows.map(r => ({
        id: r.id,
        time: utcIsoToLocalHHMM(r.starts_at),
        endTime: utcIsoToLocalHHMM(r.ends_at),
        status: r.status,
        source: r.source,
        amountPence: r.amount_pence,
        refundedAt: r.refunded_at || null,
        notes: r.notes,
        client: { id: r.client_id, name: r.client_name, phone: r.client_phone, email: r.client_email },
        items: items.filter(i => i.booking_id === r.id).map(i => i.name),
      })),
    });
  });

  /* ---------- walk-in booking ---------- */
  app.post('/admin/api/bookings', async c => {
    const db = c.env.DB;
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Bad request' }, 400); }
    const { items, date, time, client, notes, paid } = body || {};
    if (!Array.isArray(items) || !items.length) return c.json({ error: 'Pick at least one treatment' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return c.json({ error: 'Pick a date and time' }, 400);
    if (!client?.name) return c.json({ error: 'Client name is required' }, 400);

    const placeholders = items.map(() => '?').join(',');
    const services = (await db.prepare(
      `SELECT slug, name, price_pence, duration_min FROM services WHERE slug IN (${placeholders})`
    ).bind(...items).all()).results;
    const bySlug = Object.fromEntries(services.map(s => [s.slug, s]));
    const chosen = items.map(s => bySlug[s]).filter(Boolean);
    if (chosen.length !== items.length) return c.json({ error: 'Unknown treatment' }, 400);

    const email = (client.email || '').trim() || ('walkin' + Date.now() + '@clinic.local');
    const clientRow = await db.prepare('SELECT * FROM clients WHERE email = ?').bind(email).first()
      || await db.prepare('INSERT INTO clients (name, email, phone) VALUES (?, ?, ?) RETURNING *')
        .bind(client.name, email, client.phone || null).first();

    const startsAt = localToUtcIso(date, time);
    const duration = chosen.reduce((a, s) => a + s.duration_min, 0);
    const endsAt = new Date(Date.parse(startsAt) + duration * 60000).toISOString();
    const amount = paid === 'redeemed' ? 0 : chosen.reduce((a, s) => a + s.price_pence, 0);

    const booking = await db.prepare(
      `INSERT INTO bookings (client_id, starts_at, ends_at, status, source, amount_pence, notes)
       VALUES (?, ?, ?, 'confirmed', 'walk_in', ?, ?) RETURNING id`
    ).bind(clientRow.id, startsAt, endsAt, amount, notes || null).first();
    for (const s of chosen) {
      await db.prepare('INSERT INTO booking_items (booking_id, service_slug, price_pence) VALUES (?, ?, ?)')
        .bind(booking.id, s.slug, s.price_pence).run();
    }

    /* Walk-ins with a real email get the same confirmation as online bookings
       (placeholder @clinic.local addresses are skipped). */
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !email.endsWith('@clinic.local')) {
      await sendEmail(c.env, c.executionCtx,
        bookingConfirmationEmail(email, client.name, startsAt, chosen.map(s => s.name), amount));
    }

    return c.json({ ok: true, id: booking.id });
  });

  /* ---------- booking updates ---------- */
  app.patch('/admin/api/bookings/:id', async c => {
    const db = c.env.DB;
    const id = Number(c.req.param('id'));
    const row = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Not found' }, 404);
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Bad request' }, 400); }

    if (body.status) {
      const allowed = ['confirmed', 'completed', 'no_show', 'cancelled'];
      if (!allowed.includes(body.status)) return c.json({ error: 'Bad status' }, 400);
      /* Cancel & refund: money back through Stripe FIRST — the booking is only
         cancelled once the refund has gone through, so a failed refund never
         leaves a cancelled booking with the client's money still taken. */
      if (body.status === 'cancelled' && body.refund) {
        if (!row.payment_intent_id || !row.amount_pence) return c.json({ error: 'This booking has no card payment to refund' }, 400);
        if (row.refunded_at) return c.json({ error: 'Already refunded' }, 409);
        try {
          await stripeRequest(c.env, 'POST', '/refunds', { payment_intent: row.payment_intent_id });
        } catch (e) {
          const msg = e instanceof StripeError ? e.message : 'Refund failed';
          return c.json({ error: 'Refund failed — booking NOT cancelled. ' + msg }, 502);
        }
        await db.prepare("UPDATE bookings SET refunded_at = datetime('now') WHERE id = ?").bind(id).run();
      }
      await db.prepare('UPDATE bookings SET status = ? WHERE id = ?').bind(body.status, id).run();
    }
    if (body.notes !== undefined) {
      await db.prepare('UPDATE bookings SET notes = ? WHERE id = ?').bind(String(body.notes || '') || null, id).run();
    }
    if (body.date && body.time) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !/^\d{2}:\d{2}$/.test(body.time)) return c.json({ error: 'Bad date/time' }, 400);
      const durationMs = Date.parse(row.ends_at) - Date.parse(row.starts_at);
      const startsAt = localToUtcIso(body.date, body.time);
      const endsAt = new Date(Date.parse(startsAt) + durationMs).toISOString();
      await db.prepare('UPDATE bookings SET starts_at = ?, ends_at = ? WHERE id = ?').bind(startsAt, endsAt, id).run();
    }
    return c.json({ ok: true });
  });

  /* ---------- clients ---------- */
  app.get('/admin/api/clients', async c => {
    const db = c.env.DB;
    const q = (c.req.query('q') || '').trim();
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const rows = (await db.prepare(
      `SELECT c.id, c.name, c.email, c.phone,
              (SELECT MAX(starts_at) FROM bookings b WHERE b.client_id = c.id AND b.status IN ('confirmed','completed')) AS last_visit
       FROM clients c
       WHERE (? = '' OR c.name LIKE ? OR c.email LIKE ? OR IFNULL(c.phone,'') LIKE ?)
       ORDER BY c.name COLLATE NOCASE LIMIT 100`
    ).bind(q, like, like, like).all()).results;
    return c.json({ clients: rows });
  });

  app.get('/admin/api/clients/:id', async c => {
    const db = c.env.DB;
    const id = Number(c.req.param('id'));
    const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
    if (!client) return c.json({ error: 'Not found' }, 404);
    const bookings = (await db.prepare(
      `SELECT id, starts_at, status, amount_pence FROM bookings WHERE client_id = ? ORDER BY starts_at DESC LIMIT 20`
    ).bind(id).all()).results;
    const memberships = (await db.prepare(
      `SELECT m.id, m.status, m.sessions_used_this_cycle, m.cycle_started_at, t.name AS tier_name, t.sessions_per_month, t.price_pence
       FROM memberships m JOIN membership_tiers t ON t.id = m.tier_id
       WHERE m.client_id = ? AND m.status IN ('active','past_due') ORDER BY m.id DESC`
    ).bind(id).all()).results;
    const packages = (await db.prepare(
      `SELECT pp.id, pp.status, pp.sessions_used, pp.expires_at, p.name, p.sessions_total
       FROM package_purchases pp JOIN packages p ON p.slug = pp.package_slug
       WHERE pp.client_id = ? AND pp.status = 'active' ORDER BY pp.id DESC`
    ).bind(id).all()).results;
    return c.json({ client, bookings, memberships, packages });
  });

  app.patch('/admin/api/clients/:id', async c => {
    const db = c.env.DB;
    const id = Number(c.req.param('id'));
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Bad request' }, 400); }
    if (body.notes !== undefined) {
      await db.prepare('UPDATE clients SET notes = ? WHERE id = ?').bind(String(body.notes || '') || null, id).run();
    }
    return c.json({ ok: true });
  });

  /* ---------- redeem session credits ---------- */
  app.post('/admin/api/redeem', async c => {
    const db = c.env.DB;
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Bad request' }, 400); }
    const delta = body.delta === -1 ? -1 : 1;
    if (body.kind === 'membership') {
      const m = await db.prepare(
        `SELECT m.*, t.sessions_per_month FROM memberships m JOIN membership_tiers t ON t.id = m.tier_id WHERE m.id = ?`
      ).bind(Number(body.id)).first();
      if (!m) return c.json({ error: 'Not found' }, 404);
      const next = m.sessions_used_this_cycle + delta;
      if (next < 0 || next > m.sessions_per_month) return c.json({ error: 'No sessions left this month' }, 409);
      await db.prepare('UPDATE memberships SET sessions_used_this_cycle = ? WHERE id = ?').bind(next, m.id).run();
      return c.json({ ok: true, used: next, total: m.sessions_per_month });
    }
    if (body.kind === 'package') {
      const p = await db.prepare(
        `SELECT pp.*, p.sessions_total FROM package_purchases pp JOIN packages p ON p.slug = pp.package_slug WHERE pp.id = ?`
      ).bind(Number(body.id)).first();
      if (!p) return c.json({ error: 'Not found' }, 404);
      const next = p.sessions_used + delta;
      if (next < 0 || next > p.sessions_total) return c.json({ error: 'No sessions left on this programme' }, 409);
      await db.prepare('UPDATE package_purchases SET sessions_used = ? WHERE id = ?').bind(next, p.id).run();
      return c.json({ ok: true, used: next, total: p.sessions_total });
    }
    return c.json({ error: 'Bad kind' }, 400);
  });

  /* ---------- sales ---------- */
  app.get('/admin/api/sales', async c => {
    const db = c.env.DB;
    const days = Math.min(365, Math.max(1, parseInt(c.req.query('days') || '30', 10)));
    const bookings = (await db.prepare(
      `SELECT b.id, b.starts_at AS at, b.amount_pence, c.name AS client_name, b.source, b.status
       FROM bookings b JOIN clients c ON c.id = b.client_id
       WHERE b.status IN ('confirmed','completed') AND b.created_at > datetime('now', '-${days} days')
       ORDER BY b.created_at DESC LIMIT 200`
    ).all()).results;
    const packages = (await db.prepare(
      `SELECT pp.id, pp.purchased_at AS at, p.price_pence AS amount_pence, c.name AS client_name, p.name
       FROM package_purchases pp JOIN packages p ON p.slug = pp.package_slug JOIN clients c ON c.id = pp.client_id
       WHERE pp.status = 'active' AND pp.purchased_at > datetime('now', '-${days} days')
       ORDER BY pp.purchased_at DESC LIMIT 200`
    ).all()).results;
    const memberships = (await db.prepare(
      `SELECT m.id, m.cycle_started_at AS at, t.price_pence AS amount_pence, c.name AS client_name, t.name
       FROM memberships m JOIN membership_tiers t ON t.id = m.tier_id JOIN clients c ON c.id = m.client_id
       WHERE m.status = 'active' ORDER BY m.id DESC LIMIT 200`
    ).all()).results;
    return c.json({ bookings, packages, memberships });
  });

  /* ---------- settings ---------- */
  app.get('/admin/api/settings', async c => {
    const db = c.env.DB;
    const rows = (await db.prepare('SELECT key, value FROM settings').all()).results;
    const closed = (await db.prepare('SELECT date, reason FROM closed_dates ORDER BY date').all()).results;
    const me = c.get('adminUser');
    return c.json({
      settings: Object.fromEntries(rows.map(r => [r.key, r.value])),
      closedDates: closed,
      username: me.username,
    });
  });

  app.put('/admin/api/settings', async c => {
    const db = c.env.DB;
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Bad request' }, 400); }
    const allowed = ['capacity', 'daily_cap', 'slot_minutes', 'lead_time_minutes', 'cancel_window_hours', 'hours'];
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      let value = String(body[key]);
      if (key === 'hours') {
        try { JSON.parse(value); } catch { return c.json({ error: 'Bad hours format' }, 400); }
      } else if (!/^\d{1,4}$/.test(value)) {
        return c.json({ error: 'Bad value for ' + key }, 400);
      }
      await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .bind(key, value).run();
    }
    return c.json({ ok: true });
  });

  app.post('/admin/api/closed-dates', async c => {
    const db = c.env.DB;
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Bad request' }, 400); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) return c.json({ error: 'Bad date' }, 400);
    await db.prepare('INSERT INTO closed_dates (date, reason) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET reason = excluded.reason')
      .bind(body.date, String(body.reason || '') || null).run();
    return c.json({ ok: true });
  });

  app.delete('/admin/api/closed-dates/:date', async c => {
    await c.env.DB.prepare('DELETE FROM closed_dates WHERE date = ?').bind(c.req.param('date')).run();
    return c.json({ ok: true });
  });

  /* services list for the walk-in picker */
  app.get('/admin/api/services', async c => {
    const rows = (await c.env.DB.prepare(
      'SELECT slug, name, category, price_pence, duration_min FROM services WHERE active = 1 ORDER BY category, price_pence'
    ).all()).results;
    return c.json({ services: rows });
  });
}
