import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const generatedPages = [
  ['deploy/index.html', 'de'],
  ['deploy/en/index.html', 'en'],
  ['deploy/firmenlogo-beleuchtet/index.html', 'de'],
  ['deploy/firmenschilder/index.html', 'de'],
  ['deploy/led-schriftzuege/index.html', 'de'],
  ['deploy/leuchtbuchstaben/index.html', 'de'],
  ['deploy/leuchtkaesten/index.html', 'de'],
  ['deploy/leuchtreklame/index.html', 'de'],
  ['deploy/logo/index.html', 'de'],
  ['deploy/messe-event/index.html', 'de'],
  ['deploy/neon-schild-personalisieren/index.html', 'de'],
  ['deploy/neon-schilder/index.html', 'de'],
];

const standalonePages = [
  ['deploy/anfrage.html', 'de', 'https://anfrage.neontrip.de/anfrage'],
  ['deploy/en/anfrage.html', 'en', 'https://anfrage.neontrip.de/en/anfrage'],
];

const b2bCampaignPages = [
  ['deploy/neon-schilder/index.html', 'fixed'],
  ['deploy/firmenlogo-beleuchtet/index.html', 'feasibility'],
  ['deploy/leuchtbuchstaben/index.html', 'feasibility'],
];

const deLocationPages = generatedPages
  .filter(([, lang]) => lang === 'de')
  .map(([path]) => path);

async function load(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8');
}

function occurrences(value, search) {
  return value.split(search).length - 1;
}

function namedControls(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(html.matchAll(new RegExp(
    '<(?:input|select|textarea)\\b[^>]*\\bname=["\\\']' + escapedName + '["\\\'][^>]*>',
    'gi'
  )));
}

function assertOptionalNamedControls(html, path, name, expectedCount) {
  const controls = namedControls(html, name);
  assert.equal(controls.length, expectedCount, path + ' ' + name + ' control count');
  for (const match of controls) {
    assert.doesNotMatch(match[0], /\brequired\b/i, path + ' ' + name + ' remains optional');
  }
}

function assertTrackingContract(html, path, lang) {
  assert.doesNotMatch(html, /fuajob\.online\/webhook\/landing-anfrage/, path + ' has no direct upstream bypass');
  assert.equal(occurrences(html, 'https://bzrcdn.openai.com/sdk/oaiq.min.js'), 1, path + ' pixel loader');
  assert.equal(occurrences(html, '6GqgnrdSPjJSGdthY89B9Y'), 1, path + ' pixel id');
  const consentDenied = Math.max(html.indexOf("oaiq('consent', false)"), html.indexOf('oaiq("consent",false)'));
  const init = Math.max(html.indexOf("oaiq('init'"), html.indexOf('oaiq("init"'));
  assert.ok(consentDenied >= 0 && consentDenied < init, path + ' denies consent before init');
  assert.match(html, /CookiebotOnConsentReady/);
  assert.match(html, /CookiebotOnAccept/);
  assert.match(html, /CookiebotOnDecline/);
  assert.match(html, /lead_created/);
  assert.match(html, /event_id/);
  assert.match(html, /nt-business-email\.js\?v=78b9b0ce/);
  assert.match(html, /oppref/);
  assert.match(html, /campaign_id/);
  assert.match(html, /ad_group_id/);
  assert.match(html, /ad_id/);
  assert.match(html, /ad_account_id/);
  assert.match(html, /openai_ad_group_id/);
  if (lang === 'en') assert.match(html, /Business email/);
  else assert.match(html, /Geschäftliche E-Mail/);
  assert.doesNotMatch(
    html,
    /Nur Firmen-E-Mail-Adressen|Business email addresses only/,
    path + ' has no static business-email helper'
  );

  const fileInputs = Array.from(html.matchAll(/<input\b[^>]*\btype=["']file["'][^>]*>/gi));
  assert.ok(fileInputs.length > 0, path + ' file input exists');
  for (const match of fileInputs) {
    assert.doesNotMatch(match[0], /\brequired\b/i, path + ' upload remains optional');
  }

  const companyInputs = Array.from(html.matchAll(/<input\b[^>]*(?:name=["']firma["']|id=["']company["'])[^>]*>/gi));
  assert.ok(companyInputs.length > 0, path + ' company input exists');
  for (const match of companyInputs) {
    assert.doesNotMatch(match[0], /\brequired\b/i, path + ' company remains optional');
  }
}

test('all generated landing pages carry the same consent, attribution and B2B form contract', async () => {
  for (const [path, lang] of generatedPages) {
    const html = await load(path);
    assertTrackingContract(html, path, lang);
    assert.match(html, /action="\/api\/c"/, path + ' posts through the guarded edge endpoint');
  }
});

test('standalone quote wizards carry the same contract and canonical URL', async () => {
  for (const [path, lang, canonical] of standalonePages) {
    const html = await load(path);
    assertTrackingContract(html, path, lang);
    assert.match(html, new RegExp('<link rel="canonical" href="' + canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'));
    assert.match(html, /ntAppendWizardTracking/);
    assert.match(html, /validateInput\(businessEmailInput/);
    assert.match(
      html,
      /emailField\.addEventListener\('blur',[\s\S]*?ntBusinessEmail\.validateInput\(emailField\)/,
      path + ' blur uses the central business-email validator'
    );
    if (lang === 'de') {
      assert.match(html, /Kostenlose 3D-Vorschau innerhalb von 24h/);
      assert.doesNotMatch(html, /Angebot(?: \+ 3D Vorschau)? in 24h|Vorschau-Bild \+ Angebot in 24h/);
    } else {
      assert.match(html, /Free 3D preview within 24h/i);
      assert.doesNotMatch(html, /Preview Image \+ Quote within 24h|response within 24h/i);
    }
  }
});

test('all German generated landing pages send the n8n-compatible location field', async () => {
  for (const path of deLocationPages) {
    const html = await load(path);
    const ortControls = namedControls(html, 'ort');
    assert.ok([4, 6].includes(ortControls.length), path + ' has an inside/outside pair in every form');
    assert.equal(namedControls(html, 'einsatzort').length, 0, path + ' has no ignored legacy location field');
    assert.equal(occurrences(html, 'value="innen"'), ortControls.length / 2, path + ' has normalized indoor values');
    assert.equal(occurrences(html, 'value="aussen"'), ortControls.length / 2, path + ' has normalized outdoor values');
  }
});

test('three B2B campaign routes expose optional qualification fields and approved claims', async () => {
  for (const [path, expressContract] of b2bCampaignPages) {
    const html = await load(path);

    assertOptionalNamedControls(html, path, 'project_context', 3);
    assertOptionalNamedControls(html, path, 'quantity_band', 3);
    assertOptionalNamedControls(html, path, 'desired_deadline', 3);

    const fileInputs = Array.from(html.matchAll(/<input\b[^>]*\btype=["']file["'][^>]*>/gi));
    assert.ok(fileInputs.length > 0, path + ' upload exists');
    for (const match of fileInputs) {
      assert.doesNotMatch(match[0], /\brequired\b/i, path + ' upload remains optional');
    }
    assertOptionalNamedControls(html, path, 'firma', 3);

    assert.match(html, /9\.238\+ realisierte Projekte/, path + ' uses approved project count');
    assert.doesNotMatch(html, /8\.247/, path + ' has no stale project count');
    assert.match(html, /4,9\/5 bei 236 Bewertungen/, path + ' uses approved review summary');
    assert.match(html, /Kostenlose 3D-Vorschau in 24h/, path + ' uses approved preview timing');
    assert.match(html, /Anfrage in 60 Sekunden/, path + ' states form completion time precisely');
    assert.doesNotMatch(html, /Anfrage in 1 Minute/, path + ' has no conflicting form timing');
    assert.doesNotMatch(html, /Angebot in Minuten/, path + ' has no unsupported offer timing');
    assert.doesNotMatch(html, /Innerhalb von 24h mit Angebot \+ 3D-Vorschau/, path + ' does not promise the offer within 24h');
    assert.doesNotMatch(html, /3D-Vorschau in 24h<\/h3><p[^>]*>Kostenlos mit Festpreisangebot/, path + ' separates preview timing from offer timing');
    assert.match(html, /scrollIntoView/, path + ' keeps campaign CTAs on the product-specific local form');
    assert.doesNotMatch(html, /\/anfrage\?produkt=/, path + ' does not route campaign CTAs to the generic wizard');

    if (expressContract === 'fixed') {
      assert.match(html, /Express ab 3 Werktagen/, path + ' uses the approved Neon express claim');
      assert.doesNotMatch(html, /Express ab 14 Tagen/, path + ' has no stale express claim');
    } else {
      assert.match(
        html,
        /Express nach Machbarkeitsprüfung/,
        path + ' makes express delivery conditional on feasibility'
      );
      assert.doesNotMatch(html, /Express ab (?:3 Werktagen|14 Tagen)/, path + ' has no fixed express promise');
    }
  }
});

test('campaign product routes preselect the matching product and old profile-letter route redirects', async () => {
  const expected = new Map([
    ['deploy/_source/configs/logo.json', ['LED Logo Wandschild', 'neonschild']],
    ['deploy/_source/configs/firmenlogo-beleuchtet.json', ['LED Logo Wandschild', 'neonschild']],
    ['deploy/_source/configs/led-schriftzuege.json', ['LED Schriftzug', 'neonschild']],
    ['deploy/_source/configs/leuchtbuchstaben.json', ['3D Buchstaben (Front)', 'front-buchstaben']],
    ['deploy/_source/configs/firmenschilder.json', ['Vollflächig beleuchtet', 'sonderanfertigung']],
    ['deploy/_source/configs/leuchtreklame.json', ['Leuchtkasten', 'leuchtkasten']],
  ]);
  for (const [path, [product, sticky]] of expected) {
    const config = JSON.parse(await load(path));
    assert.equal(config.default_product, product, path);
    assert.equal(config.sticky_produkt, sticky, path);
  }

  const redirects = await load('deploy/_redirects');
  assert.match(redirects, /^\/profilbuchstaben\s+\/leuchtbuchstaben\/\s+301$/m);
  assert.match(redirects, /^\/profilbuchstaben\/\*\s+\/leuchtbuchstaben\/\s+301$/m);
  assert.match(redirects, /^\/neon-schilder-v2\s+\/neon-schilder\/\s+301$/m);
  assert.match(redirects, /^\/neon-schilder-v2\/\*\s+\/neon-schilder\/\s+301$/m);
});

test('shared attribution keeps all Ads IDs and internal handoffs', async () => {
  const common = await load('deploy/assets/js/lp-common.js');
  assert.match(common, /oppref/);
  assert.match(common, /campaign_id/);
  assert.match(common, /ad_group_id/);
  assert.match(common, /ad_id/);
  assert.match(common, /ad_account_id/);
  assert.match(common, /openai_ad_group_id/);
  assert.match(common, /landing_page_url/);
  assert.match(common, /current_page_url/);
  assert.match(common, /nt_handoff/);
});

test('generated forms retain direct URL attribution when storage is unavailable', async () => {
  const source = await load('deploy/_source/layouts/base.html');
  assert.match(source, /addHidden\(form, key, getTrackingValue\(key\)\)/);
  assert.match(source, /addHidden\(form, 'current_page_url', window\.location\.href\)/);
  assert.match(source, /target\.searchParams\.set\('nt_handoff', '1'\)/);
});

test('all inline JavaScript on active landing pages parses successfully', async () => {
  const pages = [...generatedPages.map(([path]) => path), ...standalonePages.map(([path]) => path)];
  for (const path of pages) {
    const html = await load(path);
    let scriptNumber = 0;
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      scriptNumber += 1;
      const attributes = match[1];
      const source = match[2];
      if (/\bsrc\s*=/i.test(attributes) || /type=["'](?:application\/ld\+json|text\/plain)["']/i.test(attributes)) continue;
      assert.doesNotThrow(
        () => new vm.Script(source, { filename: path + '#script-' + scriptNumber }),
        path + ' inline script ' + scriptNumber
      );
    }
  }
});

test('unknown routes use an explicit noindex 404 instead of the tracked landing page', async () => {
  const html = await load('deploy/404.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(html, /6GqgnrdSPjJSGdthY89B9Y|gtag\s*\(/);
});
