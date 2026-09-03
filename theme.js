const root = document.documentElement;
const themeToggles = [...document.querySelectorAll('.theme-toggle')];
const menuButton = document.querySelector('.mobile-menu-button');
const siteNav = document.querySelector('header > nav');
const savedTheme = localStorage.getItem('strain-diary-theme');
const deviceTheme = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(theme) {
  const isDark = theme === 'dark';
  root.dataset.theme = theme;
  themeToggles.forEach((toggle) => {
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
  });
}

applyTheme(savedTheme || (deviceTheme.matches ? 'dark' : 'light'));
deviceTheme.addEventListener('change', (event) => {
  if (!localStorage.getItem('strain-diary-theme')) {
    applyTheme(event.matches ? 'dark' : 'light');
  }
});
themeToggles.forEach((toggle) => toggle.addEventListener('click', () => {
  const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  localStorage.setItem('strain-diary-theme', nextTheme);
}));

if (menuButton && siteNav) {
  const closeMenu = () => {
    siteNav.classList.remove('is-open');
    menuButton.setAttribute('aria-expanded', 'false');
  };

  menuButton.addEventListener('click', () => {
    const isOpen = siteNav.classList.toggle('is-open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
  });
  siteNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', (event) => {
    // Leave the mobile menu visible while its link burns before navigation.
    const animatedNavigation = !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !event.defaultPrevented && event.button === 0 &&
      !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
      (!link.target || link.target === '_self') && !link.hasAttribute('download') &&
      ['http:', 'https:'].includes(new URL(link.href, location.href).protocol);
    if (!animatedNavigation) closeMenu();
  }));
  window.addEventListener('pageshow', closeMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  document.addEventListener('click', (event) => {
    if (!siteNav.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
  });
}

// Decorative vapor and brief ignition sparks; never intercept input.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(any-pointer: fine)');
  const canvas = document.createElement('canvas');
  canvas.className = 'cursor-vapor';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  document.body.appendChild(canvas);
  let particles = [], frame = 0, previous = 0, lastMove = 0;
  const allowed = () => !reduced.matches && !document.hidden;
  function resize() {
    const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * scale);
    canvas.height = Math.round(innerHeight * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  function clear() {
    cancelAnimationFrame(frame);
    frame = 0;
    particles = [];
    ctx.clearRect(0, 0, innerWidth, innerHeight);
  }
  function add(x, y, fire, tap = false) {
    if (particles.length >= 90) particles.shift();
    particles.push({x, y, fire, tap, age:0, life:fire ? .55 + Math.random() * .25 : (tap ? 1.4 : .8) + Math.random() * .4,
      vx:(Math.random() - .5) * (fire ? 65 : 18),
      vy:-(fire ? 45 + Math.random() * 65 : 18 + Math.random() * 20),
      size:fire ? 3 + Math.random() * 4 : (tap ? 15 : 7) + Math.random() * 6});
  }

  function drawBurnOutline(button, now) {
    const bounds = button.getBoundingClientRect();
    const elapsed = (now - (burning.get(button)?.started || now)) / duration;
    const consumed = Math.max(0, Math.min(1, (elapsed - .2) / .7));
    const r = {left:bounds.left + bounds.width * consumed, top:bounds.top,
      width:bounds.width * (1 - consumed), height:bounds.height};
    if (r.width < 1 || !r.height) return;
    const radius = Math.min(parseFloat(getComputedStyle(button).borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
    ctx.save();
    ctx.translate(r.left, r.top);
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(r.width - radius, 0);
    ctx.quadraticCurveTo(r.width, 0, r.width, radius);
    ctx.lineTo(r.width, r.height - radius);
    ctx.quadraticCurveTo(r.width, r.height, r.width - radius, r.height);
    ctx.lineTo(radius, r.height);
    ctx.quadraticCurveTo(0, r.height, 0, r.height - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.shadowColor = '#ff772b';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#ef752a';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = '#ffe29b';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Evenly cover all four edges rather than relying on random sparks.
    function flame(x, y, nx, ny, phase) {
      const length = 8 + 5 * (1 + Math.sin(now / 85 + phase));
      const tx = -ny, ty = nx;
      ctx.beginPath();
      ctx.moveTo(x - tx * 4, y - ty * 4);
      ctx.quadraticCurveTo(x + nx * length * .5 - tx * 5,
        y + ny * length * .5 - ty * 5,
        x + nx * length + tx * 2, y + ny * length + ty * 2);
      ctx.quadraticCurveTo(x + nx * length * .3 + tx * 5,
        y + ny * length * .3 + ty * 5, x + tx * 4, y + ty * 4);
      ctx.closePath();
      ctx.fillStyle = '#f89536';
      ctx.fill();
    }
    const horizontal = Math.max(1, Math.ceil(r.width / 10));
    for (let n = 0; n <= horizontal; n++) {
      const x = n * r.width / horizontal;
      const dx = Math.max(radius - x, x - (r.width - radius), 0);
      const inset = radius - Math.sqrt(Math.max(0, radius * radius - dx * dx));
      flame(x, inset, 0, -1, n * 1.7);
      flame(x, r.height - inset, 0, 1, n * 1.7 + 2);
    }
    const vertical = Math.max(1, Math.ceil(r.height / 10));
    for (let n = 0; n <= vertical; n++) {
      const y = n * r.height / vertical;
      const dy = Math.max(radius - y, y - (r.height - radius), 0);
      const inset = radius - Math.sqrt(Math.max(0, radius * radius - dy * dy));
      flame(inset, y, -1, 0, n * 1.9);
      flame(r.width - inset, y, 1, 0, n * 1.9 + 2);
    }
    ctx.restore();
  }

  function draw(now) {
    frame = 0;
    if (!allowed()) { clear(); return; }
    const dt = Math.min((now - previous) / 1000, .04);
    previous = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const dark = document.documentElement.dataset.theme === 'dark';
    particles = particles.filter(p => p.age < p.life);
    for (const p of particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = Math.min(p.age / p.life, 1);
      const radius = p.size * (p.fire ? 1 - t * .6 : 1 + t * 1.8);
      const alpha = (1 - t) * (p.fire ? .65 : p.tap ? .36 : .16);
      const rgb = p.fire ? (t < .3 ? '255,211,112' : '239,118,43') : (dark ? '185,211,191' : '80,113,91');
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, 'rgba(' + rgb + ',' + alpha + ')');
      gradient.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const button of burning.keys()) drawBurnOutline(button, now);
    if (particles.length || burning.size) frame = requestAnimationFrame(draw);
  }
  function start() {
    if (!frame) { previous = performance.now(); frame = requestAnimationFrame(draw); }
  }
  document.addEventListener('pointermove', e => {
    if (!allowed() || !fine.matches || e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - lastMove < 28) return;
    lastMove = now;
    add(e.clientX, e.clientY + 8, false);
    start();
  }, {passive:true});
  // Passive touch events keep the vapor trail active during native scrolling.
  function tapPuff(x, y) {
    if (!allowed()) return;
    for (let n = 0; n < 12; n++)
      add(x + (Math.random() - .5) * 28, y - 6 + (Math.random() - .5) * 18, false, true);
    start();
  }
  let contact = null;
  let lastTouchVapor = 0;
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { contact = null; return; }
    const t = e.touches[0];
    contact = t.identifier;
    lastTouchVapor = 0;
    tapPuff(t.clientX, t.clientY);
  }, {passive:true});
  document.addEventListener('touchmove', e => {
    if (!allowed() || contact === null || e.touches.length !== 1) return;
    const t = [...e.touches].find(t => t.identifier === contact);
    if (!t) return;
    const now = performance.now();
    if (now - lastTouchVapor < 24) return;
    lastTouchVapor = now;
    for (let n = 0; n < 3; n++)
      add(t.clientX + (Math.random() - .5) * 12,
          t.clientY + 8 + (Math.random() - .5) * 8, false, true);
    start();
  }, {passive:true});
  document.addEventListener('touchend', e => {
    const t = [...e.changedTouches].find(t => t.identifier === contact);
    if (!t) return;
    contact = null;
    tapPuff(t.clientX, t.clientY);
  }, {passive:true});
  document.addEventListener('touchcancel', () => { contact = null; }, {passive:true});
  const burning = new Map();
  const burntLinks = new Set();
  const duration = 850;
  function ignite(button, navigate) {
    if (burning.has(button) || burntLinks.has(button)) return;
    const started = performance.now();
    button.classList.add('is-burning');
    const emit = () => {
      if (!allowed()) return;
      const bounds = button.getBoundingClientRect();
      const consumed = Math.max(0, Math.min(1, ((performance.now() - started) / duration - .2) / .7));
      const r = {left:bounds.left + bounds.width * consumed, top:bounds.top,
        width:bounds.width * (1 - consumed), height:bounds.height};
      if (r.width < 1) return;
      const corner = Math.min(parseFloat(getComputedStyle(button).borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
      for (let n = 0; n < 12; n++) {
        // Sample the rounded border so embers surround the whole button.
        let x, y;
        if (Math.random() < r.width / (r.width + r.height)) {
          x = Math.random() * r.width;
          const dx = Math.max(corner - x, x - (r.width - corner), 0);
          const inset = corner - Math.sqrt(Math.max(0, corner * corner - dx * dx));
          y = Math.random() < .5 ? inset : r.height - inset;
        } else {
          y = Math.random() * r.height;
          const dy = Math.max(corner - y, y - (r.height - corner), 0);
          const inset = corner - Math.sqrt(Math.max(0, corner * corner - dy * dy));
          x = Math.random() < .5 ? inset : r.width - inset;
        }
        add(r.left + x, r.top + y, true);
      }
      start();
    };
    const interval = setInterval(emit, 40);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      const restore = () => {
        burning.delete(button);
        button.classList.remove('is-burning');
      };
      if (navigate) {
        // Preserve the final burnt state until this document is left or restored.
        burning.delete(button);
        burntLinks.add(button);
        navigate();
      } else restore();
    }, duration);
    burning.set(button, {interval, timeout, started});
    emit();
  }
  document.addEventListener('click', e => {
    if (e.defaultPrevented || !allowed() || e.button !== 0 ||
        e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
        !(e.target instanceof Element)) return;
    const button = e.target.closest('button, .button, .nav-cta, .social-button, header > nav > a');
    if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;
    let navigate;
    if (button instanceof HTMLAnchorElement) {
      const url = new URL(button.href, location.href);
      // Preserve downloads, external app links, and native new-tab behavior.
      if (button.hasAttribute('download') ||
          (button.target && button.target !== '_self') ||
          !['http:', 'https:'].includes(url.protocol)) return;
      e.preventDefault();
      navigate = () => location.assign(url.href);
    }
    // Form submission, menu controls, and theme changes retain native timing.
    ignite(button, navigate);
  });
  function resetBurns() {
    for (const [button, timers] of burning) {
      clearInterval(timers.interval);
      clearTimeout(timers.timeout);
      button.classList.remove('is-burning');
    }
    burning.clear();
    for (const button of burntLinks) button.classList.remove('is-burning');
    burntLinks.clear();
    clear();
  }
  window.addEventListener('pagehide', resetBurns);
  window.addEventListener('pageshow', resetBurns);
  // Back navigation within the same document (for section links).
  window.addEventListener('popstate', resetBurns);
  window.addEventListener('resize', resize, {passive:true});
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  reduced.addEventListener('change', () => { if (reduced.matches) clear(); });
  window.addEventListener('pagehide', clear);
  resize();
})();
