(() => {
  'use strict';
  const root = document.querySelector('.nt-inquiry-b');
  if (!root) return;
  const form = root.querySelector('#nt-inquiry-form');
  const panels = [...form.querySelectorAll('.step-panel')];
  const steps = [...form.querySelectorAll('.progress li')];
  const stage = form.querySelector('.stage');
  const next = form.querySelector('#nt-inquiry-next');
  const back = form.querySelector('#nt-inquiry-back');
  const hint = form.querySelector('#nt-inquiry-footer-hint');
  const fileInput = form.querySelector('#nt-inquiry-files');
  const upload = form.querySelector('#nt-inquiry-upload-zone');
  const fileSelection = form.querySelector('.file-selection');
  const sizeRange = form.querySelector('#nt-inquiry-size-range');
  const sizeOutput = form.querySelector('#nt-inquiry-size-value');
  const email = form.querySelector('#nt-inquiry-email');
  const emailStatus = form.querySelector('#nt-inquiry-email-status');
  const emailAlternative = form.querySelector('.email-alternative');
  const consent = form.querySelector('#nt-inquiry-privacy-consent');
  const consentError = form.querySelector('#nt-inquiry-privacy-consent-error');
  const fileError = form.querySelector('#nt-inquiry-file-error');
  const fileList = form.querySelector('#nt-inquiry-file-list');
  const contactInputs = [...form.querySelectorAll('.contact-fields input[required]')];
  const personalEmailDomains = new Set(['gmail.com','googlemail.com','gmx.de','gmx.net','gmx.com','web.de','yahoo.de','yahoo.com','yahoo.co.uk','outlook.com','outlook.de','hotmail.com','hotmail.de','live.com','live.de','msn.com','icloud.com','me.com','mac.com','aol.com','aol.de','mail.com','email.com','proton.me','protonmail.com','pm.me','tuta.com','tutanota.com','t-online.de','freenet.de','arcor.de','vodafone.de','online.de']);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0, highest = 0, busy = false, locationTimer, selectedFiles = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const animate = async (el, frames, options = {}) => {
    if (motion.matches) return;
    const animation = el.animate(frames, {duration: 420, easing: 'cubic-bezier(.22,1,.36,1)', ...options});
    await animation.finished.catch(() => {});
  };
  function announce(text) { form.querySelector('#nt-inquiry-announcer').textContent = text; }
  function updateSize() {
    sizeOutput.replaceChildren(document.createTextNode(`${sizeRange.value} `), Object.assign(document.createElement('span'), {textContent:'cm'}));
    sizeRange.setAttribute('aria-valuetext', `${sizeRange.value} Zentimeter breit`);
    const progress = (Number(sizeRange.value) - Number(sizeRange.min)) / (Number(sizeRange.max) - Number(sizeRange.min)) * 100;
    sizeRange.style.setProperty('--size-progress', `${progress}%`);
  }
  sizeRange.addEventListener('input', updateSize);
  function validateContactInput(input, report = true) {
    input.setCustomValidity('');
    const missing = {firstName:'Bitte Vornamen eingeben.',lastName:'Bitte Nachnamen eingeben.',email:'Bitte Unternehmens-E-Mail eingeben.',phone:'Bitte Telefonnummer eingeben.'};
    let message = !input.value.trim() ? missing[input.name] : '';
    if (input === email) {
      const value = input.value.trim();
      const [localPart, domain = ''] = value.toLowerCase().split('@');
      const privateProvider = [...personalEmailDomains].some(provider => domain === provider || domain.endsWith('.' + provider));
      if (!message) {
        if (input.validity.typeMismatch || !/\.(?:[a-z]{2,}|xn--[a-z0-9-]+)$/i.test(domain) || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) message = 'Bitte eine gültige E-Mail-Adresse eingeben, z. B. name@unternehmen.de.';
        else if (privateProvider) message = 'Bitte eine Unternehmens-E-Mail nutzen oder oben „Per E-Mail anfragen“ wählen.';
      }
      emailStatus.hidden = !report || !!message;
      emailAlternative.classList.toggle('is-highlighted', report && privateProvider);
    }
    input.setCustomValidity(message);
    const error = form.querySelector('#' + input.id + '-error');
    error.textContent = report ? message : '';
    error.hidden = !report || !message;
    if (report && message) input.setAttribute('aria-invalid','true'); else input.removeAttribute('aria-invalid');
    return !message;
  }
  contactInputs.forEach(input => {
    input.addEventListener('input', () => validateContactInput(input, input === email || input.hasAttribute('aria-invalid')));
    input.addEventListener('change', () => validateContactInput(input));
    input.addEventListener('blur', () => validateContactInput(input));
  });
  function validateConsent(report = true) {
    const invalid = !consent.checked;
    consent.setCustomValidity(invalid ? 'Bitte bestätigen Sie die Datenschutzerklärung.' : '');
    consentError.hidden = !report || !invalid;
    if (report && invalid) consent.setAttribute('aria-invalid', 'true'); else consent.removeAttribute('aria-invalid');
    return !invalid;
  }
  consent.addEventListener('change', () => validateConsent());
  function illuminate() {
    animate(root.querySelector('.brand-bolt'), [{fill:'#eaeaec',opacity:.65},{fill:'#fa31a2',opacity:.12,offset:.22},{fill:'#eaeaec',opacity:.65}], {duration:1100});
    animate(form.querySelector('.card-glow'), [{opacity:0},{opacity:.45,offset:.3},{opacity:0}], {duration:1000});
  }
  function setProgress() {
    const isDone = current === 3;
    steps.forEach((li,i) => {
      const button = li.querySelector('button');
      li.classList.toggle('is-current', i === current);
      li.classList.toggle('is-complete', i < current);
      button.disabled = busy || isDone || i > highest;
      if (i === current) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
    });
    form.querySelector('#nt-inquiry-step-count').textContent = isDone ? 'Anfrage erhalten' : `Schritt ${current + 1} von 3`;
    back.hidden = current === 0 || isDone;
    hint.hidden = current !== 0;
    next.hidden = isDone;
    next.disabled = busy || (current === 0 && !form.querySelector('[name="location"]:checked'));
    next.querySelector('span').textContent = ['Weiter zum Design','Weiter zum Kontakt','Unverbindlich anfragen'][current] || '';
    next.type = current === 2 ? 'submit' : 'button';
    form.querySelector('#nt-inquiry-consent-block').hidden = current !== 2;
    consent.disabled = current !== 2;
    back.disabled = busy;
  }
  async function goTo(target, focus = true) {
    if (busy || target === current || target < 0 || target > 3) return;
    clearTimeout(locationTimer);
    busy = true;
    form.classList.add('is-busy');
    setProgress();
    const outgoing = panels[current];
    const direction = target > current ? 1 : -1;
    await animate(outgoing, [{opacity:1,transform:'translateX(0)',filter:'blur(0px)'},{opacity:0,transform:`translateX(${-24 * direction}px)`,filter:'blur(3px)'}], {duration:170,easing:'cubic-bezier(.4,0,1,1)'});
    outgoing.hidden = true;
    outgoing.inert = true;
    current = target;
    highest = Math.max(highest, Math.min(target,2));
    const incoming = panels[current];
    incoming.hidden = false;
    incoming.inert = false;
    setProgress();
    if (current === 2) {
      const location = form.querySelector('[name="location"]:checked')?.value;
      form.querySelector('#nt-inquiry-project-summary').textContent = `${location === 'aussen' ? 'Außenbereich' : 'Innenbereich'} · ca. ${sizeRange.value} cm breit · ${selectedFiles.length} ${selectedFiles.length === 1 ? 'Datei' : 'Dateien'}`;
    }
    if (focus) incoming.querySelector('h3').focus({preventScroll:true});
    announce(current === 3 ? 'Ihre Anfrage wurde gespeichert. Wir melden uns innerhalb von 24 Stunden.' : `Schritt ${current + 1} von 3: ${['Einsatzort','Ihr Design','Kontakt'][current]}`);
    const elements = [...incoming.querySelectorAll('[data-enter]')];
    await Promise.all(elements.map((el,i) => animate(el, [{opacity:0,transform:`translate(${30 * direction}px, 5px)`,filter:'blur(3px)'},{opacity:1,transform:'translate(0, 0)',filter:'blur(0px)'}], {duration:460,delay:i*45,fill:'backwards'})));
    busy = false;
    form.classList.remove('is-busy');
    setProgress();
  }
  function selectLocation(value, autoAdvance = true) {
    if (busy || current !== 0) return;
    clearTimeout(locationTimer);
    form.querySelectorAll('[name="location"]').forEach(input => {
      input.checked = input.value === value;
      input.closest('.location-card').classList.toggle('is-selected', input.checked);
    });
    next.disabled = false;
    illuminate();
    announce(`${value === 'innen' ? 'Innenbereich' : 'Außenbereich'} ausgewählt.`);
    if (autoAdvance) locationTimer = setTimeout(() => goTo(1), motion.matches ? 220 : 650);
  }
  form.querySelectorAll('[name="location"]').forEach(input => input.addEventListener('change', () => selectLocation(input.value)));
  function validPanel(index, report = true) {
    if (index === 2) {
      const invalid = contactInputs.filter(input => !validateContactInput(input, report));
      if (!validateConsent(report)) invalid.push(consent);
      if (invalid.length && report) {
        announce('Bitte prüfen Sie die markierten Kontaktfelder.');
        invalid[0].focus();
      }
      return !invalid.length;
    }
    const invalid = [...panels[index].querySelectorAll('input,textarea,select')].find(input => !input.checkValidity());
    if (invalid) {
      if (report && invalid === fileInput) {
        fileError.hidden = false;
        upload.classList.add('has-error');
        fileInput.setAttribute('aria-invalid','true');
        fileInput.focus({preventScroll:true});
        fileError.scrollIntoView({block:'nearest',behavior:motion.matches?'instant':'smooth'});
      } else if (report) invalid.reportValidity();
      return false;
    }
    return true;
  }
  next.addEventListener('click', event => {
    if (current === 2) return;
    event.preventDefault();
    if (busy) return;
    if (validPanel(current)) goTo(current + 1);
  });
  back.addEventListener('click', () => goTo(current - 1));
  form.querySelectorAll('[data-step-button]').forEach(button => button.addEventListener('click', () => {
    const target = Number(button.dataset.stepButton);
    if (target > current) {
      for (let i=0; i<target; i++) {
        if (!validPanel(i, i === current)) {
          if (i !== current) goTo(i).then(() => validPanel(i));
          return;
        }
      }
    }
    goTo(target);
  }));
  form.querySelector('#nt-inquiry-edit-location').addEventListener('click', () => goTo(0));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    for (let i=0;i<=current;i++) {
      if (i !== current && !validPanel(i, false)) { goTo(i).then(() => validPanel(i)); return; }
    }
    if (!validPanel(current)) return;
    if (current < 2) { goTo(current + 1); return; }
    busy = true; setProgress();
    try {
      const result = await window.ntLandingSubmit(form);
      const done = form.querySelector('#nt-inquiry-completion-title');
      done.textContent = result.recovery ? 'Kontaktdaten gespeichert.' : 'Anfrage erhalten.';
      done.nextElementSibling.textContent = result.recovery
        ? 'Ihre Kontaktdaten sind angekommen. Die Dateiübertragung ist fehlgeschlagen. Bitte senden Sie uns Ihr Design an support@neontrip.de.'
        : 'Vielen Dank! Sie erhalten innerhalb von 24 Stunden Ihr unverbindliches Angebot und Ihre Visualisierung.';
      busy = false; illuminate(); goTo(3);
    } catch (_) { busy = false; setProgress(); }
  });
  function syncFileInput() {
    const transfer = new DataTransfer();
    selectedFiles.forEach(file => transfer.items.add(file));
    fileInput.files = transfer.files;
  }
  function showFiles(files) {
    selectedFiles = [...files];
    syncFileInput();
    fileError.hidden = true;
    upload.classList.remove('has-error');
    fileInput.removeAttribute('aria-invalid');
    fileSelection.hidden = !selectedFiles.length;
    upload.classList.toggle('has-files', !!selectedFiles.length);
    form.querySelector('#nt-inquiry-upload-title').textContent = selectedFiles.length ? 'Weitere Dateien hinzufügen' : 'Design-Dateien auswählen';
    fileInput.setAttribute('aria-label', selectedFiles.length ? 'Weitere Design-Dateien hinzufügen' : 'Design-Dateien auswählen (Pflichtfeld)');
    form.querySelector('#nt-inquiry-file-count').textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? 'Datei ausgewählt' : 'Dateien ausgewählt'}`;
    const scrollTop = fileList.scrollTop;
    fileList.replaceChildren(...selectedFiles.map((file,index) => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = file.name;
      name.title = file.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'file-remove';
      remove.dataset.fileIndex = index;
      remove.setAttribute('aria-label', `Datei entfernen: ${file.name}`);
      remove.innerHTML = '<svg aria-hidden="true"><use href="#nt-inquiry-close"/></svg>';
      row.append(name,remove);
      return row;
    }));
    fileList.scrollTop = scrollTop;
    if (selectedFiles.length) {
      illuminate();
      animate(fileSelection, [{opacity:0,transform:'translateY(10px) scale(.98)'},{opacity:1,transform:'translateY(0) scale(1)'}], {duration:440});
      animate(upload.querySelector('.upload-icon'), [{transform:'rotate(0)'},{transform:'rotate(-12deg)',offset:.4},{transform:'rotate(0)'}], {duration:480});
      announce(`${selectedFiles.length} ${selectedFiles.length === 1 ? 'Datei ausgewählt' : 'Dateien ausgewählt'}.`);
    }
  }
  function addFiles(files) {
    const additions = [...files];
    if (!additions.length) { syncFileInput(); return; }
    showFiles([...selectedFiles, ...additions]);
    fileList.scrollTop = fileList.scrollHeight;
  }
  fileInput.addEventListener('change', () => addFiles(fileInput.files));
  fileInput.addEventListener('cancel', syncFileInput);
  fileList.addEventListener('click', event => {
    const button = event.target.closest('[data-file-index]');
    if (!button) return;
    const index = Number(button.dataset.fileIndex);
    showFiles(selectedFiles.filter((_,i) => i !== index));
    if (!selectedFiles.length) validPanel(1);
    else (fileList.querySelectorAll('button')[Math.min(index,selectedFiles.length-1)] || fileInput).focus({preventScroll:true});
  });
  form.querySelector('#nt-inquiry-clear-files').addEventListener('click', () => { showFiles([]); validPanel(1); });
  let dragDepth = 0;
  upload.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; upload.classList.add('is-dragging'); });
  upload.addEventListener('dragover', event => event.preventDefault());
  upload.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth=0; upload.classList.remove('is-dragging'); } });
  upload.addEventListener('drop', event => { event.preventDefault(); dragDepth=0; upload.classList.remove('is-dragging'); addFiles(event.dataTransfer.files); });
  async function reset() {
    clearTimeout(locationTimer);
    while (busy) await wait(40);
    if (current !== 0) await goTo(0, false);
    form.reset();
    contactInputs.forEach(input => { input.setCustomValidity(''); input.removeAttribute('aria-invalid'); form.querySelector('#'+input.id+'-error').hidden = true; });
    emailStatus.hidden = true;
    emailAlternative.classList.remove('is-highlighted');
    consent.setCustomValidity('');
    consent.removeAttribute('aria-invalid');
    consentError.hidden = true;
    updateSize();
    form.querySelectorAll('.location-card').forEach(card => card.classList.remove('is-selected'));
    showFiles([]);
    highest = 0;
    setProgress();
  }
  form.querySelector('#nt-inquiry-restart').addEventListener('click', async () => { await reset(); panels[0].querySelector('h3').focus({preventScroll:true}); });
  motion.addEventListener('change', () => { if (motion.matches) root.getAnimations({subtree:true}).forEach(animation => animation.finish()); });
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    [root.querySelector('.intro-heading'),root.querySelector('.benefits'),root.querySelector('.person'),form].forEach((el,i) => animate(el,[{opacity:0,transform:'translateY(16px)'},{opacity:1,transform:'translateY(0)'}],{duration:650,delay:i*65,fill:'backwards'}));
  },{threshold:.1});
  observer.observe(root);
  window.openFormPopup = async function(product) {
    const behavior = motion.matches ? 'instant' : 'smooth';
    if (product && !['neonschild', 'led-neon'].includes(product)) {
      const contact = document.querySelector('#nt-footer-contact');
      contact.scrollIntoView({behavior, block:'center'});
      contact.focus({preventScroll:true});
      return;
    }
    while (busy) await wait(40);
    if (current !== 0) await goTo(0, false);
    root.scrollIntoView({behavior, block:'start'});
    panels[0].querySelector('h3').focus({preventScroll:true});
  };
  setProgress();
  updateSize();
})();
