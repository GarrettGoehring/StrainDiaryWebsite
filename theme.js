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
  siteNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
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
  function add(x, y, fire) {
    if (particles.length >= 90) particles.shift();
    particles.push({x, y, fire, age:0, life:fire ? .55 + Math.random() * .25 : .8 + Math.random() * .4,
      vx:(Math.random() - .5) * (fire ? 65 : 18),
      vy:-(fire ? 45 + Math.random() * 65 : 18 + Math.random() * 20),
      size:fire ? 3 + Math.random() * 4 : 7 + Math.random() * 6});
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
      const alpha = (1 - t) * (p.fire ? .65 : .16);
      const rgb = p.fire ? (t < .3 ? '255,211,112' : '239,118,43') : (dark ? '185,211,191' : '80,113,91');
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, 'rgba(' + rgb + ',' + alpha + ')');
      gradient.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    if (particles.length) frame = requestAnimationFrame(draw);
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
  const burning = new Map();
  const duration = 650;
  function ignite(button, navigate) {
    if (burning.has(button)) return;
    button.classList.add('is-burning');
    const emit = () => {
      if (!allowed()) return;
      const r = button.getBoundingClientRect();
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
      burning.delete(button);
      button.classList.remove('is-burning');
      if (navigate) navigate();
    }, duration);
    burning.set(button, {interval, timeout});
    emit();
  }
  document.addEventListener('click', e => {
    if (e.defaultPrevented || !allowed() || e.button !== 0 ||
        e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
        !(e.target instanceof Element)) return;
    const button = e.target.closest('button, .button, .nav-cta, .social-button');
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
  window.addEventListener('pagehide', () => {
    for (const [button, timers] of burning) {
      clearInterval(timers.interval);
      clearTimeout(timers.timeout);
      button.classList.remove('is-burning');
    }
    burning.clear();
  });
  window.addEventListener('resize', resize, {passive:true});
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  reduced.addEventListener('change', () => { if (reduced.matches) clear(); });
  window.addEventListener('pagehide', clear);
  resize();
})();
