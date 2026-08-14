/* AREUM clinic dashboard */
(function () {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  const toastEl = $('toast');
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function money(pence) { return '£' + (pence / 100).toLocaleString('en-GB'); }

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({
      headers: opts && opts.body ? { 'Content-Type': 'application/json' } : undefined,
    }, opts));
    if (res.status === 401) { location.reload(); throw new Error('signed out'); }
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Something went wrong'); throw new Error(data.error || res.status); }
    return data;
  }

  /* ---------- sheet (bottom modal) ---------- */
  const sheet = $('sheet'), sheetScrim = $('sheet-scrim');
  function openSheet(html) {
    sheet.innerHTML = '<div class="grab"></div>' + html;
    sheet.classList.add('open');
    sheetScrim.classList.add('show');
  }
  function closeSheet() {
    sheet.classList.remove('open');
    sheetScrim.classList.remove('show');
  }
  sheetScrim.addEventListener('click', closeSheet);

  /* ---------- tabs ---------- */
  let myRole = 'owner';
  const loaders = { today: loadDay, forms: loadForms, logs: loadLogs, clients: loadClients, sales: loadSales, settings: loadSettings };
  const STAFF_VIEWS = ['today', 'forms', 'logs'];
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (myRole !== 'owner' && !STAFF_VIEWS.includes(btn.dataset.view)) return;
      document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      $('view-' + btn.dataset.view).classList.add('active');
      $('fab').style.display = btn.dataset.view === 'today' ? '' : 'none';
      loaders[btn.dataset.view]();
    });
  });

  function applyRole() {
    if (myRole === 'owner') return;
    /* staff account: bookings only */
    const tabs = document.querySelector('.tabs');
    ['clients', 'sales', 'settings'].forEach(v => {
      const btn = tabs.querySelector('[data-view="' + v + '"]');
      if (btn) btn.remove();
    });
    const out = document.createElement('button');
    out.textContent = 'Sign out';
    out.addEventListener('click', async () => {
      await api('/admin/api/logout', { method: 'POST' });
      location.reload();
    });
    tabs.appendChild(out);
    tabs.style.gridTemplateColumns = 'repeat(4, 1fr)';
  }

  /* ---------- signed forms ---------- */
  const KIND_LABEL = { medical: 'Medical', consent: 'Consent' };
  const HX_LABELS = {
    hx_heart: 'Heart disease', hx_high_bp: 'High blood pressure', hx_low_bp: 'Low blood pressure',
    hx_diabetes: 'Diabetes', hx_kidney: 'Kidney disease', hx_liver: 'Liver disease',
    hx_thyroid: 'Thyroid disease', hx_asthma: 'Asthma', hx_epilepsy: 'Epilepsy', hx_cancer: 'Cancer',
    hx_autoimmune: 'Autoimmune disease', hx_bleeding: 'Bleeding disorder', hx_clots: 'Blood clots',
    hx_none: 'None of the above'
  };
  const PREG_LABELS = { preg_pregnant: 'Pregnant', preg_trying: 'Trying to conceive', preg_breastfeeding: 'Breastfeeding', preg_na: 'Not applicable' };
  const MED_SECTIONS = [
    ['Personal details', [['full_name', 'Full name'], ['dob', 'Date of birth'], ['address', 'Address'], ['mobile', 'Mobile'], ['email', 'Email'], ['gp_name', 'GP name'], ['emergency_contact', 'Emergency contact'], ['emergency_number', 'Emergency number']]],
    ['Allergies & medication', [['allergies', 'Allergies'], ['medications', 'Current medications'], ['supplements', 'Supplements / vitamins']]],
    ['Lifestyle', [['smoking', 'Smoking'], ['alcohol', 'Alcohol'], ['exercise', 'Exercise'], ['water_intake', 'Daily water intake']]],
    ['Previous IV therapy', [['iv_before', 'Received IV therapy before'], ['iv_reactions', 'Previous reactions']]],
    ['Wellness goal', [['visit_reason', "Reason for today's visit"]]],
    ['Practitioner assessment', [['bp', 'Blood pressure'], ['heart_rate', 'Heart rate'], ['temperature', 'Temperature'], ['spo2', 'SpO2'], ['weight', 'Weight'], ['cannula_site', 'Cannula site'], ['treatment_recommended', 'Treatment recommended'], ['clinical_notes', 'Clinical notes']]]
  ];
  const CONSENT_SECTIONS = [
    ['Client', [['full_name', 'Full name'], ['email', 'Email']]],
    ['Treatment record', [['treatment', 'Treatment'], ['batch_number', 'Batch number'], ['expiry_date', 'Expiry date'], ['clinician', 'Clinician'], ['cannula_size', 'Cannula size'], ['site', 'Site'], ['start_time', 'Start time'], ['finish_time', 'Finish time'], ['observations', 'Observations']]]
  ];

  let formKind = '';
  document.querySelectorAll('#form-filter button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#form-filter button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      formKind = b.dataset.kind;
      loadForms();
    });
  });
  let formSearchT;
  $('form-search').addEventListener('input', () => {
    clearTimeout(formSearchT);
    formSearchT = setTimeout(loadForms, 250);
  });

  function fmtWhen(iso) {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('en-GB', {
      timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  async function loadForms() {
    const q = $('form-search').value.trim();
    const data = await api('/admin/api/forms?kind=' + formKind + '&q=' + encodeURIComponent(q));
    const el = $('form-list');
    if (!data.forms.length) { el.innerHTML = '<p class="empty">No signed forms' + (q ? ' matching “' + esc(q) + '”' : ' yet') + '</p>'; return; }
    el.innerHTML = data.forms.map(f =>
      '<div class="form-row" data-id="' + f.id + '">' +
      '<div><div class="fr-name">' + esc(f.client_name) + '</div>' +
      '<div class="fr-meta">' + fmtWhen(f.created_at) + (f.client_email ? ' · ' + esc(f.client_email) : '') + '</div></div>' +
      '<span class="form-kind">' + KIND_LABEL[f.kind] + '</span></div>'
    ).join('');
    el.querySelectorAll('.form-row').forEach(r => r.addEventListener('click', () => openFormSheet(r.dataset.id)));
  }

  function tickedList(data, labels) {
    const on = Object.keys(labels).filter(k => data[k] === true).map(k => labels[k]);
    return on.length ? on.join(', ') : 'None recorded';
  }

  function formBodyHtml(f) {
    const d = f.data;
    let html = '';
    const sections = f.kind === 'medical' ? MED_SECTIONS : CONSENT_SECTIONS;
    sections.forEach(sec => {
      const rows = sec[1].filter(p => d[p[0]]).map(p =>
        '<p><b>' + p[1] + '</b>' + esc(String(d[p[0]])) + '</p>').join('');
      if (rows) html += '<h4 class="fdet-h">' + sec[0] + '</h4><div class="fdet-grid">' + rows + '</div>';
      if (f.kind === 'medical' && sec[0] === 'Personal details') {
        html += '<h4 class="fdet-h">Medical history</h4><p class="fdet-line">' + esc(tickedList(d, HX_LABELS)) + '</p>' +
                '<h4 class="fdet-h">Pregnancy</h4><p class="fdet-line">' + esc(tickedList(d, PREG_LABELS)) + '</p>';
      }
    });
    if (f.kind === 'consent') {
      html += '<h4 class="fdet-h">Consent</h4><p class="fdet-line">All six consent statements ticked · GDPR consent given</p>';
    } else {
      html += '<h4 class="fdet-h">Declaration</h4><p class="fdet-line">Information confirmed true and complete</p>';
    }
    html += '<h4 class="fdet-h">Client signature</h4><img class="sig-img" src="' + f.client_signature + '" alt="Client signature">';
    if (f.practitioner_signature) {
      html += '<h4 class="fdet-h">Practitioner signature</h4><img class="sig-img" src="' + f.practitioner_signature + '" alt="Practitioner signature">';
    }
    return html;
  }

  async function openFormSheet(id) {
    const f = await api('/admin/api/forms/' + id);
    openSheet(
      '<h3>' + esc(f.client_name) + '</h3>' +
      '<p class="muted" style="margin:0.2rem 0 0.8rem">' +
      (f.kind === 'medical' ? 'Medical Assessment' : 'Treatment Consent') + ' · signed ' + fmtWhen(f.created_at) + '</p>' +
      formBodyHtml(f) +
      '<div class="btnrow" style="margin-top:1.2rem">' +
      '<button class="b primary" id="form-print">Print</button>' +
      (myRole === 'owner' ? '<button class="b bad" id="form-del">Delete</button>' : '') +
      '</div>'
    );
    $('form-print').addEventListener('click', () => printForm(f));
    const del = $('form-del');
    if (del) {
      del.addEventListener('click', async () => {
        if (!confirm('Delete this signed form permanently? This cannot be undone.')) return;
        await api('/admin/api/forms/' + id, { method: 'DELETE' });
        closeSheet();
        loadForms();
        toast('Form deleted');
      });
    }
  }

  function printForm(f) {
    const area = $('print-area');
    area.innerHTML =
      '<h1 style="font-size:1.15rem">AREUM WELLNESS LONDON — ' +
      (f.kind === 'medical' ? 'Medical Assessment Form' : 'Treatment Consent Form') + '</h1>' +
      '<p style="margin:0.3rem 0 1rem">' + esc(f.client_name) + ' · signed ' + fmtWhen(f.created_at) + '</p>' +
      formBodyHtml(f);
    window.print();
  }

  /* ---------- staff daily logs (Checks tab) ---------- */
  const LOG_FLAG = { ok: 'OK', issue: 'Needs attention' };
  function nowLondon() {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  }
  function todayLondon() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  async function loadLogs() {
    const data = await api('/admin/api/logs');
    const el = $('log-list');
    if (!data.logs.length) { el.innerHTML = '<p class="empty">No logs yet — tap “New daily log” when you arrive.</p>'; return; }
    const niceDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
    el.innerHTML = data.logs.map(l => {
      const bits = ['In ' + (l.check_in || '—') + (l.check_out ? ' · Out ' + l.check_out : '')];
      if (l.freezer_temp) bits.push('Freezer ' + esc(l.freezer_temp));
      if (l.room_temp) bits.push('Room ' + esc(l.room_temp));
      if (l.emergency_drugs) bits.push('Drugs ' + LOG_FLAG[l.emergency_drugs]);
      if (l.cleanliness) bits.push('Clean ' + LOG_FLAG[l.cleanliness]);
      if (l.touch_count) bits.push('Touch ' + esc(l.touch_count));
      return '<div class="form-row" data-id="' + l.id + '">' +
        '<div><div class="fr-name">' + esc(l.staff_name) + ' <span class="muted" style="font-weight:400">· ' + niceDate(l.log_date) + '</span></div>' +
        '<div class="fr-meta">' + bits.join(' · ') + '</div></div>' +
        (!l.check_out ? '<span class="form-kind">On shift</span>' : '') +
        '</div>';
    }).join('');
    el.querySelectorAll('.form-row').forEach(r =>
      r.addEventListener('click', () => openLogSheet(data.logs.find(x => String(x.id) === r.dataset.id))));
  }

  $('log-new').addEventListener('click', () => {
    openSheet(
      '<h3>New daily log</h3><p class="sub">' +
      new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' }) + '</p>' +
      '<label for="lg-name">Your name</label><input id="lg-name">' +
      '<div class="pick" style="grid-template-columns:1fr 1fr">' +
      '<span><label for="lg-in">Check-in time</label><input type="time" id="lg-in" value="' + nowLondon() + '"></span>' +
      '<span><label for="lg-out">Check-out (leave empty)</label><input type="time" id="lg-out"></span></div>' +
      '<div class="pick" style="grid-template-columns:1fr 1fr">' +
      '<span><label for="lg-freezer">Freezer temp (&deg;C)</label><input id="lg-freezer" inputmode="numeric"></span>' +
      '<span><label for="lg-room">Room temp (&deg;C)</label><input id="lg-room" inputmode="numeric"></span></div>' +
      '<label for="lg-touch">Touch count</label><input id="lg-touch" inputmode="numeric">' +
      '<label for="lg-drugs">Emergency drug check</label>' +
      '<select id="lg-drugs"><option value="">&mdash;</option><option value="ok">OK</option><option value="issue">Needs attention</option></select>' +
      '<label for="lg-drugs-notes">Emergency drug notes (optional)</label><input id="lg-drugs-notes">' +
      '<label for="lg-clean">Clinic cleanliness check</label>' +
      '<select id="lg-clean"><option value="">&mdash;</option><option value="ok">OK</option><option value="issue">Needs attention</option></select>' +
      '<label for="lg-clean-notes">Cleanliness notes (optional)</label><input id="lg-clean-notes">' +
      '<label for="lg-notes">Other notes (optional)</label><input id="lg-notes">' +
      '<div class="btnrow"><button class="b primary" id="lg-save">Save log</button></div>'
    );
    $('lg-save').addEventListener('click', async () => {
      const name = $('lg-name').value.trim();
      if (name.length < 2) { toast('Please enter your name'); return; }
      const out = await api('/admin/api/logs', {
        method: 'POST',
        body: JSON.stringify({
          log_date: todayLondon(), staff_name: name,
          check_in: $('lg-in').value, check_out: $('lg-out').value,
          touch_count: $('lg-touch').value, freezer_temp: $('lg-freezer').value,
          emergency_drugs: $('lg-drugs').value, emergency_drugs_notes: $('lg-drugs-notes').value,
          cleanliness: $('lg-clean').value, cleanliness_notes: $('lg-clean-notes').value,
          room_temp: $('lg-room').value, notes: $('lg-notes').value
        })
      });
      if (out && out.ok) { closeSheet(); loadLogs(); toast('Log saved'); }
    });
  });

  function openLogSheet(l) {
    if (!l) return;
    const row = (k, v) => v ? '<p><b>' + k + '</b>' + esc(String(v)) + '</p>' : '';
    openSheet(
      '<h3>' + esc(l.staff_name) + '</h3><p class="sub">' + l.log_date + '</p>' +
      '<div class="fdet-grid">' +
      row('Check-in', l.check_in) + row('Check-out', l.check_out) +
      row('Touch count', l.touch_count) + row('Freezer temp', l.freezer_temp) +
      row('Room temp', l.room_temp) +
      row('Emergency drugs', l.emergency_drugs && LOG_FLAG[l.emergency_drugs]) +
      row('Drug notes', l.emergency_drugs_notes) +
      row('Cleanliness', l.cleanliness && LOG_FLAG[l.cleanliness]) +
      row('Cleanliness notes', l.cleanliness_notes) +
      row('Notes', l.notes) +
      row('Logged by', l.submitted_by) +
      '</div>' +
      '<div class="btnrow" style="margin-top:1rem">' +
      (!l.check_out ? '<button class="b primary" id="lg-checkout">Check out now (' + nowLondon() + ')</button>' : '') +
      (myRole === 'owner' ? '<button class="b bad" id="lg-del">Delete</button>' : '') +
      '</div>'
    );
    const co = $('lg-checkout');
    if (co) {
      co.addEventListener('click', async () => {
        await api('/admin/api/logs/' + l.id + '/checkout', { method: 'POST', body: JSON.stringify({ time: nowLondon() }) });
        closeSheet();
        loadLogs();
        toast('Checked out');
      });
    }
    const del = $('lg-del');
    if (del) {
      del.addEventListener('click', async () => {
        if (!confirm('Delete this log?')) return;
        await api('/admin/api/logs/' + l.id, { method: 'DELETE' });
        closeSheet();
        loadLogs();
        toast('Log deleted');
      });
    }
  }

  /* ---------- day view ---------- */
  function todayStr() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  let day = todayStr();
  function shiftDay(delta) {
    const d = new Date(day + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + delta);
    day = d.toISOString().slice(0, 10);
    loadDay();
  }
  $('prev-day').addEventListener('click', () => shiftDay(-1));
  $('next-day').addEventListener('click', () => shiftDay(1));
  $('day-pick').addEventListener('change', e => { if (e.target.value) { day = e.target.value; loadDay(); } });

  const STATUS_LABEL = { confirmed: 'Confirmed', completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled', pending: 'Unpaid' };

  async function loadDay() {
    $('day-pick').value = day;
    const nice = new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
    $('day-label').textContent = day === todayStr() ? 'Today — ' + nice : nice;
    const data = await api('/admin/api/day?date=' + day);
    const list = $('day-list');
    let html = '';
    if (data.closed) html += '<p class="empty">Clinic closed — ' + esc(data.closed) + '</p>';
    const visible = data.bookings.filter(b => b.status !== 'cancelled' || b.source !== 'online');
    if (!visible.length && !data.closed) html += '<p class="empty">No bookings this day</p>';
    visible.forEach(b => {
      html += '<div class="bk" data-id="' + b.id + '">' +
        '<div class="bk-time">' + b.time + '<small>to ' + b.endTime + '</small></div>' +
        '<div><div class="bk-name">' + esc(b.client.name) + '</div>' +
        '<div class="bk-items">' + esc(b.items.join(', ')) + '</div></div>' +
        '<span class="chip ' + b.status + '">' + (STATUS_LABEL[b.status] || b.status) + '</span></div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.bk').forEach(el => {
      el.addEventListener('click', () => {
        const b = data.bookings.find(x => x.id === Number(el.dataset.id));
        bookingSheet(b);
      });
    });
  }

  function bookingSheet(b) {
    openSheet(
      '<h3>' + b.time + ' &mdash; ' + esc(b.client.name) + '</h3>' +
      '<p class="sub">' + esc(b.items.join(', ')) + '</p>' +
      '<div class="kv"><span>Status</span><span>' + (STATUS_LABEL[b.status] || b.status) + '</span></div>' +
      '<div class="kv"><span>Paid</span><span>' + (b.amountPence ? money(b.amountPence) + (b.refundedAt ? ' — refunded' : b.status === 'pending' ? ' (unpaid)' : '') : 'Session credit / free') + '</span></div>' +
      (b.client.phone ? '<div class="kv"><span>Phone</span><span><a href="tel:' + esc(b.client.phone) + '">' + esc(b.client.phone) + '</a></span></div>' : '') +
      (b.client.email && b.client.email.indexOf('@clinic.local') === -1 ? '<div class="kv"><span>Email</span><span>' + esc(b.client.email) + '</span></div>' : '') +
      '<label for="bs-notes">Notes</label>' +
      '<textarea id="bs-notes" rows="2">' + esc(b.notes || '') + '</textarea>' +
      '<div class="btnrow">' +
      '<button class="b good" data-st="completed">Completed</button>' +
      '<button class="b bad" data-st="no_show">No-show</button>' +
      '<button class="b" data-st="confirmed">Confirmed</button>' +
      (b.source === 'online' && b.amountPence > 0 && !b.refundedAt && b.status !== 'cancelled' && b.status !== 'pending'
        ? '<button class="b bad" id="bs-cancel-refund">Cancel &amp; refund ' + money(b.amountPence) + '</button>' +
          '<button class="b bad" data-st="cancelled">Cancel only (keep payment)</button>'
        : '<button class="b bad" data-st="cancelled">Cancel booking</button>') +
      '</div>' +
      '<label>Move booking</label>' +
      '<div class="pick" style="grid-template-columns:1fr 1fr">' +
      '<input type="date" id="bs-date" value="' + day + '">' +
      '<input type="time" id="bs-time" value="' + b.time + '">' +
      '</div>' +
      '<div class="btnrow">' +
      '<button class="b" id="bs-move">Move</button>' +
      '<button class="b" id="bs-save-notes">Save notes</button>' +
      (myRole === 'owner' ? '<button class="b" id="bs-client">Open client</button>' : '') +
      '</div>'
    );
    sheet.querySelectorAll('[data-st]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api('/admin/api/bookings/' + b.id, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.st }) });
        toast('Updated'); closeSheet(); loadDay();
      });
    });
    const refundBtn = $('bs-cancel-refund');
    if (refundBtn) refundBtn.addEventListener('click', async () => {
      if (!confirm('Refund ' + money(b.amountPence) + ' to ' + b.client.name + '’s card and cancel the booking? The money goes back in 5–10 working days. This can’t be undone.')) return;
      refundBtn.disabled = true;
      try {
        await api('/admin/api/bookings/' + b.id, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled', refund: true }) });
        toast('Cancelled — ' + money(b.amountPence) + ' refunded'); closeSheet(); loadDay();
      } catch (e) { refundBtn.disabled = false; }
    });
    $('bs-save-notes').addEventListener('click', async () => {
      await api('/admin/api/bookings/' + b.id, { method: 'PATCH', body: JSON.stringify({ notes: $('bs-notes').value }) });
      toast('Notes saved'); closeSheet(); loadDay();
    });
    $('bs-move').addEventListener('click', async () => {
      await api('/admin/api/bookings/' + b.id, { method: 'PATCH', body: JSON.stringify({ date: $('bs-date').value, time: $('bs-time').value }) });
      toast('Booking moved'); closeSheet(); loadDay();
    });
    if ($('bs-client')) $('bs-client').addEventListener('click', () => openClient(b.client.id));
  }

  /* ---------- walk-in ---------- */
  let servicesCache = null;
  $('fab').addEventListener('click', async () => {
    if (!servicesCache) servicesCache = (await api('/admin/api/services')).services;
    let picks = {};
    openSheet(
      '<h3>Add walk-in</h3><p class="sub">Booked and confirmed instantly &mdash; payment is taken at the clinic.</p>' +
      '<label>Treatments</label>' +
      '<div class="pick" id="wi-pick">' +
      servicesCache.map(s =>
        '<div class="pk" data-slug="' + s.slug + '"><span>' + esc(s.name) + '</span><span>' + money(s.price_pence) + '</span></div>'
      ).join('') + '</div>' +
      '<div class="pick" style="grid-template-columns:1fr 1fr">' +
      '<span><label for="wi-date">Date</label><input type="date" id="wi-date" value="' + day + '"></span>' +
      '<span><label for="wi-time">Time</label><input type="time" id="wi-time" value="10:00"></span>' +
      '</div>' +
      '<label for="wi-name">Client name</label><input id="wi-name">' +
      '<label for="wi-email">Email (optional)</label><input id="wi-email" type="email">' +
      '<label for="wi-phone">Phone (optional)</label><input id="wi-phone" type="tel">' +
      '<label for="wi-notes">Notes (optional)</label><input id="wi-notes">' +
      '<div class="btnrow"><button class="b primary" id="wi-save">Add booking</button></div>'
    );
    $('wi-pick').querySelectorAll('.pk').forEach(el => {
      el.addEventListener('click', () => {
        const slug = el.dataset.slug;
        if (picks[slug]) { delete picks[slug]; el.classList.remove('on'); }
        else { picks[slug] = true; el.classList.add('on'); }
      });
    });
    $('wi-save').addEventListener('click', async () => {
      const items = Object.keys(picks);
      if (!items.length) { toast('Pick at least one treatment'); return; }
      if (!$('wi-name').value.trim()) { toast('Client name is required'); return; }
      await api('/admin/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          items,
          date: $('wi-date').value, time: $('wi-time').value,
          client: { name: $('wi-name').value.trim(), email: $('wi-email').value.trim(), phone: $('wi-phone').value.trim() },
          notes: $('wi-notes').value.trim(),
        }),
      });
      toast('Walk-in added'); closeSheet(); day = $('wi-date').value; loadDay();
    });
  });

  /* ---------- clients ---------- */
  let searchTimer;
  $('client-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadClients, 250);
  });

  async function loadClients() {
    const q = $('client-search').value.trim();
    const data = await api('/admin/api/clients?q=' + encodeURIComponent(q));
    const list = $('client-list');
    if (!data.clients.length) { list.innerHTML = '<p class="empty">No clients found</p>'; return; }
    list.innerHTML = data.clients.map(c =>
      '<div class="cl" data-id="' + c.id + '"><div class="n">' + esc(c.name) + '</div>' +
      '<div class="m">' + esc(c.email.indexOf('@clinic.local') === -1 ? c.email : 'walk-in') +
      (c.phone ? ' · ' + esc(c.phone) : '') +
      (c.last_visit ? ' · last visit ' + c.last_visit.slice(0, 10) : '') + '</div></div>'
    ).join('');
    list.querySelectorAll('.cl').forEach(el =>
      el.addEventListener('click', () => openClient(Number(el.dataset.id))));
  }

  function creditHtml(kind, id, name, used, total, extra) {
    const pct = Math.round((used / total) * 100);
    return '<div class="credit" data-kind="' + kind + '" data-id="' + id + '" data-total="' + total + '">' +
      '<div class="t"><span class="name">' + esc(name) + '</span>' +
      '<span class="count"><span class="used">' + used + '</span> / ' + total + '</span></div>' +
      (extra ? '<div class="m" style="font-size:0.78rem;color:var(--soft)">' + esc(extra) + '</div>' : '') +
      '<div class="row">' +
      '<button class="b" data-d="-1">&minus;</button>' +
      '<div class="bar"><span style="width:' + pct + '%"></span></div>' +
      '<button class="b primary" data-d="1">Use session</button>' +
      '</div></div>';
  }

  async function openClient(id) {
    const data = await api('/admin/api/clients/' + id);
    const c = data.client;
    let html = '<h3>' + esc(c.name) + '</h3><p class="sub">' +
      esc(c.email.indexOf('@clinic.local') === -1 ? c.email : 'Walk-in client') +
      (c.phone ? ' · <a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a>' : '') + '</p>';

    if (data.memberships.length || data.packages.length) {
      html += '<label>Session credits</label>';
      data.memberships.forEach(m => {
        html += creditHtml('membership', m.id, m.tier_name + ' membership', m.sessions_used_this_cycle, m.sessions_per_month,
          m.status === 'past_due' ? 'Payment overdue' : 'Renews monthly');
      });
      data.packages.forEach(p => {
        html += creditHtml('package', p.id, p.name, p.sessions_used, p.sessions_total,
          p.expires_at ? 'Valid until ' + p.expires_at.slice(0, 10) : '');
      });
    }

    html += '<label for="cp-notes">Notes</label>' +
      '<textarea id="cp-notes" rows="3">' + esc(c.notes || '') + '</textarea>' +
      '<div class="btnrow"><button class="b primary" id="cp-save">Save notes</button></div>';

    if (data.bookings.length) {
      html += '<label>Recent bookings</label>';
      data.bookings.forEach(b => {
        html += '<div class="kv"><span>' + b.starts_at.slice(0, 10) + '</span>' +
          '<span>' + (STATUS_LABEL[b.status] || b.status) + (b.amount_pence ? ' · ' + money(b.amount_pence) : '') + '</span></div>';
      });
    }
    openSheet(html);

    $('cp-save').addEventListener('click', async () => {
      await api('/admin/api/clients/' + id, { method: 'PATCH', body: JSON.stringify({ notes: $('cp-notes').value }) });
      toast('Notes saved');
    });
    sheet.querySelectorAll('.credit').forEach(el => {
      el.querySelectorAll('[data-d]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const out = await api('/admin/api/redeem', {
            method: 'POST',
            body: JSON.stringify({ kind: el.dataset.kind, id: Number(el.dataset.id), delta: Number(btn.dataset.d) }),
          });
          el.querySelector('.used').textContent = out.used;
          el.querySelector('.bar span').style.width = Math.round((out.used / out.total) * 100) + '%';
          toast(out.used + ' of ' + out.total + ' used');
        });
      });
    });
  }

  /* ---------- sales ---------- */
  async function loadSales() {
    const data = await api('/admin/api/sales?days=30');
    const sum = arr => arr.reduce((a, x) => a + (x.amount_pence || 0), 0);
    $('sales-totals').innerHTML =
      '<div class="tot"><div class="v">' + money(sum(data.bookings)) + '</div><div class="l">Treatments</div></div>' +
      '<div class="tot"><div class="v">' + money(sum(data.packages)) + '</div><div class="l">Programmes</div></div>' +
      '<div class="tot"><div class="v">' + money(sum(data.memberships)) + '</div><div class="l">Memberships /mo</div></div>';
    const rows = [];
    data.bookings.forEach(b => rows.push({ at: b.at, amt: b.amount_pence, who: b.client_name, what: 'Treatments' + (b.source === 'walk_in' ? ' (walk-in)' : '') }));
    data.packages.forEach(p => rows.push({ at: p.at, amt: p.amount_pence, who: p.client_name, what: p.name }));
    data.memberships.forEach(m => rows.push({ at: m.at, amt: m.amount_pence, who: m.client_name, what: m.name + ' membership (monthly)' }));
    rows.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    $('sales-list').innerHTML = rows.length ? rows.map(r =>
      '<div class="sale"><span>' + esc(r.who) + '</span><span class="amt">' + money(r.amt) + '</span>' +
      '<span class="d">' + esc(r.what) + (r.at ? ' · ' + r.at.slice(0, 10) : '') + '</span></div>'
    ).join('') : '<p class="empty">No sales yet</p>';
  }

  /* ---------- settings ---------- */
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  async function loadSettings() {
    const data = await api('/admin/api/settings');
    $('who').textContent = data.username;
    $('acc-username').value = data.username;
    $('set-daily').value = data.settings.daily_cap || '5';
    $('set-capacity').value = data.settings.capacity || '5';
    $('set-lead').value = data.settings.lead_time_minutes || '60';

    const hours = JSON.parse(data.settings.hours || '{}');
    $('hours').innerHTML = DAY_ORDER.map(d => {
      const span = hours[String(d)];
      const [open, close] = span ? span.split('-') : ['10:00', '19:00'];
      return '<div class="hrow" data-day="' + d + '">' +
        '<span>' + DAY_NAMES[d].slice(0, 3) + '</span>' +
        '<input type="time" class="h-open" value="' + open + '" ' + (span ? '' : 'disabled') + '>' +
        '<span>&ndash;</span>' +
        '<span style="display:flex;gap:0.5rem;align-items:center">' +
        '<input type="time" class="h-close" value="' + close + '" ' + (span ? '' : 'disabled') + '>' +
        '<label class="off" style="margin:0;display:flex;gap:0.3rem;align-items:center;font-size:0.6rem">' +
        '<input type="checkbox" class="h-on" style="width:auto" ' + (span ? 'checked' : '') + '>open</label>' +
        '</span></div>';
    }).join('');
    $('hours').querySelectorAll('.h-on').forEach(cb => {
      cb.addEventListener('change', () => {
        const row = cb.closest('.hrow');
        row.querySelector('.h-open').disabled = !cb.checked;
        row.querySelector('.h-close').disabled = !cb.checked;
      });
    });

    $('closed-list').innerHTML = data.closedDates.length
      ? data.closedDates.map(cd =>
        '<div class="cd"><span>' + cd.date + (cd.reason ? ' — ' + esc(cd.reason) : '') + '</span>' +
        '<button class="b bad" data-date="' + cd.date + '">Remove</button></div>').join('')
      : '<p class="muted">No closed dates coming up</p>';
    $('closed-list').querySelectorAll('[data-date]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api('/admin/api/closed-dates/' + btn.dataset.date, { method: 'DELETE' });
        toast('Removed'); loadSettings();
      });
    });
  }

  $('save-hours').addEventListener('click', async () => {
    const hours = {};
    $('hours').querySelectorAll('.hrow').forEach(row => {
      const on = row.querySelector('.h-on').checked;
      hours[row.dataset.day] = on
        ? row.querySelector('.h-open').value + '-' + row.querySelector('.h-close').value
        : null;
    });
    await api('/admin/api/settings', { method: 'PUT', body: JSON.stringify({ hours: JSON.stringify(hours) }) });
    toast('Hours saved');
  });

  $('save-rules').addEventListener('click', async () => {
    await api('/admin/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ daily_cap: $('set-daily').value, capacity: $('set-capacity').value, lead_time_minutes: $('set-lead').value }),
    });
    toast('Rules saved');
  });

  $('save-team').addEventListener('click', async () => {
    if (!$('team-new').value) { toast('Enter a new team password'); return; }
    if (!$('team-current').value) { toast('Enter your own password to confirm'); return; }
    await api('/admin/api/team-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: $('team-current').value, newPassword: $('team-new').value }),
    });
    $('team-new').value = ''; $('team-current').value = '';
    toast('Team password reset — nurses signed out everywhere');
  });

  $('add-closed').addEventListener('click', async () => {
    if (!$('cd-date').value) { toast('Pick a date'); return; }
    await api('/admin/api/closed-dates', {
      method: 'POST',
      body: JSON.stringify({ date: $('cd-date').value, reason: $('cd-reason').value.trim() }),
    });
    $('cd-date').value = ''; $('cd-reason').value = '';
    toast('Closed date added'); loadSettings();
  });

  $('save-account').addEventListener('click', async () => {
    if (!$('acc-current').value) { toast('Enter the current password to confirm'); return; }
    await api('/admin/api/account', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: $('acc-current').value,
        username: $('acc-username').value.trim(),
        newPassword: $('acc-new').value,
      }),
    });
    $('acc-current').value = ''; $('acc-new').value = '';
    toast('Account updated');
    loadSettings();
  });

  $('logout').addEventListener('click', async () => {
    await api('/admin/api/logout', { method: 'POST' });
    location.reload();
  });

  /* ---------- boot ---------- */
  api('/admin/api/me').then(d => {
    myRole = d.role || 'owner';
    $('who').textContent = d.username;
    applyRole();
  });
  loadDay();
})();
