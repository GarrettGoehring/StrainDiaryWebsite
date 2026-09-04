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
    if (particles.length >= 120) particles.shift();
    particles.push({x, y, fire, tap, age:0, life:fire ? .55 + Math.random() * .25 : (tap ? 1.4 : .8) + Math.random() * .4,
      vx:(Math.random() - .5) * (fire ? 65 : 18),
      vy:-(fire ? 45 + Math.random() * 65 : 18 + Math.random() * 20),
      size:fire ? 3 + Math.random() * 4 : (tap ? 15 : 7) + Math.random() * 6});
  }

  function drawBurnOutline(button, now) {
    const r = button.getBoundingClientRect();
    if (r.width < 1 || !r.height) return;
    const radius = Math.min(parseFloat(getComputedStyle(button).borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
    ctx.save();
    ctx.translate(r.left, r.top);
    const progress = Math.max(0, Math.min(1, ((now - (burning.get(button)?.started ?? now)) / duration - .12) / .76));
    const frontY = r.height * progress;
    button.style.setProperty('--burn-depth', frontY + 'px');
    const dy = Math.max(radius - frontY, frontY - (r.height - radius), 0);
    const sideInset = radius - Math.sqrt(Math.max(0, radius * radius - dy * dy));
    ctx.shadowColor = '#ff772b';
    ctx.shadowBlur = 9;
    // Layered translucent tongues with upward convection and independent curls.
    const age = Math.max(0, (now - (burning.get(button)?.started ?? now)) / duration);
    const envelope = Math.min(1, age / .12) * Math.min(1, Math.max(0, (1 - age) / .22));
    ctx.globalAlpha = envelope;
    ctx.shadowBlur = 5;
    function flame(x, y, nx, ny, phase) {
      const t = now / 1000;
      const flicker = Math.sin(t * 13 + phase) * .5 + Math.sin(t * 23 + phase * 2.3) * .25;
      const length = (16 + 10 * (flicker + .75)) * (ny > 0 ? .6 : 1);
      const tx = -ny, ty = nx;
      const curl = Math.sin(t * 9 + phase * 1.4) * 7;
      const tipX = x + nx * length + tx * curl;
      const tipY = y + ny * length + ty * curl - (ny === 0 ? length * .65 : 0);
      const width = 4.5 + 1.5 * Math.sin(phase * 2.1);
      const heat = ctx.createLinearGradient(x, y, tipX, tipY);
      heat.addColorStop(0, 'rgba(255,236,153,.95)');
      heat.addColorStop(.25, 'rgba(255,179,51,.85)');
      heat.addColorStop(.65, 'rgba(246,85,20,.55)');
      heat.addColorStop(1, 'rgba(172,36,12,0)');
      ctx.beginPath();
      ctx.moveTo(x - tx * width, y - ty * width);
      ctx.bezierCurveTo(x + nx * length * .35 - tx * width,
        y + ny * length * .35 - ty * width,
        tipX - tx * (width + curl * .3), tipY + 7, tipX, tipY);
      ctx.bezierCurveTo(tipX + tx * width * .5, tipY + 10,
        x + nx * length * .25 + tx * width,
        y + ny * length * .25 + ty * width,
        x + tx * width, y + ty * width);
      ctx.closePath();
      ctx.fillStyle = heat;
      ctx.fill();
      // Smaller pale core makes the flame read as heat, not a flat orange shape.
      ctx.beginPath();
      ctx.moveTo(x - tx * width * .4, y - ty * width * .4);
      ctx.quadraticCurveTo(x + nx * length * .4 - tx * 2,
        y + ny * length * .4 - ty * 2,
        x + (tipX - x) * .55, y + (tipY - y) * .55);
      ctx.quadraticCurveTo(x + nx * length * .15 + tx * 3,
        y + ny * length * .15 + ty * 3,
        x + tx * width * .4, y + ty * width * .4);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,244,189,.7)';
      ctx.fill();
    }
    // The horizontal ignition front descends; flame tongues still curl upward.
    ctx.beginPath();
    ctx.moveTo(sideInset, frontY);
    ctx.lineTo(r.width - sideInset, frontY);
    ctx.strokeStyle = '#ffb64f';
    ctx.lineWidth = 3;
    ctx.stroke();
    const count = Math.max(1, Math.min(48, Math.ceil((r.width - 2 * sideInset) / 10)));
    if (button.matches('header > nav > a')) {
      // Mirror each plume about the link's center so edge overhang is equal.
      const pairs = Math.max(1, Math.ceil(count / 2));
      for (let n = 0; n < pairs; n++) {
        const x = sideInset + n * (r.width / 2 - sideInset) / pairs;
        flame(x, frontY, 0, -1, n * 1.7);
        ctx.save();
        ctx.translate(r.width, 0);
        ctx.scale(-1, 1);
        flame(x, frontY, 0, -1, n * 1.7);
        ctx.restore();
      }
    } else {
      for (let n = 0; n <= count; n++) {
        const x = sideInset + n * (r.width - 2 * sideInset) / count;
        flame(x, frontY, 0, -1, n * 1.7);
      }
    }
    ctx.restore();
  }

  function draw(now) {
    frame = 0;
    if (!allowed()) { clear(); return; }
    const dt = Math.min((now - previous) / 1000, .04);
    previous = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    // Convert viewport coordinates to the canvas's actual displayed bounds.
    const canvasBounds = canvas.getBoundingClientRect();
    if (canvasBounds.width && canvasBounds.height) {
      const sx = canvas.width / canvasBounds.width, sy = canvas.height / canvasBounds.height;
      ctx.setTransform(sx, 0, 0, sy, -canvasBounds.left * sx, -canvasBounds.top * sy);
    }
    const dark = document.documentElement.dataset.theme === 'dark';
    particles = particles.filter(p => p.age < p.life);
    for (const p of particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = Math.min(p.age / p.life, 1);
      const radius = p.size * (p.fire ? 1 - t * .6 : 1 + t * 1.8);
      const alpha = (1 - t) * (p.fire ? .65 : p.tap ? .4 : .22);
      const rgb = p.fire ? (t < .3 ? '255,211,112' : '239,118,43') : (dark ? '185,211,191' : '80,113,91');
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, 'rgba(' + rgb + ',' + alpha + ')');
      gradient.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const button of burning.keys()) {
      if (!button.classList.contains('is-charred')) drawBurnOutline(button, now);
    }
    if (particles.length || burning.size) frame = requestAnimationFrame(draw);
  }
  function start() {
    if (!frame) { previous = performance.now(); frame = requestAnimationFrame(draw); }
  }
  document.addEventListener('pointermove', e => {
    if (!allowed() || !fine.matches || e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - lastMove < 24) return;
    lastMove = now;
    add(e.clientX - 3, e.clientY + 8, false);
    if (Math.random() > .45) add(e.clientX + 4, e.clientY + 10, false);
    start();
  }, {passive:true});
  // Passive touch events keep the vapor trail active during native scrolling.
  function tapPuff(x, y) {
    if (!allowed()) return;
    for (let n = 0; n < 16; n++)
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
    for (let n = 0; n < 4; n++)
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
  // Make visible content surfaces individually burnable without changing their normal behavior.
  const burnableSelector = [
    'header', '.brand', 'header > nav > a', '.nav-cta', '.social-button', '.theme-toggle',
    '.hero-copy > *', '.actions > *', '.reassurance > *', '.visual > *',
    '.proof > *', '.section-intro > *', '.steps > article',
    '.feature-showcase .device-shot', '.feature-copy > *', '.feature-copy li',
    '.privacy > *', '.join > *', '.page-hero > *', '.feature-row > *',
    '.feature-page-copy > *', '.check-list > li', '.feature-shot > *',
    '.page-cta > *', '.beta-panel > *', '.contact-card > *', 'form > *',
    '.site-footer .footer-brand > *', '.footer-column > *', '.footer-bottom > *',
    'main article', 'main .card', 'main img'
  ].join(',');
  document.querySelectorAll(burnableSelector).forEach((element) => {
    // Screenshot files include large transparent margins; burn their cropped wrapper instead.
    if (element.matches('.device-shot img')) return;
    if (!element.closest('.cursor-vapor')) element.classList.add('burn-surface');
  });
  document.querySelectorAll('.device-shot').forEach((shot) => shot.classList.add('burn-surface'));

  // Carry a clicked menu's charred state onto the destination page once.
  const pendingMenuBurn = sessionStorage.getItem('strain-diary-pending-menu-burn');
  sessionStorage.removeItem('strain-diary-pending-menu-burn');
  if (pendingMenuBurn) {
    const currentKey = location.pathname.replace(/\/index\.html$/, '/') + location.search + location.hash;
    if (pendingMenuBurn === currentKey) {
      document.querySelectorAll('header > nav > a, .nav-cta, .site-header nav a').forEach((link) => {
        const target = new URL(link.href, location.href);
        const targetKey = target.pathname.replace(/\/index\.html$/, '/') + target.search + target.hash;
        if (target.origin === location.origin && targetKey === currentKey) {
          link.classList.add('burn-surface', 'is-charred');
          burntLinks.add(link);
        }
      });
    }
  }
  const duration = 850;
  function ignite(button, navigate) {
    if (burning.has(button)) return;
    if (burntLinks.has(button)) { if (navigate) navigate(); return; }
    const started = performance.now();
    button.classList.add('is-burning');
    const emit = () => {
      if (!allowed()) return;
      const r = button.getBoundingClientRect();
      if (r.width < 1) return;
      const progress = Math.max(0, Math.min(1, ((performance.now() - started) / duration - .12) / .76));
      for (let n = 0; n < 8; n++)
        add(r.left + Math.random() * r.width, r.top + r.height * progress, true);
      start();
    };
    const interval = setInterval(emit, 40);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      button.classList.remove('is-burning');
      button.classList.add('is-charred');
      button.style.setProperty('--burn-depth', button.getBoundingClientRect().height + 'px');
      const timers = burning.get(button);
      // Pause on the completed brown state so it can be seen before leaving.
      timers.timeout = setTimeout(() => {
        burning.delete(button);
        burntLinks.add(button);
        if (navigate) navigate();
      }, 180);
    }, duration);
    burning.set(button, {interval, timeout, started});
    emit();
  }
  document.addEventListener('click', e => {
    if (e.defaultPrevented || !allowed() || e.button !== 0 ||
        e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
        !(e.target instanceof Element)) return;
    const button = e.target.closest('.burn-surface, button, .button, .nav-cta, .social-button, header > nav > a');
    if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;
    let navigate;
    if (button instanceof HTMLAnchorElement) {
      const url = new URL(button.href, location.href);
      if (button.hasAttribute('download') ||
          !['http:', 'https:'].includes(url.protocol)) return;
      // Animate new-tab social links too, without blocking the native popup.
      if (button.target && button.target !== '_self') {
        ignite(button);
        return;
      }
      e.preventDefault();
      // A link to the page already open should char and stay charred, not reload itself.
      const current = new URL(location.href);
      const samePage = url.origin === current.origin &&
        url.pathname.replace(/\/index\.html$/, '/') === current.pathname.replace(/\/index\.html$/, '/') &&
        url.search === current.search && url.hash === current.hash;
      if (!samePage) navigate = () => {
        const destinationKey = url.pathname.replace(/\/index\.html$/, '/') + url.search + url.hash;
        if (button.matches('header > nav > a, .nav-cta, .site-header nav a')) {
          sessionStorage.setItem('strain-diary-pending-menu-burn', destinationKey);
        }
        location.assign(url.href);
      };
    }
    // Form submission, menu controls, and theme changes retain native timing.
    ignite(button, navigate);
  });
  function resetBurns() {
    for (const [button, timers] of burning) {
      clearInterval(timers.interval);
      clearTimeout(timers.timeout);
      button.classList.remove('is-burning', 'is-charred');
        button.style.removeProperty('--burn-depth');
    }
    burning.clear();
    for (const button of burntLinks) {
      button.classList.remove('is-burning', 'is-charred');
      button.style.removeProperty('--burn-depth');
    }
    burntLinks.clear();
    clear();
  }
  window.addEventListener('pagehide', () => {
    // Stop work without flashing the original color as the page leaves.
    for (const timers of burning.values()) {
      clearInterval(timers.interval);
      clearTimeout(timers.timeout);
    }
    clear();
  });
  window.addEventListener('pageshow', resetBurns);
  // Back navigation within the same document (for section links).
  window.addEventListener('popstate', resetBurns);
  window.addEventListener('resize', resize, {passive:true});
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  reduced.addEventListener('change', () => { if (reduced.matches) clear(); });
  window.addEventListener('pagehide', clear);
  resize();
})();
