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

