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
  // Pointer-down lets sparks start immediately without delaying navigation.
  document.addEventListener('pointerdown', e => {
    if (!allowed() || e.button !== 0 || !(e.target instanceof Element)) return;
    const button = e.target.closest('button, .button, .nav-cta, .social-button');
    if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;
    for (let n = 0; n < 16; n++) add(e.clientX + (Math.random() - .5) * 22, e.clientY, true);
    start();
  }, {passive:true});
  window.addEventListener('resize', resize, {passive:true});
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  reduced.addEventListener('change', () => { if (reduced.matches) clear(); });
  window.addEventListener('pagehide', clear);
  resize();
})();
