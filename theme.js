const root = document.documentElement;
const toggle = document.querySelector('.theme-toggle');
const savedTheme = localStorage.getItem('strain-diary-theme');

function applyTheme(theme) {
  const isDark = theme === 'dark';
  root.dataset.theme = theme;
  toggle.setAttribute('aria-pressed', String(isDark));
  toggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
}

applyTheme(savedTheme || 'dark');
toggle.addEventListener('click', () => {
  const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  localStorage.setItem('strain-diary-theme', nextTheme);
});

