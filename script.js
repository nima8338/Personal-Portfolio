/* Nima Aref · portfolio interactions
   Theme · reveal · scroll spy · clock · copy · status board (spring dots) · toolbox (rigid bodies) */

(() => {
  'use strict';

  const $ = (sel, scope = document) => scope.querySelector(sel);
  const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /* ── Analytics: the actions that matter, sent to Google Analytics as events ── */

  const track = (name, params = {}) => {
    if (typeof window.gtag === 'function') window.gtag('event', name, params);
  };

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    const where = link.closest('aside') ? 'sidebar' : (link.closest('section[id]')?.id || 'page');
    if (link.classList.contains('btn-primary') && href === '#email') track('cta_start_project');
    else if (href.startsWith('mailto:')) track('email_click', { location: where });
    else if (href.endsWith('.pdf')) track('resume_open', { location: where });
    else if (link.target === '_blank') track('outbound_click', { url: link.href, label: link.textContent.trim().slice(0, 80) });
  });

  // Which sections people actually reach (once per visit each)
  const seenSections = new Set();
  const sectionIO = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || seenSections.has(entry.target.id)) return;
      seenSections.add(entry.target.id);
      track('section_view', { section: entry.target.id });
    });
  }, { threshold: 0.35 });
  $$('main section[id]').forEach((el) => sectionIO.observe(el));

  /* ── Small details ─────────────────────────── */

  $('.year').textContent = new Date().getFullYear();

  const copyBtn = $('.copy');
  const copyStatus = $('.copy-status');
  let copyTimer;
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(copyBtn.dataset.copy);
      copyBtn.textContent = 'Copied';
      copyBtn.classList.add('is-done');
      copyStatus.textContent = 'Email address copied to clipboard';
      track('email_copy');
    } catch (e) {
      copyStatus.textContent = 'Copy failed. The address is nima83.nt@gmail.com';
    }
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copyBtn.textContent = 'Copy';
      copyBtn.classList.remove('is-done');
    }, 1800);
  });

  /* ── Inquiry form ──────────────────────────
     With FORM_ENDPOINT set (the Cloudflare Worker in worker/contact), inquiries are
     emailed to me directly. Until then, the form opens a pre-filled email instead. */

  const FORM_ENDPOINT = ''; // e.g. 'https://contact.aref.dev'
  const CONTACT_EMAIL = 'nima83.nt@gmail.com';
  const form = $('#inquiry');
  const formStatus = $('.form-status', form);
  const formStarted = Date.now();

  function setStatus(text, kind) {
    formStatus.textContent = text;
    formStatus.className = `form-status${kind ? ` is-${kind}` : ''}`;
  }

  // One rule per field, so a field can be rechecked on its own while someone types
  const RULES = [
    { el: () => form.elements.name, ok: (el) => el.value.trim().length > 0, message: 'Add your name.' },
    { el: () => form.elements.email, ok: (el) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()), message: 'Add an email I can reply to.' },
    { el: () => $('fieldset', form), ok: () => !!form.elements.type.value, message: "Pick what you're building." },
    { el: () => form.elements.message, ok: (el) => el.value.trim().length >= 10, message: 'Tell me a little about the project.' },
  ];

  function validate() {
    const problems = [];
    RULES.forEach((rule) => {
      const el = rule.el();
      const ok = rule.ok(el);
      el.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if (!ok) problems.push({ el, message: rule.message });
    });
    return problems;
  }

  // Clear a field's error as soon as it's fixed, without flagging fields not touched yet
  form.addEventListener('input', (e) => {
    const target = e.target.type === 'radio' ? $('fieldset', form) : e.target;
    if (target.getAttribute('aria-invalid') !== 'true') return;
    const rule = RULES.find((r) => r.el() === target);
    if (rule && rule.ok(target)) {
      target.setAttribute('aria-invalid', 'false');
      if (!form.querySelector('[aria-invalid="true"]')) setStatus('');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const problems = validate();
    if (problems.length) {
      setStatus(problems[0].message, 'error');
      const first = problems[0].el;
      (first.tagName === 'FIELDSET' ? $('input', first) : first).focus();
      return;
    }

    const data = Object.fromEntries(new FormData(form));
    if (data.company) return; // filled the spam trap: quietly do nothing

    if (!FORM_ENDPOINT) {
      const lines = [
        `Name: ${data.name}`,
        `Email: ${data.email}`,
        `Building: ${data.type}`,
        '',
        data.message,
      ];
      const subject = `Project inquiry: ${data.type}`;
      window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
      setStatus('Opening your email app with everything filled in.', 'ok');
      track('inquiry_submit', { type: data.type, method: 'mailto' });
      return;
    }

    form.classList.add('is-sending');
    setStatus('Sending…');
    try {
      const res = await fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, elapsed: Date.now() - formStarted, page: location.href }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      form.reset();
      setStatus('Thanks, it\'s in my inbox. I\'ll be in touch.', 'ok');
      track('inquiry_submit', { type: data.type, method: 'form' });
    } catch (err) {
      setStatus(`That didn't send. Email me at ${CONTACT_EMAIL} instead.`, 'error');
      track('inquiry_error');
    } finally {
      form.classList.remove('is-sending');
    }
  });

  /* ── Film posters: tilt toward the pointer on a spring ── */

  function springTilt(el) {
    const STIFFNESS = 0.12;
    const DAMPING = 0.5; // ≈0.7 damping ratio: settles quickly with a hint of give
    const state = { rx: 0, ry: 0, lift: 0, vrx: 0, vry: 0, vlift: 0 };
    const target = { rx: 0, ry: 0, lift: 0 };
    let raf = 0;

    function frame() {
      raf = 0;
      let moving = false;
      for (const k of ['rx', 'ry', 'lift']) {
        const v = `v${k}`;
        state[v] += (target[k] - state[k]) * STIFFNESS - state[v] * DAMPING;
        state[k] += state[v];
        if (Math.abs(state[v]) > 0.001 || Math.abs(target[k] - state[k]) > 0.001) moving = true;
        else { state[k] = target[k]; state[v] = 0; }
      }
      el.style.setProperty('--rx', `${state.rx}deg`);
      el.style.setProperty('--ry', `${state.ry}deg`);
      el.style.setProperty('--lift', `${state.lift}px`);
      el.style.setProperty('--lift-abs', `${Math.abs(state.lift)}px`);
      if (moving) raf = requestAnimationFrame(frame);
    }
    const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };

    el.addEventListener('pointermove', (e) => {
      if (reducedMotion.matches || e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      target.ry = px * 14;
      target.rx = -py * 14;
      target.lift = -6;
      wake();
    });
    el.addEventListener('pointerleave', () => {
      target.rx = 0; target.ry = 0; target.lift = 0;
      wake();
    });
  }
  $$('.poster').forEach(springTilt);

  /* ── Reveal on scroll ──────────────────────── */

  const revealIO = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((entry, i) => {
      entry.target.style.transitionDelay = `${Math.min(i, 5) * 60}ms`;
      entry.target.classList.add('is-in');
      revealIO.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  $$('.reveal, .garden').forEach((el) => revealIO.observe(el));

  /* ── Scroll spy with a sliding marker ──────── */

  const navList = $('.nav ul');
  const navLinks = $$('.nav a');
  const marker = document.createElement('span');
  marker.className = 'nav-marker';
  marker.setAttribute('aria-hidden', 'true');
  navList.appendChild(marker);

  let onSectionChange = () => {};

  function setActive(id) {
    onSectionChange(id || 'top');
    if (id === 'travel') id = 'favorites';
    let activeLink = null;
    navLinks.forEach((link) => {
      const on = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('is-active', on);
      if (on) { link.setAttribute('aria-current', 'true'); activeLink = link; }
      else link.removeAttribute('aria-current');
    });
    if (activeLink) {
      marker.style.height = `${activeLink.offsetHeight - 12}px`;
      marker.style.transform = `translateY(${activeLink.offsetTop + 6}px)`;
      marker.style.opacity = '1';
      // Keep the active tab visible in the horizontal mobile nav
      const nav = navList.parentElement;
      if (nav.scrollWidth > nav.clientWidth) {
        nav.scrollTo({ left: activeLink.offsetLeft - 16, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      }
    } else {
      marker.style.opacity = '0';
    }
  }

  const spyIO = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) setActive(entry.target.id === 'top' ? null : entry.target.id);
    });
  }, { rootMargin: '-35% 0px -60% 0px' });
  ['top', 'experience', 'work', 'services', 'toolbox', 'favorites', 'travel', 'contact'].forEach((id) => spyIO.observe(document.getElementById(id)));

  /* ── Dot-matrix board ───────────────────────
     A fixed grid of dim dots, plus a pool of lit "particles".
     Each section has a scene (a pictogram and a title); when the
     section changes, the particles fly to the new scene's dots on
     damped springs, sweeping left to right. The pointer pushes
     them away, a tap sends a shockwave, and the loop sleeps once
     everything settles. */

  const GLYPHS = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  };

  const ICONS = {
    smile: [
      '001111100',
      '010000010',
      '100000001',
      '101000101',
      '100000001',
      '101000101',
      '100111001',
      '010000010',
      '001111100',
    ],
    browser: [
      '1111111111111',
      '1010100000001',
      '1111111111111',
      '1000000000001',
      '1011110111101',
      '1000000000001',
      '1011111111101',
      '1000000000001',
      '1111111111111',
    ],
    bulb: [
      '001111100',
      '010000010',
      '100010001',
      '100101001',
      '100010001',
      '010010010',
      '001010100',
      '001111100',
      '001111100',
      '000111000',
    ],
    briefcase: [
      '0000111110000',
      '0001000001000',
      '1111111111111',
      '1000000000001',
      '1000000000001',
      '1111110111111',
      '1000000000001',
      '1000000000001',
      '1111111111111',
    ],
    code: [
      '0001000010001000',
      '0010000010000100',
      '0100000100000010',
      '1000000100000001',
      '0100000100000010',
      '0010001000000100',
      '0001001000001000',
    ],
    clock: [
      '001111100',
      '010010010',
      '100010001',
      '100010001',
      '100011101',
      '100000001',
      '100000001',
      '010000010',
      '001111100',
    ],
    film: [
      '1111111111111',
      '1010101010101',
      '1111111111111',
      '1000000000001',
      '1000000000001',
      '1000000000001',
      '1111111111111',
      '1010101010101',
      '1111111111111',
    ],
    globe: [
      '001111100',
      '010010010',
      '111111111',
      '100010001',
      '111111111',
      '100010001',
      '111111111',
      '010010010',
      '001111100',
    ],
    envelope: [
      '1111111111111',
      '1100000000011',
      '1010000000101',
      '1001000001001',
      '1000100010001',
      '1000011100001',
      '1000000000001',
      '1000000000001',
      '1111111111111',
    ],
  };

  const SCENES = {
    top:        { n: 1, icon: 'smile',     text: 'HELLO',         label: 'Hello. Push the dots around.' },
    work:       { n: 3, icon: 'browser',   text: 'WORK',          label: 'Selected work' },
    experience: { n: 2, icon: 'briefcase', text: 'CV',            label: 'Experience' },
    services:   { n: 4, icon: 'bulb',      text: 'HIRE ME',       label: 'Services' },
    toolbox:    { n: 5, icon: 'code',      text: 'TOOLS',         label: 'Toolbox' },
    favorites:  { n: 6, icon: 'film',      text: 'FILMS',         label: 'Top five films' },
    travel:     { n: 7, icon: 'globe',     text: 'TRIPS',         label: 'Traveling' },
    contact:    { n: 8, icon: 'envelope',  text: 'SAY HI',        label: 'Contact' },
  };

  const textWidth = (s) => s.length * 6 - 1;

  // Wrap words into lines no wider than maxCols
  function wrap(text, maxCols) {
    const lines = [];
    let line = '';
    text.split(' ').forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next) > maxCols) { lines.push(line); line = word; }
      else line = next;
    });
    lines.push(line);
    return lines;
  }

  // Lay a scene out on a cols × rows grid; returns lit cells as [col, row]
  function composeScene(scene, cols, rows) {
    const icon = ICONS[scene.icon];
    const iw = icon[0].length;
    const ih = icon.length;
    const room = { w: cols - 6, h: rows - 6 };
    const lines = wrap(scene.text, room.w);
    const tw = Math.max(...lines.map(textWidth));
    const th = lines.length * 8 - 1;
    const cells = [];

    const stamp = (bitmap, x0, y0) => bitmap.forEach((bits, y) => {
      [...bits].forEach((bit, x) => { if (bit === '1') cells.push([x0 + x, y0 + y]); });
    });
    const stampText = (x0, y0, width) => lines.forEach((line, li) => {
      const lx = x0 + Math.floor((width - textWidth(line)) / 2);
      [...line].forEach((ch, ci) => { if (GLYPHS[ch]) stamp(GLYPHS[ch], lx + ci * 6, y0 + li * 8); });
    });

    const stackH = ih + 3 + th;
    const sideW = iw + 4 + tw;
    if (stackH <= room.h && Math.max(iw, tw) <= room.w) {
      // Icon above the title
      const top = Math.floor((rows - stackH) / 2);
      stamp(icon, Math.floor((cols - iw) / 2), top);
      stampText(Math.floor((cols - tw) / 2), top + ih + 3, tw);
    } else if (sideW <= room.w && Math.max(ih, th) <= room.h) {
      // Icon beside the title
      const left = Math.floor((cols - sideW) / 2);
      stamp(icon, left, Math.floor((rows - ih) / 2));
      stampText(left + iw + 4, Math.floor((rows - th) / 2), tw);
    } else {
      // Not enough room: title only
      stampText(Math.floor((cols - tw) / 2), Math.floor((rows - th) / 2), tw);
    }
    return cells;
  }

  function dotBoard(canvas, label) {
    const ctx = canvas.getContext('2d');
    const STIFFNESS = 0.055; // spring pull per frame²; ~0.45s to arrive
    const DAMPING = 0.3;     // ≈0.65 damping ratio: a little overshoot, like something thrown
    const SWEEP = 320;       // ms for the morph to sweep across the board

    let width = 0;
    let height = 0;
    let spacing = 8;
    let cols = 0;
    let rows = 0;
    let ox = 0;
    let oy = 0;
    let particles = [];
    let sceneId = 'top';
    let colors = {};
    let raf = 0;
    let seen = false;
    const pointer = { x: 0, y: 0, active: false };

    const cellToPoint = ([c, r]) => ({ x: ox + c * spacing, y: oy + r * spacing });

    function targetsFor(id) {
      return composeScene(SCENES[id], cols, rows)
        .map(cellToPoint)
        .sort((a, b) => a.x - b.x || a.y - b.y);
    }

    function layout() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      readColors();
      const backdrop = getComputedStyle(canvas.closest('.board')).position === 'fixed';
      spacing = backdrop
        ? Math.min(14, Math.max(8, width / 36))
        : Math.min(10, Math.max(6, width / 80));
      cols = Math.floor(width / spacing);
      rows = Math.floor(height / spacing);
      ox = (width - (cols - 1) * spacing) / 2;
      oy = (height - (rows - 1) * spacing) / 2;

      // Snap straight to the current scene; resizing shouldn't animate
      const now = performance.now();
      particles = targetsFor(sceneId).map((t, i) => ({
        x: t.x, y: t.y, vx: 0, vy: 0, tx: t.x, ty: t.y,
        next: null, dying: false,
        // First appearance: light up column by column, like a sign powering on
        showAt: seen ? now : Infinity,
        bootIndex: t.x,
      }));
      wake();
    }

    function powerOn() {
      seen = true;
      const now = performance.now();
      particles.forEach((p) => { p.showAt = reducedMotion.matches ? now : now + (p.bootIndex / width) * 500; });
      wake();
    }

    function show(id) {
      if (!SCENES[id] || id === sceneId) return;
      sceneId = id;
      const scene = SCENES[id];
      if (label) label.textContent = `Fig. 0${scene.n}: ${scene.label}`;
      if (!cols) return;

      const targets = targetsFor(id);
      const now = performance.now();
      const live = particles.filter((p) => !p.dying).sort((a, b) => a.x - b.x || a.y - b.y);

      if (reducedMotion.matches || !seen) {
        particles = targets.map((t) => ({ x: t.x, y: t.y, vx: 0, vy: 0, tx: t.x, ty: t.y, next: null, dying: false, showAt: seen ? now : Infinity, bootIndex: t.x }));
        wake();
        return;
      }

      // Grow the pool by splitting existing particles, so new dots come from somewhere
      while (live.length < targets.length) {
        const source = live[Math.floor(Math.random() * live.length)] || { x: width / 2, y: height / 2 };
        live.push({ x: source.x, y: source.y, vx: 0, vy: 0, tx: source.x, ty: source.y, next: null, dying: false, showAt: now, bootIndex: 0 });
      }
      live.sort((a, b) => a.x - b.x || a.y - b.y);

      // Map sorted particles onto sorted targets; leftovers power down into the grid
      const spare = live.length - targets.length;
      const stride = live.length / targets.length;
      const assigned = new Set();
      targets.forEach((t, i) => {
        const p = live[Math.floor(i * stride)];
        assigned.add(p);
        p.next = { x: t.x, y: t.y, at: now + (t.x / width) * SWEEP + Math.random() * 60 };
      });
      if (spare > 0) {
        live.forEach((p) => {
          if (assigned.has(p)) return;
          const c = Math.floor(Math.random() * cols);
          const r = Math.floor(Math.random() * rows);
          const home = cellToPoint([c, r]);
          p.dying = true;
          p.next = { x: home.x, y: home.y, at: now + (p.x / width) * SWEEP };
        });
      }
      particles = live;
      wake();
    }

    function readColors() {
      const style = getComputedStyle(canvas);
      colors = { on: style.getPropertyValue('--board-on').trim(), off: style.getPropertyValue('--board-off').trim() };
    }

    function step(now) {
      const reach = spacing * 7;
      let moving = false;
      particles = particles.filter((p) => {
        if (p.next && now >= p.next.at) {
          p.tx = p.next.x;
          p.ty = p.next.y;
          p.next = null;
          // A small upward kick on departure, so the morph reads as a jump, not a slide
          p.vy -= spacing * 0.25;
        }
        let ax = (p.tx - p.x) * STIFFNESS - p.vx * DAMPING;
        let ay = (p.ty - p.y) * STIFFNESS - p.vy * DAMPING;
        if (pointer.active) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < reach && dist > 0.01) {
            const force = (1 - dist / reach) ** 2 * 2.2;
            ax += (dx / dist) * force;
            ay += (dy / dist) * force;
          }
        }
        p.vx += ax;
        p.vy += ay;
        p.x += p.vx;
        p.y += p.vy;
        const settled = !p.next && Math.abs(p.vx) + Math.abs(p.vy) < 0.02 && Math.abs(p.x - p.tx) + Math.abs(p.y - p.ty) < 0.05;
        if (settled) {
          p.x = p.tx; p.y = p.ty; p.vx = 0; p.vy = 0;
          if (p.dying) return false; // landed on the grid: it's just a dim dot now
        } else {
          moving = true;
        }
        return true;
      });
      return moving;
    }

    function draw(now) {
      ctx.clearRect(0, 0, width, height);
      const rOn = spacing * 0.34;
      const rOff = spacing * 0.2;

      const showGrid = colors.off && colors.off !== 'transparent' && colors.off !== 'rgba(0, 0, 0, 0)';
      ctx.fillStyle = colors.off;
      ctx.beginPath();
      for (let c = 0; showGrid && c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const x = ox + c * spacing;
          const y = oy + r * spacing;
          ctx.moveTo(x + rOff, y);
          ctx.arc(x, y, rOff, 0, Math.PI * 2);
        }
      }
      ctx.fill();

      ctx.fillStyle = colors.on;
      ctx.beginPath();
      for (const p of particles) {
        if (now < p.showAt) continue;
        // Dying particles shrink as they travel home, so they fade into the grid
        let radius = rOn;
        if (p.dying && !p.next) {
          const left = Math.hypot(p.tx - p.x, p.ty - p.y);
          radius = rOff + (rOn - rOff) * Math.min(1, left / (spacing * 4));
          if (left < spacing * 0.5) continue;
        }
        ctx.moveTo(p.x + radius, p.y);
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    function frame(now) {
      raf = 0;
      const moving = step(now);
      const booting = particles.some((p) => p.showAt > now && p.showAt !== Infinity);
      draw(now);
      if (moving || pointer.active || booting) raf = requestAnimationFrame(frame);
    }

    function wake() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function localPoint(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    canvas.addEventListener('pointermove', (e) => {
      if (reducedMotion.matches) return;
      Object.assign(pointer, localPoint(e), { active: true });
      wake();
    });
    const leave = () => { pointer.active = false; wake(); };
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointercancel', leave);
    canvas.addEventListener('pointerdown', (e) => {
      if (reducedMotion.matches) return;
      const at = localPoint(e);
      const radius = spacing * 22;
      for (const p of particles) {
        const dx = p.x - at.x;
        const dy = p.y - at.y;
        const dist = Math.hypot(dx, dy);
        if (dist < radius && dist > 0.01) {
          const kick = (1 - dist / radius) * spacing * 1.1;
          p.vx += (dx / dist) * kick;
          p.vy += (dy / dist) * kick;
        }
      }
      wake();
    });

    readColors();

    const seenIO = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      seenIO.disconnect();
      powerOn();
    }, { threshold: 0.3 });
    seenIO.observe(canvas);

    let resizeRaf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(layout);
    }).observe(canvas);

    return { show };
  }

  // In the sidebar on desktop, a full-screen backdrop on smaller screens: either way it follows the scroll
  const boardEl = $('.board');
  const boardHome = document.createComment('board');
  boardEl.before(boardHome);
  const wide = matchMedia('(min-width: 960px)');
  const placeBoard = () => {
    if (wide.matches) $('.sidebar-foot').before(boardEl);
    else boardHome.after(boardEl);
  };
  placeBoard();
  wide.addEventListener('change', placeBoard);
  const board = dotBoard($('.board-canvas'));
  onSectionChange = (id) => board.show(id);

  /* ── Snake: an easter egg on the dot board ──
     Type "snake" or the Konami code (or tap the logo five times on a phone).
     On wide screens it takes over the sticky board; elsewhere it opens as a sheet.
     When the snake crashes, its dots burst apart on the same springy physics. */

  function snakeGame() {
    const screen = $('.board-screen');
    // "sticky" = the board is on screen in the sidebar and big enough to play on
    const sticky = { get matches() { return wide.matches && screen.offsetParent !== null && screen.clientHeight > 160; } };
    const BEST_KEY = 'snake-best';

    const root = document.createElement('div');
    root.className = 'snake';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Snake');
    root.tabIndex = -1;
    root.innerHTML = `
      <div class="snake-panel">
        <div class="snake-head">
          <span class="snake-title">SNAKE</span>
          <span class="snake-score" aria-live="polite"></span>
          <button class="snake-btn snake-size" type="button" aria-label="Make Snake bigger" title="Bigger (F)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path class="icon-grow" d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/><path class="icon-shrink" d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/></svg>
          </button>
          <button class="snake-btn snake-close" type="button" aria-label="Close Snake">×</button>
        </div>
        <div class="snake-stage">
          <canvas class="snake-canvas"></canvas>
          <p class="snake-msg"></p>
        </div>
      </div>`;
    const canvas = $('.snake-canvas', root);
    const stage = $('.snake-stage', root);
    const msg = $('.snake-msg', root);
    const scoreEl = $('.snake-score', root);
    const ctx = canvas.getContext('2d');

    let open = false;
    let state = 'ready';     // ready → playing → over
    let cols = 20;
    let rows = 20;
    let cell = 12;
    let ox = 0;
    let oy = 0;
    let width = 0;
    let height = 0;
    let snake = [];
    let dir = { x: 1, y: 0 };
    let queue = [];
    let food = null;
    let score = 0;
    let best = 0;
    let tickMs = 120;
    let acc = 0;
    let last = 0;
    let raf = 0;
    let burst = [];
    let flash = null;
    let returnFocus = null;
    let popped = false; // desktop only: game lifted off the board into a big window
    const sizeBtn = $('.snake-size', root);

    try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { /* storage blocked */ }

    const colors = () => {
      const style = getComputedStyle(document.documentElement);
      return {
        off: style.getPropertyValue('--dot-off').trim(),
        snake: style.getPropertyValue('--accent').trim(),
        food: style.getPropertyValue('--infra').trim(),
      };
    };
    let palette = colors();

    const isTouch = () => matchMedia('(pointer: coarse)').matches;
    const startHint = () => (isTouch() ? 'Swipe to start' : 'Arrow keys to start · Esc to quit');

    function updateScore() {
      scoreEl.textContent = `Score ${String(score).padStart(2, '0')} · Best ${String(best).padStart(2, '0')}`;
    }

    function layout() {
      // Layout size, not getBoundingClientRect: the pop-out animation scales the panel,
      // and measuring mid-animation would draw a small bitmap that gets stretched (blurry)
      if (!stage.clientWidth || !stage.clientHeight) return;
      width = stage.clientWidth;
      height = stage.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = Math.max(10, Math.min(18, width / 22));
      cols = Math.floor(width / cell);
      rows = Math.floor(height / cell);
      ox = (width - cols * cell) / 2 + cell / 2;
      oy = (height - rows * cell) / 2 + cell / 2;
      // A smaller grid can strand the snake or food outside it: start fresh if so
      const outside = (p) => p.x >= cols || p.y >= rows;
      if (snake.length && (state === 'ready' || snake.some(outside))) reset();
      else if (food && outside(food)) placeFood();
    }

    function placeFood() {
      const taken = new Set(snake.map((p) => `${p.x},${p.y}`));
      const free = [];
      for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) if (!taken.has(`${x},${y}`)) free.push({ x, y });
      food = free[Math.floor(Math.random() * free.length)];
    }

    function reset() {
      const cx = Math.floor(cols / 2);
      const cy = Math.floor(rows / 2);
      snake = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
      dir = { x: 1, y: 0 };
      queue = [];
      score = 0;
      tickMs = 120;
      burst = [];
      placeFood();
      state = 'ready';
      msg.textContent = startHint();
      updateScore();
    }

    function turn(x, y) {
      // Ignore reversals; queue up to two turns so quick double-taps both land
      const prev = queue.length ? queue[queue.length - 1] : dir;
      if ((x === -prev.x && y === -prev.y) || (x === prev.x && y === prev.y)) return;
      if (queue.length < 2) queue.push({ x, y });
      if (state === 'ready') { state = 'playing'; msg.textContent = ''; }
      if (state === 'over') restart();
    }

    function restart() {
      reset();
      state = 'playing';
      msg.textContent = '';
    }

    function crash() {
      state = 'over';
      // Every segment flies outward from the head, then gravity pulls it down
      const head = snake[0];
      burst = snake.map((p, i) => {
        const dx = p.x - head.x + (Math.random() - 0.5);
        const dy = p.y - head.y + (Math.random() - 0.5);
        const len = Math.hypot(dx, dy) || 1;
        const speed = 2 + Math.random() * 3;
        return { x: ox + p.x * cell, y: oy + p.y * cell, vx: (dx / len) * speed, vy: (dy / len) * speed - 3, life: 1, delay: i * 12 };
      });
      if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* storage blocked */ }
      }
      updateScore();
      track('snake_game_over', { score });
      msg.textContent = `Game over · ${score} ${score === 1 ? 'point' : 'points'} · ${isTouch() ? 'Swipe' : 'Space'} to retry`;
    }

    function tick() {
      if (queue.length) dir = queue.shift();
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      const hitWall = head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows;
      const hitSelf = snake.some((p, i) => i < snake.length - 1 && p.x === head.x && p.y === head.y);
      if (hitWall || hitSelf) { crash(); return; }
      snake.unshift(head);
      if (food && head.x === food.x && head.y === food.y) {
        score++;
        tickMs = Math.max(60, tickMs - 3);
        flash = { x: ox + food.x * cell, y: oy + food.y * cell, t: performance.now() };
        placeFood();
        updateScore();
      } else {
        snake.pop();
      }
    }

    function draw(now) {
      ctx.clearRect(0, 0, width, height);
      const rOff = cell * 0.16;
      const rOn = cell * 0.36;

      ctx.fillStyle = palette.off;
      ctx.beginPath();
      for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
          const px = ox + x * cell;
          const py = oy + y * cell;
          ctx.moveTo(px + rOff, py);
          ctx.arc(px, py, rOff, 0, Math.PI * 2);
        }
      }
      ctx.fill();

      // Food blinks gently, like a cursor
      if (food && state !== 'over') {
        const pulse = 0.75 + 0.25 * Math.sin(now / 160);
        ctx.fillStyle = palette.food;
        ctx.beginPath();
        ctx.arc(ox + food.x * cell, oy + food.y * cell, rOn * pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      if (flash) {
        const t = (now - flash.t) / 360;
        if (t >= 1) flash = null;
        else {
          ctx.strokeStyle = palette.snake;
          ctx.globalAlpha = 1 - t;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(flash.x, flash.y, cell * (0.6 + t * 1.6), 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      ctx.fillStyle = palette.snake;
      if (state === 'over' && !reducedMotion.matches) {
        for (const b of burst) {
          if (b.delay > 0) { b.delay -= 16; continue; }
          b.vy += 0.35;
          b.vx *= 0.98;
          b.x += b.vx;
          b.y += b.vy;
          b.life = Math.max(0, b.life - 0.015);
          ctx.globalAlpha = b.life;
          ctx.beginPath();
          ctx.arc(b.x, b.y, rOn, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (state !== 'over') {
        ctx.beginPath();
        snake.forEach((p, i) => {
          const r = i === 0 ? rOn * 1.15 : rOn;
          const px = ox + p.x * cell;
          const py = oy + p.y * cell;
          ctx.moveTo(px + r, py);
          ctx.arc(px, py, r, 0, Math.PI * 2);
        });
        ctx.fill();
      }
    }

    function frame(now) {
      raf = 0;
      if (!open) return;
      if (state === 'playing') {
        acc += Math.min(now - last, 250);
        while (acc >= tickMs && state === 'playing') { tick(); acc -= tickMs; }
      }
      last = now;
      draw(now);
      raf = requestAnimationFrame(frame);
    }

    function openGame() {
      if (open) return;
      open = true;
      returnFocus = document.activeElement;
      palette = colors();
      popped = false;
      if (sticky.matches) {
        screen.appendChild(root);
      } else {
        document.body.appendChild(root);
      }
      root.classList.add('is-open');
      syncSizeButton();
      snake = [];
      layout();
      reset();
      last = performance.now();
      acc = 0;
      root.focus({ preventScroll: true });
      raf = requestAnimationFrame(frame);
    }

    function closeGame() {
      if (!open) return;
      open = false;
      cancelAnimationFrame(raf);
      raf = 0;
      root.classList.remove('is-open');
      root.remove();
      if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
    }

    function syncSizeButton() {
      sizeBtn.hidden = !sticky.matches;
      root.classList.toggle('is-popped', popped);
      sizeBtn.setAttribute('aria-label', popped ? 'Put Snake back on the board' : 'Make Snake bigger');
      sizeBtn.title = popped ? 'Smaller (F)' : 'Bigger (F)';
    }

    // Lift the game off the board into a big window (or put it back).
    // The panel animates from where it was to where it lands, so it reads as one object moving.
    function toggleSize() {
      if (!open || !sticky.matches) return;
      const panel = $('.snake-panel', root);
      const first = panel.getBoundingClientRect();
      popped = !popped;
      (popped ? document.body : screen).appendChild(root);
      root.classList.add('is-moving');
      syncSizeButton();
      layout();
      const lastRect = panel.getBoundingClientRect();
      root.focus({ preventScroll: true });
      if (reducedMotion.matches) { root.classList.remove('is-moving'); return; }
      const dx = first.left - lastRect.left;
      const dy = first.top - lastRect.top;
      const sx = first.width / lastRect.width;
      const sy = first.height / lastRect.height;
      panel.animate(
        [
          { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transformOrigin: 'top left', transform: 'none' },
        ],
        { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      ).finished.finally(() => root.classList.remove('is-moving'));
      if (popped) root.animate([{ backgroundColor: 'rgba(20, 20, 20, 0)' }, {}], { duration: 300, easing: 'ease-out' });
    }

    sizeBtn.addEventListener('click', toggleSize);
    $('.snake-close', root).addEventListener('click', closeGame);
    root.addEventListener('click', (e) => { if (e.target === root) closeGame(); }); // tap the dimmed page to leave

    // Keyboard: steer while open, listen for the secret words while closed
    const KEYS = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    };
    const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let history = [];

    document.addEventListener('keydown', (e) => {
      if (open) {
        if (e.key === 'Escape') { e.preventDefault(); closeGame(); return; }
        if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleSize(); return; }
        const k = KEYS[e.key] || KEYS[e.key.toLowerCase()];
        if (k) { e.preventDefault(); turn(k[0], k[1]); return; }
        if ((e.key === ' ' || e.key === 'Enter') && state === 'over') { e.preventDefault(); restart(); }
        return;
      }
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      history.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      history = history.slice(-10);
      const typed = history.filter((k) => k.length === 1).join('');
      const konami = history.length === 10 && history.every((k, i) => k === KONAMI[i]);
      if (typed.endsWith('snake') || konami) { history = []; openGame(); track('snake_open', { via: konami ? 'konami' : 'typed' }); }
    });

    // Swipes on phones and trackpads
    let start = null;
    stage.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) {
        if (state === 'over') restart();
        return;
      }
      if (Math.abs(dx) > Math.abs(dy)) turn(Math.sign(dx), 0);
      else turn(0, Math.sign(dy));
    });

    // Five quick taps on the logo also opens it (no keyboard needed)
    let taps = [];
    $('.brand').addEventListener('click', (e) => {
      const now = performance.now();
      taps = taps.filter((t) => now - t < 2000).concat(now);
      if (taps.length >= 5) {
        e.preventDefault();
        taps = [];
        openGame();
        track('snake_open', { via: 'logo_taps' });
      }
    });

    new ResizeObserver(() => { if (open) layout(); }).observe(stage);

    // A note for anyone who opens the console
    console.log(
      '%c● NIMA AREF%c\nYou opened the console, so you\'re my kind of person.\nTry typing "snake" on the page. Or say hi: nima83.nt@gmail.com',
      'color:#d9411c;font:900 14px monospace;letter-spacing:2px',
      'color:inherit;font:12px/1.6 monospace'
    );
  }

  snakeGame();

  /* ── Garden: the cypress sways on a spring when the cursor brushes it,
     and a few leaves drift down to the ground ── */

  function swayingTree() {
    const tree = $('.figure-sarv');
    const garden = $('.garden');
    if (!tree || !garden) return;
    const LEAF_COLORS = ['#2f5a34', '#3d6b3a', '#c9a54a', '#24452a'];
    const STIFFNESS = 0.035;
    const DAMPING = 0.06; // light damping: a slow, swaying settle
    let angle = 0;
    let velocity = 0;
    let raf = 0;
    let lastX = null;
    let lastLeaf = 0;
    let leaves = 0;

    function frame() {
      raf = 0;
      velocity += -angle * STIFFNESS - velocity * DAMPING;
      angle += velocity;
      angle = Math.max(-5, Math.min(5, angle));
      tree.style.rotate = `${angle.toFixed(3)}deg`;
      if (Math.abs(angle) > 0.01 || Math.abs(velocity) > 0.005) raf = requestAnimationFrame(frame);
      else tree.style.rotate = '';
    }
    const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };

    function dropLeaf() {
      if (leaves >= 10) return;
      const t = tree.getBoundingClientRect();
      const g = garden.getBoundingClientRect();
      const along = 0.15 + Math.random() * 0.55; // how far down the canopy
      const spread = (t.width * 0.4) * along;
      const x = t.left + t.width / 2 + (Math.random() * 2 - 1) * spread - g.left;
      const y = t.top + t.height * along - g.top;
      const leaf = document.createElement('span');
      leaf.className = 'leaf';
      leaf.style.left = `${x}px`;
      leaf.style.top = `${y}px`;
      leaf.style.background = LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)];
      garden.appendChild(leaf);
      leaves++;
      const fall = g.height - y - 3; // land on the ground line
      const drift = (Math.random() * 2 - 1) * 50;
      const spin = (Math.random() * 2 - 1) * 540;
      const duration = 2400 + Math.random() * 1400;
      leaf.animate([
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${drift * 0.6}px, ${fall * 0.45}px) rotate(${spin * 0.4}deg)`, offset: 0.4 },
        { transform: `translate(${drift * -0.2}px, ${fall * 0.8}px) rotate(${spin * 0.8}deg)`, offset: 0.75 },
        { transform: `translate(${drift}px, ${fall}px) rotate(${spin}deg)`, opacity: 1, offset: 0.92 },
        { transform: `translate(${drift}px, ${fall}px) rotate(${spin}deg)`, opacity: 0 },
      ], { duration, easing: 'cubic-bezier(0.3, 0.1, 0.6, 1)' }).finished.finally(() => { leaf.remove(); leaves--; });
    }

    function nudge(push) {
      if (reducedMotion.matches) return;
      velocity += push;
      wake();
      const now = performance.now();
      if (Math.abs(push) > 0.08 && now - lastLeaf > 280) {
        lastLeaf = now;
        const count = Math.random() < 0.4 ? 2 : 1;
        for (let i = 0; i < count; i++) setTimeout(dropLeaf, i * 120);
      }
    }

    tree.addEventListener('pointerenter', (e) => { lastX = e.clientX; });
    tree.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (lastX !== null) nudge(Math.max(-0.45, Math.min(0.45, (e.clientX - lastX) * 0.035)));
      lastX = e.clientX;
    });
    tree.addEventListener('pointerleave', () => { lastX = null; });
    // A tap on touch screens gives it a little shake
    tree.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      nudge(Math.random() < 0.5 ? 0.35 : -0.35);
    });
  }

  swayingTree();

  /* ── Travel map ─────────────────────────────
     Natural Earth land in the Natural Earth projection, 200 dots across: 0 ocean, 1 land, 2 visited (Japan),
     a–d planned for 2027 (England, Switzerland, Italy, Czechia), h home (United States),
     r roots (Iran).
     Dots spring away from the pointer like the board. */

  const TRAVEL_MAP = [
    '00000000000000000000000000000000000000000000000000000000000000000000000101101000000011111111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000001110011111011111111111111111110000000000000110000000000001000000000000110000000000000000000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000001000011111011111111111111111111000000000000001010000000000000000000000000000011000000000000000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000011000101000000000001001111111111111111000000000000000000000000000000001100000000000001111110000000001000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000111000000000100000000000000111111111111111000000000000000000000000000000110000000000011111111100000000001010000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000001101111100101011111100000000111111111111100000000000000000000000000000001100000110010111111111111111111000001111000000000000000000000000000000000000000',
    '0000000000000000000000000000000hhhhhhhhhh000000000000111100011011111111000000011111111111000000000000000000000011000000000001000110111111111111111111111111111111111111000000000000000000000000000000000',
    '00000000000000000000000000000hhhhhhhhhhhh111111111111011000011101000011000000111111111110000000000000000001111111111001000111111111011111111111111111111111111111111111111111111000000000000000000000000',
    '0000000000000000000000111100hhhhhhhhhhhh1111111111111111111111111000011111000111111110000000000000000000001111111101110111111111111111111111111111111111111111111111111111111111110000000000000000000000',
    '000000000000000000000001100hhhhhhhhhhhh11111111111111111111111110011111000000111110000000011110000000000011110011110101111111111111111111111111111111111111111111111111111111111101000000000000000000000',
    '00000000000000000000000000hhhhhhhhhhhh111111111111111111111100000100111000000111110000000000000000000000111100111111111111111111111111111111111111111111111111111111111111111111111100000000000000000000',
    '0000000000000000000000000hhhhhhhhhhhh1111111111111111111110000000111000000000011100000000000000000000011111100111111111111111111111111111111111111111111111111111111111111001011110000000000000000000000',
    '0000000000000000000000000hhhhhhhhhhhhhh11111111111111111100000000111001000000000000000000000000000a00001111110000111111111111111111111111111111111111111111111111111111111000100000000000000000000000000',
    '00000000000000000000000000hhhh000000hhh1111111111111111110000000111111100000000000000000000000000aa00001011100011111111111111111111111111111111111111111111111111111100000000110000000000000000000000000',
    '000000000000000000000000hhh0000000000hh1111111111111111111100000111111100000000000000000000000000aa00000101100111111111111111111111111111111111111111111111111111111000000000111000000000000000000000000',
    '0000000000000000000000h00000000000000h1111111111111111111111101111111111100000000000000000000000aaaa0000110011111111111111111111111111111111111111111111111111111111000000000011100000000000000000000000',
    '000000000000000000hh000000000000000000111111111111111111111110111111111110000000000000000000000010aaa001111111111111111111111111111111111111111111111111111111111111111000000001000000000000000000000000',
    '0000000000000000000000000000000000000011111111111111111111111011111111110000000000000000000000000aaaa011111111111111111111111111111111111111111111111111111111111111111100000000000000000000000000000000',
    '00000000000000000000000000000000000000111111111111111111111111111110000010000000000000000000000000a0111111ddd1111111111111111111111111111111111111111111111111111111111101000000000000000000000000000000',
    '00000000000000000000000000000000000000hhhhhhhhhhhhhhhhhhh11111111111000111000000000000000000000000111111b11d11111111111111111111111111111111111111111111111111111111111110000000000000000000000000000000',
    '00000000000000000000000000000000000000hhhhhhhhhhhhhhhhhhhh1111111hh100000000000000000000000000000001111bbcc111111111110111111011111111111111111111111111111111111111111110100000000000000000000000000000',
    '0000000000000000000000000000000000000hhhhhhhhhhhhhhhhhhhhhh111hhhhh110000000000000000000000000000001111cccc111111110011111110011111111111111111111111111111111111111111100020000000000000000000000000000',
    '0000000000000000000000000000000000000hhhhhhhhhhhhhhhhhhhhhh1hhhhh0000000000000000000000000000000100111110cc011111100000011110011111111111111111111111111111111111111111100022200000000000000000000000000',
    '0000000000000000000000000000000000000hhhhhhhhhhhhhhhhhhhhhhhhhhh00000000000000000000000000000000111111001ccc00111100010001111001111111111111111111111111111111111111110000022000000000000000000000000000',
    '000000000000000000000000000000000000hhhhhhhhhhhhhhhhhhhhhhhhhhh00000000000000000000000000000000111110000c00cc0110111111111111101111111111111111111111111111111111101110000022000000000000000000000000000',
    '000000000000000000000000000000000000hhhhhhhhhhhhhhhhhhhhhhhhhh000000000000000000000000000000000111110000c000c0010011111111rrrr00111111111111111111111111111111111000110000002000000000000000000000000000',
    '000000000000000000000000000000000000hhhhhhhhhhhhhhhhhhhhhhhhh000000000000000000000000000000000011110000000cc000100111111111rrrrrrrrr11111111111111111111111111111111001000022000000000000000000000000000',
    '000000000000000000000000000000000000hhhhhhhhhhhhhhhhhhhhhhhhh00000000000000000000000000000000000000011111100000000000001111rrrrrrrrr11111111111111111111111111111110001102222200000000000000000000000000',
    '0000000000000000000000000000000000000hhhhhhhhhhhhhhhhhhhhhhh0000000000000000000000000000000000001111111110000000000000011111rrrrrrrr11111111111111111111111111111110000022220000000000000000000000000000',
    '00000000000000000000000000000000000000hhhhhhhhhhhhhhhhhhhhh00000000000000000000000000000000000011111111111110001000000111111rrrrrrrr11111111111111111111111111111111000022000000000000000000000000000000',
    '00000000000000000000000000000000000000101hhhhhhhhhhhhhhhh00000000000000000000000000000000000000111111111111110011110111111111rrrrrrrr1111111111111111111111111111111100002000000000000000000000000000000',
    '00000000000000000000000000000000000000001111hhhhhhhhh0hhh00000000000000000000000000000000000000111111111111111111111111111111rrrrrrrr1111111111111111111111111111111100000000000000000000000000000000000',
    '0000000000000000000000000000000000000001011111hhh000000hh0000000000000000000000000000000000001111111111111111111111111011111110rrrrrrr111111111111111111111111111111100000000000000000000000000000000000',
    '0000000000000000000000000000000000000001011111hh00000000h00000000000000000000000000000000000111111111111111111111111110011111110rrrrrr111111111111111111111111111111000000000000000000000000000000000000',
    '000000000000000000000000000000000000000000111110000000000000000000000000000000000000000000001111111111111111111111111110111111110000r0001111111111111111111111111111010000000000000000000000000000000000',
    '00000000000000000000000000000000000000001011111000000000000000000000000000000000000000000001111111111111111111111111111001111111111100000111111111111111111111111110010000000000000000000000000000000000',
    '00000000000000h00000000000000000000000000001111000000000010000000000000000000000000000000001111111111111111111111111111101111111111100000011111111111011111111111000000000000000000000000000000000000000',
    '000000000000000h0000000000000000000000000011111000010000001100000000000000000000000000000001111111111111111111111111111100111111111100000000111111100001111111000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000001111100110000000011100000000000000000000000000001111111111111111111111111111110011111111000000000111111000001111111010000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000011111110000000000000000000000000000000000000001111111111111111111111111111110011111110000000000111110000000111111100000001000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000001111100000000000000000000000000000000000001111111111111111111111111111111011111100000000000011100000000001111110000001000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000111100000000000000000000000000000000000001111111111111111111111111111111101110000000000000011100000000001111110000001100000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000001100000000000000000000000000000000000001111111111111111111111111111111110000010000000000011100000000001011110000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000100000101000000000000000000000000000000111111111111111111111111111111110011000000000000001100000000000001110000000110000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000100101101111100000000000000000000000000011111111111111111111111111111111111000000000000001110000000001000100000010001000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000001011111111110000000000000000000000000011111111111111111111111111111111111000000000000000010000000001100000000000011000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000011111111111000000000000000000000000001111111001111111111111111111111110000000000000000010000000000010000000100001000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000011111111111111000000000000000000000000100000001111111111111111111111110000000000000000000000000010010000000110000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000011111111111111100000000000000000000000000000000001111111111111111111100000000000000000000000000001010000001100000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000111111111111111100000000000000000000000000000000011111111111111111111000000000000000000000000000000111000011110001000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000001111111111111111110000000000000000000000000000000011111111111111111110000000000000000000000000000000111000111100000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000001111111111111111111100000000000000000000000000000011111111111111111100000000000000000000000000000000011000111101100000110000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000111111111111111111111100000000000000000000000000001111111111111111000000000000000000000000000000000011100011101100010011111000000000000000000000',
    '00000000000000000000000000000000000000000000000000000001111111111111111111111110000000000000000000000000000111111111111111000000000000000000000000000000000001100000001100000000111110001000000000000000',
    '00000000000000000000000000000000000000000000000000000001111111111111111111111111100000000000000000000000000111111111111111000000000000000000000000000000000000010000000000000010011111010000000000000000',
    '00000000000000000000000000000000000000000000000000000000111111111111111111111111100000000000000000000000000111111111111111000000000000000000000000000000000000000110000000000000111111000000000000000000',
    '00000000000000000000000000000000000000000000000000000000011111111111111111111111000000000000000000000000000111111111111111000000000000000000000000000000000000000000000000000000000001100000000000000000',
    '00000000000000000000000000000000000000000000000000000000011111111111111111111111000000000000000000000000000011111111111111000000000000000000000000000000000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000001111111111111111111110000000000000000000000000000111111111111111000000000000000000000000000000000000000000000000001111001000000000000000000000',
    '00000100000000000000000000000000000000000000000000000000001111111111111111111110000000000000000000000000000111111111111111000011000000000000000000000000000000000000000000011110001000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000111111111111111111110000000000000000000000000000111111111111111000011000000000000000000000000000000000000000011111110001100000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000001111111111111111110000000000000000000000000001111111111111110001110000000000000000000000000000000000000000111111111011100000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111111111100000000000000000000000000000111111111111100001110000000000000000000000000000000000000000111111111111100000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111111111100000000000000000000000000000111111111111000001110000000000000000000000000000000000000011111111111111110000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111111111100000000000000000000000000000011111111111000001100000000000000000000000000000000000011111111111111111110000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111111110000000000000000000000000000000011111111111000001100000000000000000000000000000000000011111111111111111111000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111111000000000000000000000000000000000011111111111000001000000000000000000000000000000000000111111111111111111111000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111111000000000000000000000000000000000011111111110000000000000000000000000000000000000000000111111111111111111111000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111111000000000000000000000000000000000011111111100000000000000000000000000000000000000000000111111111111111111111000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111110000000000000000000000000000000000001111111100000000000000000000000000000000000000000000111111111111111111111000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111110000000000000000000000000000000000001111111000000000000000000000000000000000000000000000111111111111111111110000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111100000000000000000000000000000000000000111110000000000000000000000000000000000000000000000111110000011111111100000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111100000000000000000000000000000000000000110000000000000000000000000000000000000000000000001110000000011111111000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000111110000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001111110000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000111111110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000001100000000',
    '00000000000000000000000000000000000000000000000000000000000000111111000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000011110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000001100000000000',
    '00000000000000000000000000000000000000000000000000000000000000011110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000',
    '00000000000000000000000000000000000000000000000000000000000000011110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001100000000000000',
    '00000000000000000000000000000000000000000000000000000000000000011110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000011110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000011110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000001110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000001110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    '00000000000000000000000000000000000000000000000000000000000000000011100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  ];

  function travelMap(canvas) {
    const ctx = canvas.getContext('2d');
    const pins = $$('.travel-pin', canvas.parentElement);
    const STIFFNESS = 0.08;
    const DAMPING = 0.35;
    const rows = TRAVEL_MAP.length;
    const cols = TRAVEL_MAP[0].length;
    let width = 0;
    let height = 0;
    let spacing = 0;
    let dots = [];
    let raf = 0;
    let pulseStart = 0;
    const pointer = { x: 0, y: 0, active: false };
    const style = getComputedStyle(document.documentElement);
    const colors = {
      land: 'rgba(20, 20, 20, 0.2)',
      visited: style.getPropertyValue('--accent').trim(),
      home: '#141414',
      roots: '#1e8c93', // Persian turquoise
    };
    const PLANNED = new Set(['a', 'b', 'c', 'd']);

    canvas.style.aspectRatio = `${cols} / ${rows}`;

    function layout() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      spacing = width / cols;
      dots = [];
      const visited = {};
      TRAVEL_MAP.forEach((line, r) => {
        [...line].forEach((cell, c) => {
          if (cell === '0') return;
          const hx = (c + 0.5) * spacing;
          const hy = (r + 0.5) * spacing;
          dots.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0, kind: cell });
          if (cell !== '1') (visited[cell] = visited[cell] || []).push([hx, hy]);
        });
      });
      // Pin each label just right of its country's dots
      pins.forEach((pin) => {
        const pts = visited[pin.dataset.country];
        if (!pts) return;
        const right = Math.max(...pts.map((p) => p[0]));
        const left = Math.min(...pts.map((p) => p[0]));
        const mid = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
        // Flip to the left side when the label would run off the map
        const flip = right + spacing * 3 + pin.offsetWidth > width;
        pin.classList.toggle('is-flipped', flip);
        pin.style.left = `${flip ? left : right}px`;
        pin.style.top = `${mid}px`;
      });
      wake();
    }

    function step() {
      const reach = spacing * 6;
      let moving = false;
      for (const d of dots) {
        let ax = (d.hx - d.x) * STIFFNESS - d.vx * DAMPING;
        let ay = (d.hy - d.y) * STIFFNESS - d.vy * DAMPING;
        if (pointer.active) {
          const dx = d.x - pointer.x;
          const dy = d.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < reach && dist > 0.01) {
            const force = (1 - dist / reach) ** 2 * 1.6;
            ax += (dx / dist) * force;
            ay += (dy / dist) * force;
          }
        }
        d.vx += ax; d.vy += ay; d.x += d.vx; d.y += d.vy;
        if (Math.abs(d.vx) + Math.abs(d.vy) > 0.02 || Math.abs(d.x - d.hx) + Math.abs(d.y - d.hy) > 0.05) moving = true;
        else { d.x = d.hx; d.y = d.hy; d.vx = 0; d.vy = 0; }
      }
      return moving;
    }

    function draw(now) {
      ctx.clearRect(0, 0, width, height);
      const r = Math.max(1, spacing * 0.3);
      ctx.fillStyle = colors.land;
      ctx.beginPath();
      for (const d of dots) {
        if (d.kind !== '1') continue;
        ctx.moveTo(d.x + r, d.y);
        ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
      }
      ctx.fill();

      // Visited dots, with three soft rings when the map first comes into view
      const visited = dots.filter((d) => d.kind === '2');
      const t = (now - pulseStart) / 1000;
      if (pulseStart && t < 3.6 && !reducedMotion.matches && visited.length) {
        const phase = (t % 1.2) / 1.2;
        ctx.strokeStyle = colors.visited;
        ctx.globalAlpha = (1 - phase) * 0.5;
        ctx.lineWidth = 1;
        const cx = visited.reduce((sum, d) => sum + d.hx, 0) / visited.length;
        const cy = visited.reduce((sum, d) => sum + d.hy, 0) / visited.length;
        ctx.beginPath();
        ctx.arc(cx, cy, spacing * (2 + phase * 6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const rv = Math.max(1.4, spacing * 0.42);
      ctx.fillStyle = colors.visited;
      ctx.beginPath();
      for (const d of visited) {
        ctx.moveTo(d.x + rv, d.y);
        ctx.arc(d.x, d.y, rv, 0, Math.PI * 2);
      }
      ctx.fill();

      // Home and roots: solid, each in its own color
      for (const [kind, color] of [['h', colors.home], ['r', colors.roots]]) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (const d of dots) {
          if (d.kind !== kind) continue;
          ctx.moveTo(d.x + rv, d.y);
          ctx.arc(d.x, d.y, rv, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      // Planned countries: hollow rings the same size as the other marked dots
      ctx.strokeStyle = colors.visited;
      ctx.lineWidth = Math.max(1, spacing * 0.12);
      const rp = rv - ctx.lineWidth / 2;
      ctx.beginPath();
      for (const d of dots) {
        if (!PLANNED.has(d.kind)) continue;
        ctx.moveTo(d.x + rp, d.y);
        ctx.arc(d.x, d.y, rp, 0, Math.PI * 2);
      }
      ctx.stroke();
      return pulseStart && t < 3.6;
    }

    function frame(now) {
      raf = 0;
      const moving = reducedMotion.matches ? false : step();
      const pulsing = draw(now);
      if (moving || pointer.active || pulsing) raf = requestAnimationFrame(frame);
    }
    function wake() { if (!raf) raf = requestAnimationFrame(frame); }

    // A country's label only appears while the pointer is over it (or after a tap on touch screens)
    function countryAt(x, y) {
      // Nearest marked dot wins, so neighbors like Switzerland and Italy stay distinct
      let hit = null;
      let best = spacing * 2;
      for (const d of dots) {
        if (d.kind === '1') continue;
        const dist = Math.hypot(d.hx - x, d.hy - y);
        if (dist < best) { best = dist; hit = d.kind; }
      }
      return hit;
    }
    function showPin(kind) {
      pins.forEach((pin) => pin.classList.toggle('is-placed', pin.dataset.country === kind));
      canvas.style.cursor = kind ? 'pointer' : '';
    }

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      showPin(countryAt(x, y));
      if (reducedMotion.matches) return;
      Object.assign(pointer, { x, y, active: true });
      wake();
    });
    canvas.addEventListener('pointerleave', () => { pointer.active = false; showPin(null); wake(); });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      const rect = canvas.getBoundingClientRect();
      showPin(countryAt(e.clientX - rect.left, e.clientY - rect.top));
    });

    const seenIO = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      seenIO.disconnect();
      pulseStart = performance.now();
      wake();
    }, { threshold: 0.5 });
    seenIO.observe(canvas);

    new ResizeObserver(() => requestAnimationFrame(layout)).observe(canvas);
  }

  travelMap($('.travel-map'));

  /* ── Toolbox: skill chips as rigid bodies ────
     Grab a chip where you touched it, drag it 1:1, and let go:
     it keeps your release velocity and the physics takes over. */

  function toolbox() {
    const pile = $('.toolbox-pile');
    const resetBtn = $('.toolbox-reset');
    if (!window.Matter || reducedMotion.matches) return; // the static wrapped list is the fallback

    const { Engine, Bodies, Body, Composite, Constraint } = window.Matter;
    const STEP = 1000 / 60;

    pile.classList.add('is-live');
    resetBtn.hidden = false;

    const engine = Engine.create({ gravity: { x: 0, y: 1 }, enableSleeping: true });
    const items = $$('.chip', pile).map((el) => ({ el, body: null, w: 0, h: 0 }));
    let walls = [];
    let width = 0;
    let height = 0;
    let running = false;
    let started = false;
    let raf = 0;
    let last = 0;
    let acc = 0;
    let grab = null;
    let toolboxTracked = false;

    function measure() {
      width = pile.clientWidth;
      height = pile.clientHeight;
      items.forEach((item) => { item.w = item.el.offsetWidth; item.h = item.el.offsetHeight; });
    }

    function buildWalls() {
      Composite.remove(engine.world, walls);
      const t = 400;
      const tall = height + 4000;
      const opts = { isStatic: true, friction: 0.4, restitution: 0.2 };
      walls = [
        Bodies.rectangle(width / 2, height + t / 2, width + t * 2, t, opts),          // floor
        Bodies.rectangle(-t / 2, height - tall / 2, t, tall, opts),                  // left
        Bodies.rectangle(width + t / 2, height - tall / 2, t, tall, opts),           // right
        Bodies.rectangle(width / 2, height - tall - t / 2, width + t * 2, t, opts),  // lid, far above
      ];
      Composite.add(engine.world, walls);
    }

    function drop() {
      items.forEach((item) => { if (item.body) Composite.remove(engine.world, item.body); });
      // Stack falls first, infrastructure next, AI last so it lands on top.
      // Within each group the order is shuffled, so every drop lands differently.
      const rank = { stack: 0, infra: 1, ai: 2 };
      const order = items
        .map((item, i) => ({ i, key: (rank[item.el.dataset.group] ?? 0) + Math.random() * 0.9 }))
        .sort((x, y) => x.key - y.key)
        .map(({ i }) => i);
      order.forEach((index, n) => {
        const item = items[index];
        const x = item.w / 2 + 4 + Math.random() * Math.max(1, width - item.w - 8);
        const y = -item.h - n * 38;
        item.body = Bodies.rectangle(x, y, item.w, item.h, {
          chamfer: { radius: item.h / 2 },
          restitution: 0.3,
          friction: 0.25,
          frictionAir: 0.015,
          density: 0.0015,
          angle: (Math.random() - 0.5) * 0.6,
        });
        item.el.classList.add('is-placed');
        Composite.add(engine.world, item.body);
      });
    }

    function sync() {
      for (const { el, body, w, h } of items) {
        if (!body) continue;
        const { x, y } = body.position;
        el.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) rotate(${body.angle}rad)`;
      }
    }

    function frame(now) {
      raf = 0;
      if (!running) return;
      acc += Math.min(now - last, 100);
      last = now;
      while (acc >= STEP) { Engine.update(engine, STEP); acc -= STEP; }
      sync();
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running) return;
      running = true;
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    }

    function localPoint(e) {
      const rect = pile.getBoundingClientRect();
      // Keep the hand inside the box so a dragged chip can't be pulled through a wall
      return {
        x: Math.min(Math.max(e.clientX - rect.left, 0), width),
        y: Math.min(Math.max(e.clientY - rect.top, -40), height),
      };
    }

    items.forEach((item) => {
      item.el.addEventListener('pointerdown', (e) => {
        if (!item.body || grab) return;
        e.preventDefault();
        item.el.setPointerCapture(e.pointerId);
        const p = localPoint(e);
        const body = item.body;
        // Respect where the chip was grabbed, not its center
        const constraint = Constraint.create({
          pointA: p,
          bodyB: body,
          pointB: { x: p.x - body.position.x, y: p.y - body.position.y },
          length: 0,
          stiffness: 0.25,
          damping: 0.08,
        });
        Body.setStatic(body, false);
        body.isSleeping = false;
        Composite.add(engine.world, constraint);
        grab = { item, constraint, pointerId: e.pointerId };
        if (!toolboxTracked) { toolboxTracked = true; track('toolbox_play', { chip: item.el.textContent }); }
        item.el.classList.add('is-held');
        start();
      });

      item.el.addEventListener('pointermove', (e) => {
        if (!grab || grab.item !== item || e.pointerId !== grab.pointerId) return;
        const p = localPoint(e);
        grab.constraint.pointA.x = p.x;
        grab.constraint.pointA.y = p.y;
        item.body.isSleeping = false;
      });

      const release = (e) => {
        if (!grab || grab.item !== item || e.pointerId !== grab.pointerId) return;
        Composite.remove(engine.world, grab.constraint);
        item.el.classList.remove('is-held');
        grab = null; // the body keeps its velocity, so the chip flies
      };
      item.el.addEventListener('pointerup', release);
      item.el.addEventListener('pointercancel', release);
    });

    resetBtn.addEventListener('click', () => { drop(); start(); });

    // Only simulate while the box is on screen; first sight triggers the drop
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (!started && entry.intersectionRatio >= 0.25) {
          started = true;
          measure();
          buildWalls();
          drop();
        }
        if (started) start();
      } else {
        stop();
      }
    }, { threshold: [0, 0.25] }).observe(pile);

    // Resize: move the walls and pull any stranded chips back inside
    let resizeRaf = 0;
    new ResizeObserver(() => {
      if (!started) return;
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        measure();
        buildWalls();
        items.forEach(({ body, w }) => {
          if (!body) return;
          const x = Math.min(Math.max(body.position.x, w / 2), width - w / 2);
          const y = Math.min(body.position.y, height - 30);
          Body.setPosition(body, { x, y });
          body.isSleeping = false;
        });
        start();
      });
    }).observe(pile);
  }

  toolbox();
})();
