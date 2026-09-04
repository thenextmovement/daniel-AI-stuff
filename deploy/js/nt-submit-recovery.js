(function () {
  if (window.ntSubmitStandaloneForm) return;

  function isFile(value) {
    return value && typeof value === 'object' && typeof value.arrayBuffer === 'function' && value.name;
  }

  function ensureSubmitId(formData) {
    var existing = String(
      formData.get('custom_6703e7e2e253b1_87194328') ||
      formData.get('request_id') ||
      formData.get('nt_client_submit_id') ||
      ''
    ).trim();
    var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    var submitId = uuidPattern.test(existing)
      ? existing
      : (window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = Math.random() * 16 | 0;
          var v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        }));
    formData.set('custom_6703e7e2e253b1_87194328', submitId);
    formData.set('request_id', submitId);
    formData.set('nt_client_submit_id', submitId);
    return submitId;
  }

  function hasFiles(formData) {
    for (var entry of formData.entries()) if (isFile(entry[1])) return true;
    return false;
  }

  function needsWebKitFileRebuild() {
    var ua = navigator.userAgent || '';
    return ua.indexOf('AppleWebKit/') !== -1 && ua.indexOf('Mobile/') !== -1 && ua.indexOf('Safari/') !== -1 && /Version\/26\.(?:5(?:\.\d+)?|6(?:\.\d+)?)/.test(ua);
  }

  async function prepareFormData(formData) {
    if (!needsWebKitFileRebuild() || !hasFiles(formData)) return formData;
    var rebuilt = new FormData();
    for (var entry of formData.entries()) {
      var name = entry[0];
      var value = entry[1];
      if (isFile(value)) {
        var bytes = await value.arrayBuffer();
        rebuilt.append(name, new Blob([bytes], { type: value.type || 'application/octet-stream' }), value.name);
      } else {
        rebuilt.append(name, value);
      }
    }
    rebuilt.set('nt_webkit_file_rebuilt', '1');
    return rebuilt;
  }

  function buildRecovery(formData, submitId, edgeRequestId) {
    var recovery = new FormData();
    var manifest = [];
    for (var entry of formData.entries()) {
      var name = entry[0];
      var value = entry[1];
      if (value && typeof value === 'object' && typeof value.arrayBuffer === 'function') {
        if (value.name) manifest.push({ name: value.name, size: value.size || 0, type: value.type || '' });
        continue;
      }
      if (name !== 'website' && name !== 'nt_recovery_contact') recovery.append(name, value);
    }
    recovery.set('custom_6703e7e2e253b1_87194328', submitId);
    recovery.set('request_id', submitId);
    recovery.set('nt_client_submit_id', submitId);
    recovery.set('nt_recovery_contact', '1');
    recovery.set('nt_upload_error', 'invalid_body');
    recovery.set('nt_original_edge_request_id', edgeRequestId || '');
    recovery.set('nt_file_manifest', JSON.stringify(manifest).slice(0, 4000));
    return recovery;
  }

  window.ntCheckSubmitResponse = function (response) {
    if (!response) return Promise.reject(new Error('HTTP no-response'));
    return response.text().then(function (text) {
      var data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
      if (!response.ok) {
        var err = new Error('HTTP ' + response.status + (data.error ? ' | ' + data.error : ''));
        err.status = response.status;
        err.code = data.error || 'http_error';
        err.requestId = data.request_id || response.headers.get('X-Request-Id') || null;
        err.clientSubmitId = data.client_submit_id || null;
        throw err;
      }
      data.http_status = response.status;
      data.edge_request_id = data.request_id || response.headers.get('X-Request-Id') || null;
      return data;
    });
  };

  window.ntRequirePersistedReceipt = function (data, submitId) {
    var leadRequestId = String(data && data.lead_request_id || '').trim();
    var confirmed = Boolean(
      data &&
      data.ok === true &&
      data.accepted === true &&
      data.persisted === true &&
      data.contact_saved === true &&
      data.request_row_id &&
      data.customer_id &&
      leadRequestId === submitId
    );
    if (confirmed) return data;
    var err = new Error('HTTP 502 | persistence_unconfirmed');
    err.status = 502;
    err.code = 'persistence_unconfirmed';
    err.requestId = data && data.edge_request_id;
    err.clientSubmitId = submitId;
    throw err;
  };

  window.ntReportSubmitFailure = function (formName, error) {
    try { console.error('[NT][form-fail]', formName, error); } catch (_) {}
    try {
      var payload = JSON.stringify({
        form: formName,
        error: (error && (error.message || String(error))) || 'unknown',
        status: error && error.status ? error.status : null,
        error_code: error && error.code ? error.code : null,
        request_id: error && error.requestId ? error.requestId : null,
        client_submit_id: error && error.clientSubmitId ? error.clientSubmitId : null,
        recovery_attempted: Boolean(error && error.recoveryAttempted),
        url: location.href,
        referrer: document.referrer || '',
        ua: navigator.userAgent,
        ts: new Date().toISOString()
      });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/r', new Blob([payload], { type: 'application/json' }));
      else fetch('/api/r', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function () {});
    } catch (_) {}
  };

  window.ntShowFailureBanner = function (container) {
    if (!container || container.dataset.ntFailShown === '1') return;
    container.dataset.ntFailShown = '1';
    container.innerHTML = '<div role="alert" style="text-align:center;padding:32px 16px;font-family:Inter,-apple-system,sans-serif"><div style="width:56px;height:56px;border-radius:50%;background:#fef2f2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><h3 style="font-size:20px;font-weight:600;color:#0a0a0a;margin:0 0 4px">Übermittlung fehlgeschlagen</h3><p style="font-size:14px;color:rgba(10,10,10,.55);margin:0 auto 20px;max-width:340px;line-height:1.5">Bitte kontaktieren Sie uns direkt. Wir melden uns sofort mit Ihrem Angebot.</p><a href="tel:+4921154257240" style="display:inline-flex;padding:12px 20px;background:#fa31a2;color:#fff;border-radius:999px;font-weight:600;text-decoration:none">+49 211 54257240</a><br><a href="mailto:support@neontrip.de" style="display:inline-block;margin-top:12px;color:#555">support@neontrip.de</a></div>';
  };

  window.ntShowContactRecoveryBanner = function (container) {
    if (!container) return;
    var english = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
    var title = english ? 'Contact details saved' : 'Kontaktdaten gespeichert';
    var text = english
      ? 'The file transfer failed, but your request and contact details reached us. We will contact you to arrange the file transfer.'
      : 'Die Dateiübertragung ist fehlgeschlagen. Ihre Anfrage und Kontaktdaten sind bei uns angekommen – wir melden uns und klären den Dateiversand mit Ihnen.';
    var mail = english ? 'Send file by email' : 'Datei per E-Mail senden';
    container.innerHTML = '<div role="status" style="text-align:center;padding:32px 16px;font-family:Inter,-apple-system,sans-serif"><div style="width:56px;height:56px;border-radius:50%;background:#fffbeb;display:flex;align-items:center;justify-content:center;margin:0 auto 16px"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M20 6L9 17l-5-5"/><path d="M12 22a10 10 0 1 0-10-10"/></svg></div><h3 style="font-size:20px;font-weight:600;color:#0a0a0a;margin:0 0 4px">' + title + '</h3><p style="font-size:14px;color:rgba(10,10,10,.55);margin:0 auto 20px;max-width:380px;line-height:1.5">' + text + '</p><a href="mailto:support@neontrip.de" style="display:inline-flex;padding:12px 20px;background:#fa31a2;color:#fff;border-radius:999px;font-weight:600;text-decoration:none">' + mail + '</a></div>';
  };

  window.ntFireConversionOnce = function (submitId, callback) {
    window.__ntConvertedSubmitIds = window.__ntConvertedSubmitIds || {};
    if (!submitId || window.__ntConvertedSubmitIds[submitId]) return;
    window.__ntConvertedSubmitIds[submitId] = true;
    callback();
  };

  window.ntSubmitStandaloneForm = function (formData, formName) {
    var submitId = ensureSubmitId(formData);
    var headers = { Accept: 'application/json', 'X-Client-Submit-Id': submitId };
    function send(body) {
      return fetch('/api/c', { method: 'POST', body: body, headers: headers, credentials: 'same-origin' })
        .then(window.ntCheckSubmitResponse)
        .then(function (result) { return window.ntRequirePersistedReceipt(result, submitId); });
    }
    return prepareFormData(formData).then(send).catch(function (err) {
      if (!(err && err.status === 400 && err.code === 'invalid_body' && hasFiles(formData))) throw err;
      return send(buildRecovery(formData, submitId, err.requestId)).then(function (result) {
        if (!result || result.contact_saved !== true || result.recovery !== true) {
          var unconfirmed = new Error('HTTP 502 | contact_recovery_unconfirmed');
          unconfirmed.status = 502;
          unconfirmed.code = 'contact_recovery_unconfirmed';
          unconfirmed.requestId = result && result.edge_request_id;
          unconfirmed.clientSubmitId = submitId;
          unconfirmed.recoveryAttempted = true;
          throw unconfirmed;
        }
        result.submit_id = submitId;
        return result;
      }).catch(function (recoveryError) {
        recoveryError.recoveryAttempted = true;
        throw recoveryError;
      });
    }).then(function (result) {
      result = result || {};
      result.submit_id = submitId;
      return result;
    }).catch(function (error) {
      var message = (error && error.message) || String(error || 'unknown');
      if (!(error instanceof Error)) error = new Error(message);
      error.message = message + ' | form=' + formName + ' | submit_id=' + submitId + ' | attempts=1';
      error.clientSubmitId = error.clientSubmitId || submitId;
      throw error;
    });
  };
})();
