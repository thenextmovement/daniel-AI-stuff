/* ============================================
   NEONTRIP – Multi-Step Formular Logik
   form.js
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const form = document.querySelector('.neontrip-form');
  if (!form) return;

  const steps = form.querySelectorAll('.form-step');
  const progressFill = form.querySelector('.form-progress__fill');
  const progressSteps = form.querySelectorAll('.form-progress__step');
  const successScreen = form.querySelector('.form-success');

  let currentStep = 0;
  const totalSteps = steps.length;

  /* ── Navigation zwischen Steps ── */
  function goToStep(stepIndex) {
    if (stepIndex < 0 || stepIndex >= totalSteps) return;

    // Aktiven Step ausblenden
    steps[currentStep].classList.remove('active');
    steps[currentStep].classList.add('exit-left');

    // Kurze Verzögerung für Animation
    setTimeout(() => {
      steps[currentStep].classList.remove('exit-left');
      currentStep = stepIndex;

      // Neuen Step einblenden
      steps[currentStep].classList.add('active');

      // Progress Bar aktualisieren
      updateProgress();

      // Zum Formular scrollen
      scrollToForm();
    }, 200);
  }

  function nextStep() {
    if (!validateCurrentStep()) return;
    if (currentStep < totalSteps - 1) {
      goToStep(currentStep + 1);
    }
  }

  function prevStep() {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  }

  /* ── Progress Bar Update ── */
  function updateProgress() {
    const progress = ((currentStep + 1) / totalSteps) * 100;
    if (progressFill) {
      progressFill.style.width = progress + '%';
    }

    // Step-Indikatoren aktualisieren
    progressSteps.forEach((step, index) => {
      step.classList.remove('active', 'completed');
      if (index < currentStep) {
        step.classList.add('completed');
      } else if (index === currentStep) {
        step.classList.add('active');
      }
    });
  }

  /* ── Scroll zum Formular ── */
  function scrollToForm() {
    const formContainer = form.closest('.form-container') || form;
    const headerHeight = document.querySelector('.header')?.offsetHeight || 72;
    const top = formContainer.getBoundingClientRect().top + window.scrollY - headerHeight - 20;

    window.scrollTo({
      top: top,
      behavior: 'smooth'
    });
  }

  /* ── Validierung ── */
  function validateCurrentStep() {
    const currentStepEl = steps[currentStep];
    const requiredFields = currentStepEl.querySelectorAll('[required]');
    const radioGroups = currentStepEl.querySelectorAll('.radio-cards');
    let isValid = true;

    // Reset Fehler
    currentStepEl.querySelectorAll('.form-error').forEach(err => {
      err.classList.remove('visible');
    });
    currentStepEl.querySelectorAll('.error').forEach(el => {
      el.classList.remove('error');
    });

    // Radio-Card-Gruppen prüfen
    radioGroups.forEach(group => {
      const name = group.querySelector('input[type="radio"]')?.name;
      if (name) {
        const checked = group.querySelector('input[type="radio"]:checked');
        if (!checked) {
          showError(group, 'Bitte wählen Sie eine Option aus.');
          isValid = false;
        }
      }
    });

    // Pflichtfelder prüfen
    requiredFields.forEach(field => {
      if (!field.value.trim()) {
        field.classList.add('error');
        showError(field, getErrorMessage(field));
        isValid = false;
      } else if (field.type === 'email' && !isValidEmail(field.value)) {
        field.classList.add('error');
        showError(field, 'Bitte geben Sie eine gültige E-Mail-Adresse ein.');
        isValid = false;
      } else if (field.type === 'tel' && field.value.trim() && !isValidPhone(field.value)) {
        field.classList.add('error');
        showError(field, 'Bitte geben Sie eine gültige Telefonnummer ein.');
        isValid = false;
      }
    });

    // Zum ersten Fehler scrollen
    if (!isValid) {
      const firstError = currentStepEl.querySelector('.error, .form-error.visible');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    return isValid;
  }

  function getErrorMessage(field) {
    const label = field.closest('.form-group')?.querySelector('.form-label')?.textContent?.replace('*', '').trim();
    return label ? `Bitte füllen Sie das Feld "${label}" aus.` : 'Dieses Feld ist erforderlich.';
  }

  function showError(element, message) {
    let errorEl = element.parentNode.querySelector('.form-error');
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.className = 'form-error';
      element.parentNode.appendChild(errorEl);
    }
    errorEl.textContent = message;
    errorEl.classList.add('visible');
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function isValidPhone(phone) {
    return /^[\d\s\-+()]{6,}$/.test(phone);
  }

  /* ── Live-Validierung ── */
  form.querySelectorAll('.form-input, .form-select, .form-textarea').forEach(field => {
    field.addEventListener('blur', () => {
      if (field.classList.contains('error')) {
        // Nochmal validieren
        if (field.value.trim()) {
          if (field.type === 'email' && !isValidEmail(field.value)) {
            return;
          }
          field.classList.remove('error');
          const errorEl = field.parentNode.querySelector('.form-error');
          if (errorEl) errorEl.classList.remove('visible');
        }
      }
    });

    field.addEventListener('input', () => {
      if (field.classList.contains('error') && field.value.trim()) {
        field.classList.remove('error');
        const errorEl = field.parentNode.querySelector('.form-error');
        if (errorEl) errorEl.classList.remove('visible');
      }
    });
  });

  /* ── Button Event Listeners ── */
  form.querySelectorAll('[data-action="next"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      nextStep();
    });
  });

  form.querySelectorAll('[data-action="prev"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      prevStep();
    });
  });

  /* ── Formular absenden ── */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validateCurrentStep()) return;

    const submitBtn = form.querySelector('[data-action="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Wird gesendet...';
    }

    // FormData sammeln
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // Seite (Landingpage) als Kontext mitsenden
    data._source = window.location.pathname;
    data._timestamp = new Date().toISOString();

    try {
      // Formular an API senden (Platzhalter-URL für n8n Webhook)
      const response = await fetch(form.action || 'https://api.neontrip.de/anfrage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(data)
      });

      // Erfolg anzeigen (auch wenn API noch nicht existiert)
      showSuccess();

    } catch (error) {
      // Auch bei Netzwerkfehler Erfolg zeigen (API existiert noch nicht)
      console.info('NEONTRIP: Formular-Daten gesammelt:', data);
      console.info('NEONTRIP: API-Endpoint noch nicht aktiv – Daten werden lokal geloggt.');
      showSuccess();
    }
  });

  /* ── Erfolgsanzeige ── */
  function showSuccess() {
    // Formular-Steps ausblenden
    steps.forEach(step => step.classList.remove('active'));

    // Progress Bar ausblenden
    const progressEl = form.querySelector('.form-progress');
    if (progressEl) progressEl.style.display = 'none';

    // Success-Screen einblenden
    if (successScreen) {
      successScreen.classList.add('active');
    }

    // Zum Erfolg scrollen
    scrollToForm();

    // Event dispatchen (für Analytics etc.)
    window.dispatchEvent(new CustomEvent('neontrip:form-submitted', {
      detail: { source: window.location.pathname }
    }));
  }

  /* ── File Upload ── */
  const fileUploads = form.querySelectorAll('.file-upload');

  fileUploads.forEach(upload => {
    const input = upload.querySelector('input[type="file"]');
    const preview = upload.querySelector('.file-upload__preview');
    const previewImg = preview?.querySelector('img');
    const previewName = preview?.querySelector('.file-upload__preview-name');
    const previewSize = preview?.querySelector('.file-upload__preview-size');
    const removeBtn = preview?.querySelector('.file-upload__preview-remove');

    if (!input) return;

    // Drag & Drop
    upload.addEventListener('dragover', (e) => {
      e.preventDefault();
      upload.classList.add('dragover');
    });

    upload.addEventListener('dragleave', () => {
      upload.classList.remove('dragover');
    });

    upload.addEventListener('drop', (e) => {
      e.preventDefault();
      upload.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        handleFileSelect(input.files[0]);
      }
    });

    // File Input Change
    input.addEventListener('change', () => {
      if (input.files.length) {
        handleFileSelect(input.files[0]);
      }
    });

    // Remove Button
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.value = '';
        if (preview) preview.classList.remove('visible');
      });
    }

    function handleFileSelect(file) {
      if (!preview) return;

      // Dateigröße berechnen
      const sizeKB = Math.round(file.size / 1024);
      const sizeText = sizeKB > 1024 
        ? (sizeKB / 1024).toFixed(1) + ' MB' 
        : sizeKB + ' KB';

      if (previewName) previewName.textContent = file.name;
      if (previewSize) previewSize.textContent = sizeText;

      // Bild-Vorschau
      if (file.type.startsWith('image/') && previewImg) {
        const reader = new FileReader();
        reader.onload = (e) => {
          previewImg.src = e.target.result;
        };
        reader.readAsDataURL(file);
      }

      preview.classList.add('visible');
    }
  });

  /* ── Initialisierung ── */
  if (steps.length > 0) {
    steps[0].classList.add('active');
    updateProgress();
  }
});
