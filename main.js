/* AREUM Wellness London — interactions */
(function () {
  'use strict';

  const docEl = document.documentElement;
  docEl.classList.add('js');

  /* Animations are always on. The OS "reduced motion" flag was freezing the
     whole site for visitors whose Windows has animation effects disabled. */
  const reduced = false;
  const body = document.body;

  /* EDIT: replace with your real clinic email address */
  const CONTACT_EMAIL = 'contact@areumwellness.com';

  /* ---------- Preloader ---------- */
  let readyFired = false;
  function setReady() {
    if (readyFired) return;
    readyFired = true;
    body.classList.add('ready');
    setTimeout(function () {
      const p = document.querySelector('.preloader');
      if (p) p.remove();
    }, 1800);
  }

  if (reduced) {
    setReady();
  } else {
    const hold = 2600; // full letter sequence plays before the curtain lifts
    const start = function () { setTimeout(setReady, hold); };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(start);
      setTimeout(setReady, 4500); // safety net if fonts stall
    } else {
      start();
    }
  }

  /* ---------- Scroll reveals ---------- */
  document.querySelectorAll('[data-stagger]').forEach(function (group) {
    Array.prototype.forEach.call(group.children, function (child, i) {
      child.style.setProperty('--d', i);
    });
  });

  /* Upgrade blur reveals to word-by-word masked rises (visit-address keeps
     its blur — the block-level city line inside doesn't split cleanly) */
  document.querySelectorAll('[data-reveal="blur"]').forEach(function (el) {
    if (el.classList.contains('visit-address')) return;
    el.setAttribute('data-reveal', 'words');
    let wi = 0;
    Array.prototype.slice.call(el.childNodes).forEach(function (node) {
      if (node.nodeType !== 3 || !node.textContent.trim()) return;
      const frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
        const w = document.createElement('span');
        w.className = 'w';
        const inner = document.createElement('span');
        inner.textContent = part;
        inner.style.setProperty('--wi', wi++);
        w.appendChild(inner);
        frag.appendChild(w);
      });
      el.replaceChild(frag, node);
    });
  });

  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        en.target.classList.add('in-view');
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -9% 0px' });

  document.querySelectorAll('[data-reveal], [data-stagger], [data-line]').forEach(function (el) {
    io.observe(el);
  });

  /* ---------- Header ---------- */
  const head = document.getElementById('site-head');
  const toTop = document.getElementById('to-top');
  const progressBar = document.getElementById('progress-bar');
  const heroContent = document.querySelector('.hero-content');
  let docH = document.documentElement.scrollHeight;

  function measureDoc() { docH = document.documentElement.scrollHeight; }
  window.addEventListener('load', measureDoc);
  window.addEventListener('resize', measureDoc);

  function onScroll() {
    const y = window.scrollY;
    head.classList.toggle('solid', y > 30);
    toTop.classList.toggle('show', y > 900);
    if (progressBar) {
      const max = docH - window.innerHeight;
      progressBar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0).toFixed(4) + ')';
    }
    if (!reduced && heroContent) {
      const vh = window.innerHeight;
      if (y <= vh * 1.2) {
        heroContent.style.transform = 'translate3d(0,' + (y * 0.16).toFixed(1) + 'px,0)';
        heroContent.style.opacity = Math.max(0, 1 - y / (vh * 0.85)).toFixed(3);
      }
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Full-screen menu ---------- */
  const burger = document.getElementById('burger');
  const menu = document.getElementById('menu-screen');

  function setMenu(open) {
    body.classList.toggle('menu-open', open);
    body.classList.toggle('locked', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.setAttribute('aria-hidden', String(!open));
  }

  burger.addEventListener('click', function () {
    setMenu(!body.classList.contains('menu-open'));
  });
  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { setMenu(false); });
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && body.classList.contains('menu-open')) setMenu(false);
  });

  /* ---------- Eased anchor scrolling ---------- */
  function smoothTo(targetY) {
    if (reduced) { window.scrollTo(0, targetY); return; }
    const startY = window.scrollY;
    const diff = targetY - startY;
    if (Math.abs(diff) < 2) return;
    const dur = Math.min(1400, Math.max(650, Math.abs(diff) * 0.45));
    const t0 = performance.now();
    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    (function frame(now) {
      const p = Math.min(1, ((now || performance.now()) - t0) / dur);
      window.scrollTo(0, startY + diff * ease(p));
      if (p < 1) requestAnimationFrame(frame);
    })(t0);
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      const id = a.getAttribute('href');
      if (!id || id.charAt(0) !== '#' || id.length < 2) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      const y = id === '#top' ? 0 : el.getBoundingClientRect().top + window.scrollY - 72;
      smoothTo(Math.max(0, y));
      if (a.classList.contains('skip-link')) {
        el.tabIndex = -1;
        el.focus({ preventScroll: true });
      }
      if (history.pushState) history.pushState(null, '', id);
    });
  });

  toTop.addEventListener('click', function () { smoothTo(0); });

  /* ---------- Soft parallax (decorative layers only) ---------- */
  const plxItems = Array.prototype.map.call(document.querySelectorAll('[data-plx]'), function (el) {
    return { el: el, s: parseFloat(el.getAttribute('data-plx')) || 0.1, base: 0 };
  });

  if (!reduced && plxItems.length && window.matchMedia('(min-width: 861px)').matches) {
    let vh = window.innerHeight;
    let cur = window.scrollY;

    function measure() {
      vh = window.innerHeight;
      plxItems.forEach(function (p) {
        p.el.style.transform = '';
        const r = p.el.getBoundingClientRect();
        p.base = r.top + window.scrollY + r.height / 2;
      });
    }

    let lastCur = null;
    function loop() {
      cur += (window.scrollY - cur) * 0.075;
      if (Math.abs(window.scrollY - cur) < 0.1) cur = window.scrollY;
      if (cur !== lastCur) {
        plxItems.forEach(function (p) {
          const off = (cur + vh / 2) - p.base;
          p.el.style.transform = 'translate3d(0,' + (off * p.s).toFixed(2) + 'px,0)';
        });
        lastCur = cur;
      }
      requestAnimationFrame(loop);
    }

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    requestAnimationFrame(loop);
  }

  /* ---------- Magnetic buttons & pointer-reactive hero ---------- */
  const finePointer = window.matchMedia('(pointer: fine)').matches &&
                      window.matchMedia('(min-width: 861px)').matches;

  if (!reduced && finePointer) {
    const clamp8 = function (v) { return Math.max(-8, Math.min(8, v)); };
    const magnets = Array.prototype.filter.call(
      document.querySelectorAll('.btn, .to-top'),
      function (el) { return !el.closest('[data-reveal]'); }
    ).map(function (el) { return { el: el, tx: 0, ty: 0, cx: 0, cy: 0 }; });

    magnets.forEach(function (m) {
      m.el.addEventListener('mousemove', function (e) {
        const r = m.el.getBoundingClientRect();
        m.tx = clamp8((e.clientX - (r.left + r.width / 2)) * 0.15);
        m.ty = clamp8((e.clientY - (r.top + r.height / 2)) * 0.3);
      });
      m.el.addEventListener('mouseleave', function () { m.tx = 0; m.ty = 0; });
    });

    const orbField = document.querySelector('.orb-field');
    const hero = document.querySelector('.hero');
    let otx = 0, oty = 0, ocx = 0, ocy = 0;
    if (hero && orbField) {
      hero.addEventListener('mousemove', function (e) {
        otx = (e.clientX / window.innerWidth - 0.5) * 36;
        oty = (e.clientY / window.innerHeight - 0.5) * 26;
      });
      hero.addEventListener('mouseleave', function () { otx = 0; oty = 0; });
    }

    (function fxLoop() {
      magnets.forEach(function (m) {
        m.cx += (m.tx - m.cx) * 0.12;
        m.cy += (m.ty - m.cy) * 0.12;
        if (Math.abs(m.cx) > 0.05 || Math.abs(m.cy) > 0.05) {
          m.el.style.transform = 'translate3d(' + m.cx.toFixed(2) + 'px,' + m.cy.toFixed(2) + 'px,0)';
        } else if (m.el.style.transform) {
          m.el.style.transform = '';
        }
      });
      if (orbField && (Math.abs(otx - ocx) > 0.03 || Math.abs(oty - ocy) > 0.03)) {
        ocx += (otx - ocx) * 0.045;
        ocy += (oty - ocy) * 0.045;
        orbField.style.transform = 'translate3d(' + ocx.toFixed(2) + 'px,' + ocy.toFixed(2) + 'px,0)';
      }
      requestAnimationFrame(fxLoop);
    })();
  }

  /* ---------- Footer wordmark letter cascade ---------- */
  const footWord = document.querySelector('.foot-word');
  if (footWord) {
    const text = footWord.textContent.trim();
    footWord.setAttribute('aria-label', text);
    footWord.textContent = '';
    Array.prototype.forEach.call(text, function (ch, i) {
      const s = document.createElement('span');
      s.textContent = ch;
      s.style.setProperty('--i', i);
      s.setAttribute('aria-hidden', 'true');
      footWord.appendChild(s);
    });
  }

  /* ---------- Marquee: compositor-driven, constant speed, exact seam ---------- */
  const marqueeTrack = document.querySelector('.marquee-track');
  if (marqueeTrack) {
    const halves = marqueeTrack.querySelectorAll('.marquee-half');
    const MARQUEE_SPEED = 55; // px per second

    function marqueeSetup() {
      const half = halves[0];
      let guard = 0;
      while (half.getBoundingClientRect().width < window.innerWidth * 1.05 && guard < 10) {
        halves.forEach(function (h) {
          h.appendChild(h.firstElementChild.cloneNode(true));
        });
        guard++;
      }
      const w = half.getBoundingClientRect().width;
      if (w > 0) {
        marqueeTrack.style.setProperty('--marq-dur', (w / MARQUEE_SPEED).toFixed(2) + 's');
      }
    }

    marqueeSetup();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(marqueeSetup);
    let marqueeResizeT;
    window.addEventListener('resize', function () {
      clearTimeout(marqueeResizeT);
      marqueeResizeT = setTimeout(marqueeSetup, 200);
    });
  }

  /* ---------- Enquiry form (opens the visitor's email app) ---------- */
  const form = document.getElementById('enquiry-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const name = document.getElementById('f-name').value.trim();
      const email = document.getElementById('f-email').value.trim();
      const interest = document.getElementById('f-interest').value;
      const message = document.getElementById('f-message').value.trim();
      const subject = encodeURIComponent('Website enquiry — ' + interest + (name ? ' — ' + name : ''));
      const bodyText = encodeURIComponent(
        'Name: ' + name + '\nEmail: ' + email + '\nInterested in: ' + interest +
        (message ? '\n\n' + message : '')
      );
      window.location.href = 'mailto:' + CONTACT_EMAIL + '?subject=' + subject + '&body=' + bodyText;
    });
  }

  const API_BASE = '';

  /* ---------- Book Now links ----------
     Everything opens the on-site booking flow (choose time → details → pay). */
  document.querySelectorAll('a.js-book').forEach(function (a) {
    a.href = '#';
    a.addEventListener('click', function (e) { e.preventDefault(); openFlow(); });
  });
  document.querySelectorAll('a.js-membership').forEach(function (a) {
    a.href = '#';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      const holder = a.closest('[data-item]');
      const tier = holder ? holder.getAttribute('data-item').replace('member-', '') : null;
      openPurchaseFlow('membership', tier);
    });
  });
  document.querySelectorAll('a.js-package').forEach(function (a) {
    const holder = a.closest('[data-item]');
    a.href = '#';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      openPurchaseFlow('package', holder ? holder.getAttribute('data-item') : null);
    });
  });

  /* ---------- Coming soon: non-LPG treatments locked until Mon 17 Aug 2026.
     The server (/api/config) decides; this just paints the state. ---------- */
  let comingSoonMode = false;
  function isComingSoonItem(id) {
    return id.indexOf('lpg-') !== 0 && id.indexOf('member-') !== 0;
  }
  fetch(API_BASE + '/api/config').then(function (r) { return r.json(); }).then(function (cfg) {
    if (!cfg.comingSoon) return;
    comingSoonMode = true;
    document.querySelectorAll('[data-item]').forEach(function (el) {
      const id = el.getAttribute('data-item');
      if (!isComingSoonItem(id)) return;
      el.classList.add('coming-soon');
      const pill = document.createElement(el.querySelector('.row-right') ? 'span' : 'p');
      pill.className = 'soon-pill';
      pill.textContent = 'Coming Soon';
      const right = el.querySelector('.row-right');
      if (right) right.insertBefore(pill, right.firstChild);
      else el.insertBefore(pill, el.firstChild);
      el.querySelectorAll('.js-add').forEach(function (b) {
        b.disabled = true;
        const s = b.querySelector('span');
        if (s) s.textContent = 'Coming Soon';
      });
    });
  }).catch(function () { /* fail open — server still blocks early bookings */ });

  /* ---------- Toast ---------- */
  const toastEl = document.getElementById('toast');
  let toastTimer;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* ---------- Expandable treatment rows ---------- */
  document.querySelectorAll('.expandable .row-head').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const li = btn.closest('.expandable');
      const list = li.parentElement;
      const wasOpen = li.classList.contains('open');
      list.querySelectorAll('.expandable.open').forEach(function (o) {
        o.classList.remove('open');
        o.querySelector('.row-head').setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        li.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ---------- Basket ---------- */
  const CATALOG = {};
  document.querySelectorAll('[data-item]').forEach(function (el) {
    CATALOG[el.getAttribute('data-item')] = {
      name: el.getAttribute('data-name'),
      price: parseInt(el.getAttribute('data-price'), 10) || 0
    };
  });

  let basketData = {};
  try {
    basketData = JSON.parse(localStorage.getItem('areum-basket')) || {};
  } catch (e) { basketData = {}; }
  Object.keys(basketData).forEach(function (id) {
    if (!CATALOG[id] || !(basketData[id] > 0)) delete basketData[id];
  });

  const basketEl = document.getElementById('basket');
  const basketScrim = document.getElementById('basket-scrim');
  const basketItemsEl = document.getElementById('basket-items');
  const basketTotalEl = document.getElementById('basket-total');
  const basketCloseBtn = document.getElementById('basket-close');
  const bagBtn = document.getElementById('bag-btn');
  const bagCount = document.getElementById('bag-count');

  function saveBasket() {
    try { localStorage.setItem('areum-basket', JSON.stringify(basketData)); } catch (e) { /* private mode */ }
  }
  function fmt(n) { return '£' + n.toLocaleString('en-GB'); }

  function renderBasket() {
    const ids = Object.keys(basketData);
    let total = 0, count = 0, html = '';
    ids.forEach(function (id, i) {
      const it = CATALOG[id];
      const qty = basketData[id];
      total += it.price * qty;
      count += qty;
      html += '<li class="b-item" data-id="' + id + '" style="--i:' + i + '">' +
        '<p class="b-name">' + it.name + '</p>' +
        '<p class="b-line">' + fmt(it.price * qty) + '</p>' +
        '<span class="b-qty">' +
          '<button class="b-dec" type="button" aria-label="Reduce quantity">&minus;</button>' +
          '<span class="b-n">' + qty + '</span>' +
          '<button class="b-inc" type="button" aria-label="Increase quantity">+</button>' +
        '</span>' +
        '<button class="b-remove" type="button">Remove</button>' +
      '</li>';
    });
    basketItemsEl.innerHTML = html;
    basketTotalEl.textContent = fmt(total);
    basketEl.classList.toggle('is-empty', ids.length === 0);
    if (count > 0) {
      bagCount.hidden = false;
      bagCount.textContent = count;
    } else {
      bagCount.hidden = true;
    }
  }

  function popBadge() {
    bagCount.classList.remove('pop');
    void bagCount.offsetWidth;
    bagCount.classList.add('pop');
  }

  function basketSummary() {
    const lines = ['AREUM Wellness London — booking request', ''];
    let total = 0;
    Object.keys(basketData).forEach(function (id) {
      const it = CATALOG[id];
      const qty = basketData[id];
      total += it.price * qty;
      lines.push(qty + ' × ' + it.name + ' — ' + fmt(it.price * qty));
    });
    lines.push('');
    lines.push('Total — ' + fmt(total));
    return lines.join('\n');
  }

  function openBasket() {
    setMenu(false);
    renderBasket();
    basketItemsEl.classList.add('fresh');
    setTimeout(function () { basketItemsEl.classList.remove('fresh'); }, 900);
    basketEl.classList.add('open');
    basketEl.setAttribute('aria-hidden', 'false');
    basketScrim.classList.add('show');
    body.classList.add('locked');
    basketCloseBtn.focus();
  }
  function closeBasket() {
    if (!basketEl.classList.contains('open')) return;
    basketEl.classList.remove('open');
    basketEl.setAttribute('aria-hidden', 'true');
    basketScrim.classList.remove('show');
    body.classList.remove('locked');
    bagBtn.focus();
  }

  function addToBasket(id) {
    if (!CATALOG[id]) return;
    if (comingSoonMode && isComingSoonItem(id)) {
      showToast('Available to book from Monday 17 August');
      return;
    }
    basketData[id] = (basketData[id] || 0) + 1;
    saveBasket();
    renderBasket();
    popBadge();
    showToast(CATALOG[id].name + ' added to your booking');
  }

  document.addEventListener('click', function (e) {
    const addBtn = e.target.closest('.js-add');
    if (addBtn) {
      const holder = addBtn.closest('[data-item]');
      if (holder) addToBasket(holder.getAttribute('data-item'));
    }
  });

  basketItemsEl.addEventListener('click', function (e) {
    const item = e.target.closest('.b-item');
    if (!item) return;
    const id = item.getAttribute('data-id');
    if (e.target.closest('.b-inc')) basketData[id] += 1;
    else if (e.target.closest('.b-dec')) basketData[id] -= 1;
    else if (e.target.closest('.b-remove')) basketData[id] = 0;
    else return;
    if (basketData[id] <= 0) delete basketData[id];
    saveBasket();
    renderBasket();
  });

  bagBtn.addEventListener('click', function () {
    if (basketEl.classList.contains('open')) closeBasket(); else openBasket();
  });
  basketCloseBtn.addEventListener('click', closeBasket);
  basketScrim.addEventListener('click', closeBasket);
  document.getElementById('basket-explore').addEventListener('click', closeBasket);

  document.getElementById('basket-checkout').addEventListener('click', function () {
    openFlow();
  });

  document.getElementById('basket-email').addEventListener('click', function () {
    if (!Object.keys(basketData).length) { showToast('You haven’t added any treatments yet'); return; }
    const subject = encodeURIComponent('Booking request — AREUM Wellness');
    const bodyText = encodeURIComponent(basketSummary() + '\n\nMy preferred day and time:\n');
    window.location.href = 'mailto:' + CONTACT_EMAIL + '?subject=' + subject + '&body=' + bodyText;
  });

  renderBasket();

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeBasket(); closeFlow(); }
  });

  /* ================================================================
     On-site booking flow: choose a time → your details → pay → done.
     ================================================================ */

  const flowEl = document.getElementById('flow');
  const flowScrim = document.getElementById('flow-scrim');
  const flowBody = document.getElementById('flow-body');
  const flowFoot = document.getElementById('flow-foot');
  const flowTitle = document.getElementById('flow-title');
  const flowStepLabel = document.getElementById('flow-step-label');

  let flowCat = null;          // slug -> { name, price_pence, duration_min }
  let flowTiers = null;        // tier id -> { name, price_pence, sessions_per_month }
  let flowPkgs = null;         // slug -> { name, price_pence, sessions_total, expires_months }
  let flowMode = 'booking';    // booking | membership | package
  let flowProduct = null;      // the tier/package being bought (purchase modes)
  let flowSel = null;          // { items, date, time, client, notes }
  let flowStripe = null, flowElements = null;
  let flowSyncPath = null;     // endpoint that confirms the paid thing server-side
  let flowBusy = false;

  function flowItems() {
    const items = [];
    Object.keys(basketData).forEach(function (id) {
      for (let i = 0; i < basketData[id]; i++) items.push(id);
    });
    return items;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  async function flowCatalogue() {
    if (flowCat) return flowCat;
    const res = await fetch(API_BASE + '/api/catalogue');
    const data = await res.json();
    flowCat = {}; flowTiers = {}; flowPkgs = {};
    data.services.forEach(function (s) { flowCat[s.slug] = s; });
    (data.tiers || []).forEach(function (t) { flowTiers[t.id] = t; });
    (data.packages || []).forEach(function (p) { flowPkgs[p.slug] = p; });
    return flowCat;
  }

  function flowDuration() {
    return flowSel.items.reduce(function (a, slug) { return a + flowCat[slug].duration_min; }, 0);
  }
  function flowTotal() {
    return flowSel.items.reduce(function (a, slug) { return a + flowCat[slug].price_pence; }, 0);
  }

  let stripeJsPromise = null;
  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve();
    if (!stripeJsPromise) {
      stripeJsPromise = new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = 'https://js.stripe.com/v3/';
        s.onload = resolve;
        s.onerror = function () { stripeJsPromise = null; reject(new Error('Could not load payment library')); };
        document.head.appendChild(s);
      });
    }
    return stripeJsPromise;
  }

  function setStep(n, title) {
    const total = flowMode === 'booking' ? 3 : 2;
    flowStepLabel.textContent = n === 0
      ? (flowMode === 'booking' ? 'Booking confirmed' : 'Payment complete')
      : 'Step ' + n + ' of ' + total;
    flowTitle.textContent = title;
  }

  function flowShell() {
    closeBasket();
    flowEl.classList.add('open');
    flowEl.setAttribute('aria-hidden', 'false');
    flowScrim.classList.add('show');
    body.classList.add('locked');
    flowBody.innerHTML = '<p class="flow-empty">One moment&hellip;</p>';
    flowFoot.innerHTML = '';
  }

  async function openFlow() {
    const items = flowItems();
    if (!items.length) { openBasket(); showToast('Add treatments to begin your booking'); return; }
    flowMode = 'booking';
    flowProduct = null;
    flowShell();
    try {
      await flowCatalogue();
    } catch (e) {
      flowBody.innerHTML = '<p class="flow-error">We couldn&rsquo;t reach the booking service. Please try again shortly.</p>';
      return;
    }
    const bookable = items.filter(function (slug) { return flowCat[slug]; });
    if (!bookable.length) { closeFlow(); openBasket(); showToast('Add treatments to begin your booking'); return; }
    flowSel = { items: bookable, date: null, time: null, client: {}, notes: '' };
    flowSyncPath = null;
    stepTime();
  }

  async function openPurchaseFlow(mode, id) {
    if (!id) return;
    flowMode = mode;
    flowShell();
    try {
      await flowCatalogue();
    } catch (e) {
      flowBody.innerHTML = '<p class="flow-error">We couldn&rsquo;t reach the booking service. Please try again shortly.</p>';
      return;
    }
    flowProduct = mode === 'membership' ? flowTiers[id] : flowPkgs[id];
    if (!flowProduct) {
      flowBody.innerHTML = '<p class="flow-error">This item isn&rsquo;t available right now. Please contact the clinic.</p>';
      return;
    }
    flowSel = { items: [], date: null, time: null, client: {}, notes: '' };
    flowSyncPath = null;
    stepDetails();
  }

  function closeFlow() {
    if (!flowEl || !flowEl.classList.contains('open') || flowBusy) return;
    flowEl.classList.remove('open');
    flowEl.setAttribute('aria-hidden', 'true');
    flowScrim.classList.remove('show');
    body.classList.remove('locked');
  }

  /* ---- Step 1: choose a time ---- */
  function stepTime() {
    setStep(1, 'Choose a time');
    const days = [];
    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      days.push(d);
    }
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let html = '<p class="flow-section-label">Day</p><div class="flow-days" id="flow-days">';
    days.forEach(function (d, i) {
      const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      html += '<button type="button" class="flow-day" data-date="' + iso + '" style="--i:' + i + '">' +
        '<small>' + dayNames[d.getDay()] + '</small><strong>' + d.getDate() + '</strong></button>';
    });
    html += '</div><p class="flow-section-label">Time</p><div class="flow-slots" id="flow-slots">' +
      '<p class="flow-empty">Pick a day to see available times</p></div>';
    flowBody.innerHTML = html;
    renderFlowFoot(null);

    flowBody.querySelectorAll('.flow-day').forEach(function (btn) {
      btn.addEventListener('click', function () {
        flowBody.querySelectorAll('.flow-day').forEach(function (b) { b.classList.remove('sel'); });
        btn.classList.add('sel');
        flowSel.date = btn.getAttribute('data-date');
        flowSel.time = null;
        renderFlowFoot(null);
        loadSlots();
      });
    });
    const first = flowBody.querySelector('.flow-day');
    if (first) first.click();
  }

  async function loadSlots() {
    const grid = document.getElementById('flow-slots');
    grid.innerHTML = '<p class="flow-empty">Checking availability&hellip;</p>';
    try {
      const res = await fetch(API_BASE + '/api/availability?date=' + flowSel.date + '&duration=' + flowDuration());
      const data = await res.json();
      if (!data.slots || !data.slots.length) {
        grid.innerHTML = '<p class="flow-empty">No times available this day &mdash; try another day.</p>';
        return;
      }
      grid.innerHTML = data.slots.map(function (t) {
        return '<button type="button" class="flow-slot" data-time="' + t + '">' + t + '</button>';
      }).join('');
      grid.querySelectorAll('.flow-slot').forEach(function (btn) {
        btn.addEventListener('click', function () {
          grid.querySelectorAll('.flow-slot').forEach(function (b) { b.classList.remove('sel'); });
          btn.classList.add('sel');
          flowSel.time = btn.getAttribute('data-time');
          renderFlowFoot(stepDetails, 'Continue');
        });
      });
    } catch (e) {
      grid.innerHTML = '<p class="flow-error">Couldn&rsquo;t load times. Please try again.</p>';
    }
  }

  /* ---- Details step (step 2 for bookings, step 1 for purchases) ---- */
  function stepDetails() {
    setStep(flowMode === 'booking' ? 2 : 1, 'Your details');
    const c = flowSel.client;
    flowBody.innerHTML =
      '<div class="field"><label for="fl-name">Name</label>' +
      '<input id="fl-name" type="text" autocomplete="name" required value="' + esc(c.name || '') + '"></div>' +
      '<div class="field"><label for="fl-email">Email</label>' +
      '<input id="fl-email" type="email" autocomplete="email" required value="' + esc(c.email || '') + '"></div>' +
      '<div class="field"><label for="fl-phone">Phone</label>' +
      '<input id="fl-phone" type="tel" autocomplete="tel" value="' + esc(c.phone || '') + '"></div>' +
      '<div class="field"><label for="fl-notes">Anything we should know? (optional)</label>' +
      '<textarea id="fl-notes" rows="3">' + esc(flowSel.notes || '') + '</textarea></div>' +
      '<p class="flow-fine">We only use your details to manage your appointments and send your confirmations &mdash; nothing else, and never shared.</p>' +
      (flowMode === 'booking' ? '<button type="button" class="flow-back" id="flow-back">&larr; Change time</button>' : '');
    const back = document.getElementById('flow-back');
    if (back) back.addEventListener('click', stepTime);
    renderFlowFoot(async function () {
      const name = document.getElementById('fl-name').value.trim();
      const email = document.getElementById('fl-email').value.trim();
      const phone = document.getElementById('fl-phone').value.trim();
      flowSel.notes = document.getElementById('fl-notes').value.trim();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        showToast('Please add your name and a valid email'); return;
      }
      flowSel.client = { name: name, email: email, phone: phone };
      await stepPay();
    }, 'Continue to payment');
  }

  /* ---- Payment step (step 3 for bookings, step 2 for purchases) ---- */
  function paySummaryHtml() {
    if (flowMode === 'booking') {
      const names = {};
      flowSel.items.forEach(function (slug) { names[slug] = (names[slug] || 0) + 1; });
      let html = '<div class="flow-summary">';
      Object.keys(names).forEach(function (slug) {
        const s = flowCat[slug];
        html += '<p><span>' + (names[slug] > 1 ? names[slug] + ' &times; ' : '') + esc(s.name) + '</span>' +
          '<span>' + fmt((s.price_pence * names[slug]) / 100) + '</span></p>';
      });
      html += '<p class="flow-when"><span>' + flowSel.date + ' at ' + flowSel.time + '</span>' +
        '<span>' + flowDuration() + ' mins</span></p></div>';
      return html;
    }
    if (flowMode === 'membership') {
      return '<div class="flow-summary">' +
        '<p><span>' + esc(flowProduct.name) + ' Membership</span><span>' + fmt(flowProduct.price_pence / 100) + ' / month</span></p>' +
        '<p class="flow-when"><span>' + tierIncludes(flowProduct) + '</span>' +
        '<span>Renews monthly</span></p></div>';
    }
    return '<div class="flow-summary">' +
      '<p><span>' + esc(flowProduct.name) + '</span><span>' + fmt(flowProduct.price_pence / 100) + '</span></p>' +
      '<p class="flow-when"><span>' + flowProduct.sessions_total + ' sessions</span>' +
      '<span>Valid ' + flowProduct.expires_months + ' months</span></p></div>';
  }

  async function stepPay() {
    setStep(flowMode === 'booking' ? 3 : 2, 'Secure payment');
    flowBody.innerHTML = '<p class="flow-empty">Preparing secure payment&hellip;</p>';
    flowFoot.innerHTML = '';
    flowBusy = true;
    try {
      let res;
      if (flowMode === 'booking') {
        res = await fetch(API_BASE + '/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: flowSel.items, date: flowSel.date, time: flowSel.time,
            client: flowSel.client, notes: flowSel.notes,
          }),
        });
      } else if (flowMode === 'membership') {
        res = await fetch(API_BASE + '/api/memberships/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier: flowProduct.id, client: flowSel.client }),
        });
      } else {
        res = await fetch(API_BASE + '/api/packages/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ package: flowProduct.slug, client: flowSel.client }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        flowBusy = false;
        if (flowMode === 'booking' && res.status === 409) {
          showToast(data.error || 'That time was just taken'); stepTime(); return;
        }
        flowBody.innerHTML = '<p class="flow-error">' + esc(data.error || 'Something went wrong. Please try again.') + '</p>';
        return;
      }
      flowSyncPath = flowMode === 'booking' ? '/api/bookings/' + data.bookingId + '/sync'
        : flowMode === 'membership' ? '/api/memberships/' + data.membershipId + '/sync'
        : '/api/purchases/' + data.purchaseId + '/sync';

      await loadStripeJs();
      if (!flowStripe) {
        const cfg = await (await fetch(API_BASE + '/api/config')).json();
        flowStripe = Stripe(cfg.publishableKey);
      }

      const fine = flowMode === 'booking'
        ? 'Free cancellation up to 24 hours before your visit &mdash; reply to your confirmation email or call the clinic to rearrange.'
        : flowMode === 'membership'
          ? 'Renews monthly and can be cancelled or paused before your next billing date &mdash; just contact the clinic.'
          : 'Sessions are valid from today &mdash; book each visit whenever suits you.';
      flowBody.innerHTML = paySummaryHtml() + '<div id="flow-payment-element"></div>' +
        '<p class="flow-error" id="flow-pay-error" hidden></p>' +
        '<p class="flow-fine">' + fine + '</p>' +
        '<button type="button" class="flow-back" id="flow-back2">&larr; Back</button>';
      document.getElementById('flow-back2').addEventListener('click', function () { flowBusy = false; stepDetails(); });

      flowElements = flowStripe.elements({
        clientSecret: data.clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#B3935F',
            colorText: '#1E1B16',
            fontFamily: 'Jost, sans-serif',
            borderRadius: '8px',
          },
        },
      });
      flowElements.create('payment', { layout: 'tabs' }).mount('#flow-payment-element');
      flowBusy = false;
      const payLabel = 'Pay ' + fmt(data.amountPence / 100) + (flowMode === 'membership' ? ' / month' : '');
      renderFlowFoot(submitPayment, payLabel);
    } catch (e) {
      flowBusy = false;
      flowBody.innerHTML = '<p class="flow-error">We couldn&rsquo;t start the payment. Please try again.</p>';
    }
  }

  async function submitPayment() {
    if (flowBusy) return;
    flowBusy = true;
    const errEl = document.getElementById('flow-pay-error');
    const btn = flowFoot.querySelector('button.btn');
    if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Processing…'; }
    try {
      const result = await flowStripe.confirmPayment({
        elements: flowElements,
        confirmParams: { return_url: window.location.href.split('#')[0] },
        redirect: 'if_required',
      });
      if (result.error) {
        flowBusy = false;
        if (errEl) { errEl.hidden = false; errEl.textContent = result.error.message; }
        if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Try again'; }
        return;
      }
      if (flowSyncPath) await fetch(API_BASE + flowSyncPath, { method: 'POST' });
      flowBusy = false;
      stepDone();
    } catch (e) {
      flowBusy = false;
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Payment could not be completed. Please try again.'; }
      if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Try again'; }
    }
  }

  function tierIncludes(tier) {
    const n = tier.sessions_per_month;
    const s = n > 1 ? 's' : '';
    return n + ' Essential IV' + s + ' + ' + n + ' injection' + s + ' every month';
  }

  /* ---- Done ---- */
  function receiptRow(label, value) {
    return '<div class="flow-receipt-row"><span>' + label + '</span><span>' + value + '</span></div>';
  }

  function stepDone() {
    let heading, sub, receipt, detail;
    const email = esc(flowSel.client.email);
    if (flowMode === 'booking') {
      setStep(0, 'See you soon');
      heading = 'Your booking is confirmed';
      sub = 'Payment received &mdash; your appointment is secured. There is nothing else you need to do.';
      const niceDate = new Date(flowSel.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      receipt =
        receiptRow('When', esc(niceDate) + ', ' + esc(flowSel.time)) +
        receiptRow('Treatments', esc(flowSel.items.map(function (slug) { return flowCat[slug].name; }).join(', '))) +
        receiptRow('Paid', fmt(flowTotal() / 100)) +
        receiptRow('Where', '69 Kensington Church Street,<br>London W8 4BG');
      detail = 'A confirmation email is on its way to <strong>' + email + '</strong> &mdash; ' +
        'if it hasn&rsquo;t arrived in a few minutes, check your junk folder. ' +
        'We&rsquo;ll also send a reminder the day before your visit.<br>' +
        'Need to change anything? Just reply to the email or call the clinic.';
    } else if (flowMode === 'membership') {
      setStep(0, 'Welcome to AREUM');
      heading = 'Your membership is active';
      sub = 'Payment received &mdash; your membership starts today.';
      receipt =
        receiptRow('Plan', esc(flowProduct.name)) +
        receiptRow('Includes', tierIncludes(flowProduct)) +
        receiptRow('Price', fmt(flowProduct.price_pence / 100) + ' / month');
      detail = 'Your sessions are ready to use &mdash; book each visit online or with the clinic, ' +
        'and we&rsquo;ll take care of the rest.<br>' +
        'A receipt is on its way to <strong>' + email + '</strong> ' +
        '(check your junk folder if it doesn&rsquo;t appear in a few minutes).';
    } else {
      setStep(0, 'All yours');
      heading = 'Your programme is confirmed';
      sub = 'Payment received &mdash; your sessions are now on your account.';
      receipt =
        receiptRow('Programme', esc(flowProduct.name)) +
        receiptRow('Sessions', String(flowProduct.sessions_total)) +
        receiptRow('Paid', fmt(flowProduct.price_pence / 100)) +
        (flowProduct.expires_months ? receiptRow('Valid for', flowProduct.expires_months + ' months') : '');
      detail = 'Book each visit whenever suits you &mdash; online or with the clinic &mdash; ' +
        'and your sessions are simply ticked off as you go.<br>' +
        'A receipt is on its way to <strong>' + email + '</strong> ' +
        '(check your junk folder if it doesn&rsquo;t appear in a few minutes).';
    }
    flowBody.innerHTML =
      '<div class="flow-success"><div class="tick">&#10003;</div>' +
      '<h3>' + heading + '</h3>' +
      '<p class="flow-success-sub">' + sub + '</p>' +
      '<div class="flow-receipt">' + receipt + '</div>' +
      '<p>' + detail + '</p></div>';
    flowFoot.innerHTML = '';
    const done = document.createElement('button');
    done.className = 'btn btn--fill basket-btn';
    done.type = 'button';
    done.innerHTML = '<span>Done</span>';
    done.addEventListener('click', closeFlow);
    flowFoot.appendChild(done);
    if (flowMode === 'booking') {
      basketData = {};
      saveBasket();
      renderBasket();
    }
  }

  function footTotalPence() {
    if (flowMode === 'booking') return flowCat && flowSel ? flowTotal() : null;
    return flowProduct ? flowProduct.price_pence : null;
  }

  function renderFlowFoot(onContinue, label) {
    flowFoot.innerHTML = '';
    const totalRow = document.createElement('div');
    totalRow.className = 'flow-total-row';
    const pence = footTotalPence();
    totalRow.innerHTML = '<span>Total</span><span class="flow-total">' +
      (pence != null ? fmt(pence / 100) + (flowMode === 'membership' ? ' <small>/ month</small>' : '') : '') + '</span>';
    flowFoot.appendChild(totalRow);
    if (onContinue) {
      const btn = document.createElement('button');
      btn.className = 'btn btn--fill basket-btn';
      btn.type = 'button';
      btn.innerHTML = '<span>' + label + '</span>';
      btn.addEventListener('click', onContinue);
      flowFoot.appendChild(btn);
    }
  }

  document.getElementById('flow-close').addEventListener('click', closeFlow);
  flowScrim.addEventListener('click', closeFlow);

  /* ---------- Footer year ---------- */
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
