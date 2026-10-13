(() => {
 const form = document.querySelector('#nt-classic-form');
 if (!form) return;
 const input = form.querySelector('[type=file]');
 const drop = form.querySelector('.nt-contact-classic__upload');
 const files = form.querySelector('.nt-contact-classic__files');
 const summary = form.querySelector('[data-classic-file-summary]');
 const status = form.querySelector('[role=status]');
 function renderFiles() {
  const names = [...input.files].map(file => file.name);
  files.hidden = !names.length;
  summary.textContent = names.length === 1 ? names[0] : `${names.length} Dateien: ${names.join(', ')}`;
  summary.title = names.join(', ');
 }
 input.addEventListener('change', renderFiles);
 form.querySelector('[data-classic-clear]').addEventListener('click', () => {
  input.value = ''; renderFiles(); input.focus();
 });
 ['dragenter','dragover'].forEach(name => drop.addEventListener(name, event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault(); drop.classList.add('is-over');
 }));
 drop.addEventListener('dragleave', event => { if (!drop.contains(event.relatedTarget)) drop.classList.remove('is-over'); });
 drop.addEventListener('drop', event => {
  event.preventDefault(); drop.classList.remove('is-over');
  if (!event.dataTransfer.files.length) return;
  input.files = event.dataTransfer.files; renderFiles();
 });
 form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  try {
    const result = await window.ntLandingSubmit(form);
    status.textContent = result.recovery
      ? 'Ihre Kontaktdaten sind angekommen. Bitte senden Sie Ihre Dateien zusätzlich an support@neontrip.de.'
      : 'Vielen Dank! Ihre Anfrage ist angekommen. Wir melden uns innerhalb von 24 Stunden bei Ihnen.';
  } catch (_) { return; }
  status.hidden = false; status.focus({preventScroll:true});
  status.scrollIntoView({block:'nearest',behavior:'instant'});
 });
})();
