const copyJournalButton = document.getElementById('copy-journal-template');
const journalTemplate = document.getElementById('journal-template-text');
const journalCopyStatus = document.getElementById('template-copy-status');
copyJournalButton.addEventListener('click', async (event) => {
  event.preventDefault();
  try {
    await navigator.clipboard.writeText(journalTemplate.textContent.trim());
    journalCopyStatus.textContent = 'Copied! Paste it into your notes to start an entry.';
  } catch {
    journalCopyStatus.textContent = 'Select the template text and copy it to your notes.';
  }
});
