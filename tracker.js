// Switch only the preview image; feature descriptions remain readable without JS.
const trackerOptions = [...document.querySelectorAll('.tracker-option')];
const trackerScreen = document.getElementById('tracker-screen');
const trackerScreenLabel = document.getElementById('tracker-screen-label');
trackerOptions.forEach((button) => {
  button.addEventListener('click', (event) => {
    // Keep the preview selection readable instead of triggering the site's burn effect.
    event.preventDefault();
    trackerOptions.forEach((option) => {
      const selected = option === button;
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    });
    trackerScreen.src = `assets/screenshots/${button.dataset.screen}.webp`;
    trackerScreen.alt = button.dataset.alt;
    trackerScreenLabel.textContent = button.dataset.caption;
  });
});
