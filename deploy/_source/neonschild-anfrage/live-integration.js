/* New landing page; transport/receipt/consent helpers are extracted unchanged from the active LP template. */
(() => {
  const pending = new WeakMap();
  const accepted = new WeakMap();
  const value = (data, key) => String(data.get(key) || '').trim();
  function status(form, message, error = false) {
    let node = form.querySelector('[data-live-status]');
    if (!node) {
      node = document.createElement('p');
      node.dataset.liveStatus = '';
      node.tabIndex = -1;
      node.style.cssText = 'font:inherit;font-size:14px;line-height:1.5;margin:12px 0;overflow-wrap:anywhere';
      (form.querySelector('.form-footer') || form).prepend(node);
    }
    node.hidden = !message;
    node.setAttribute('role', error ? 'alert' : 'status');
    node.style.color = error ? '#a21e44' : '#555';
    node.textContent = message;
    if (error) {
      const link = document.createElement('a');
      link.href = 'mailto:support@neontrip.de';link.textContent = ' Per E-Mail anfragen';
      link.style.textDecoration = 'underline';node.append(link);
      node.focus({preventScroll:true});node.scrollIntoView({block:'nearest'});
    }
  }
  function dataFor(form) {
    const data = new FormData(form);
    const wizard = form.id === 'nt-inquiry-form';
    const files = [...form.querySelector('[type=file]').files];
    for (const key of ['files','dateien','datei']) data.delete(key);
    files.forEach(file => data.append('datei',file,file.name));
    data.set('name',wizard ? [value(data,'firstName'),value(data,'lastName')].join(' ') : [value(data,'vorname'),value(data,'nachname')].join(' '));
    data.set('firma',value(data,wizard?'company':'unternehmen'));
    data.set('telefon',value(data,wizard?'phone':'telefon'));
    if (wizard) {
      data.set('produkt','neon');data.set('ort',value(data,'location'));
      data.set('groesse',value(data,'sizeCm')+' cm breit');
      data.set('nachricht',value(data,'idea'));
    }
    data.set('source',wizard ? 'neonschild-anfrage-multistep' : 'neonschild-anfrage-kontakt');
    data.set('current_page_url',location.href);
    const id = form.dataset.submitId || crypto.randomUUID();
    form.dataset.submitId = id;
    data.set('nt_client_submit_id',id);
    return data;
  }
  window.ntLandingSubmit = form => {
    if (accepted.has(form)) return Promise.resolve(accepted.get(form));
    if (pending.has(form)) return pending.get(form);
    const data = dataFor(form);
    const email = form.querySelector('[type=email]');
    const inspection = window.ntBusinessEmail.inspect(email.value);
    if (!inspection.valid) {
      status(form,'Bitte verwenden Sie Ihre Unternehmens-E-Mail-Adresse. Keine vorhanden?',true);
      email.focus();return Promise.reject(new Error('business_email_required'));
    }
    const tooLarge = [...form.querySelector('[type=file]').files].find(file=>file.size>20*1024*1024);
    if (tooLarge) {
      status(form,'Die Datei „'+tooLarge.name+'“ ist größer als 20 MB. Bitte verkleinern Sie die Datei oder senden Sie sie per E-Mail.',true);
      return Promise.reject(new Error('file_too_large'));
    }
    const buttons = [...form.querySelectorAll('button')];
    const disabledBefore = buttons.map(button=>button.disabled);
    buttons.forEach(button=>button.disabled=true);
    form.setAttribute('aria-busy','true');status(form,'Ihre Anfrage wird übertragen …');
    const task = window.ntSubmitForm(form,data,data.get('source')).then(result=>{
      accepted.set(form,result);
      window.ntFireConversionOnce(result.submit_id,()=>fireEnhancedConversion(data.get('source'),data.get('email'),data.get('telefon'),data.get('name'),result.submit_id));
      status(form,'');return result;
    }).catch(error=>{
      window.ntReportSubmitFailure(data.get('source'),error);
      status(form,'Die Übermittlung konnte nicht bestätigt werden. Ihre Angaben und Dateien bleiben erhalten. Bitte kontaktieren Sie uns unter 0211 54257240 oder per E-Mail.',true);
      throw error;
    }).finally(()=>{
      pending.delete(form);form.removeAttribute('aria-busy');
      buttons.forEach((button,i)=>button.disabled=disabledBefore[i]);
    });
    pending.set(form,task);return task;
  };
  document.addEventListener('input', event=>{
    const form=event.target.closest('form');
    if(form && accepted.has(form)) {
      accepted.delete(form);delete form.dataset.submitId;status(form,'');
      const confirmation=form.querySelector('.nt-contact-classic__status');
      if(confirmation) confirmation.hidden=true;
    }
  });
  document.addEventListener('reset',event=>{
    delete event.target.dataset.submitId;accepted.delete(event.target);status(event.target,'');
  },true);
  document.addEventListener('click',event=>{
    const link=event.target.closest('[data-cookie-settings]');
    if(link && window.Cookiebot?.renew){event.preventDefault();window.Cookiebot.renew();}
  });
})();
