// Refresh only the shared submit helpers and their handlers in the advertised old LPs.
// A full template rebuild would also replace independently released page content.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'deploy/_source/layouts/base.html'), 'utf8');
const build = fs.readFileSync(path.join(root, 'deploy/_source/build.js'), 'utf8');
const minify = vm.runInNewContext('(' + build.slice(build.indexOf('function minifyHtml('), build.indexOf('// ─── Build single LP')) + ')');
const start = 'window.ntReportSubmitFailure =';
const end = "const form = document.getElementById('multi-step-form');";
const helper = minify('<script>' + source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))) + '</script>').slice(8, -9);
for (const slug of ['index', 'logo', 'neon-schilder', 'leuchtbuchstaben', 'firmenlogo-beleuchtet', 'firmenschilder', 'leuchtreklame', 'neon-schild-personalisieren']) {
  const file = path.join(root, 'deploy', slug === 'index' ? 'index.html' : path.join(slug, 'index.html'));
  let html = fs.readFileSync(file, 'utf8');
  const from = html.indexOf(start), to = html.indexOf(end, from);
  if (from < 0 || to < from) throw new Error('Missing helper boundary: ' + slug);
  // This older route has not opted into CRO events; keep its existing measurement scope.
  const pageHelper = slug === 'neon-schild-personalisieren'
    ? helper.replace(/try \{ window\.ntCro\?\.(?:startForm\(form\)|lead\(form, result\)|error\('form', err, submitId\)); \} catch\(e\) \{\}/g, '')
    : helper;
  html = html.slice(0, from) + pageHelper + html.slice(to);
  html = html.replace(/if \((?:formData|fd)\.get\('website'\)\) (?:\{[^{}]*?return; \}|return;)/g, '');
  html = html.replace(/window\.ntShowFailureBanner\((form|quickAnfrageForm|heroFormD|kontaktForm|quickForm)\);/g, 'window.ntShowFailureBanner($1, err);');
  for (const [name, reset] of [
    ['hero_form_mobile', 'btn.innerHTML = orig; btn.disabled = false;'],
    ['hero_form_desktop', 'submitBtn.innerHTML = originalText; submitBtn.disabled = false;'],
    ['kontakt_form', 'submitBtn.innerHTML = originalText; submitBtn.disabled = false;'],
    ['quick_anfrage_form', 'submitBtn.innerHTML = originalText; submitBtn.disabled = false;'],
  ]) {
    const report = "window.ntReportSubmitFailure('" + name + "', err);";
    if (!html.includes(reset + report)) html = html.replace(report, reset + report);
  }
  for (const [begin, finish, formName] of [
    ["var nameVal = (form.querySelector(", "var btn = form.querySelector('button[type=\"submit\"]');", 'form'],
    ["const nameVal = (heroFormD.querySelector(", "const submitBtn = heroFormD.querySelector('button[type=\"submit\"]');", 'heroFormD'],
  ]) {
    const from = html.indexOf(begin);
    if (from < 0) {
      if (!html.includes('if (!window.ntRequireContactFields(' + formName + ')) return;')) throw new Error('Missing validation: ' + slug);
      continue;
    }
    const to = html.indexOf(finish, from);
    if (to < from || to - from > 1000) throw new Error('Unexpected validation boundary: ' + slug);
    html = html.slice(0, from) + 'if (!window.ntRequireContactFields(' + formName + ')) return;' + html.slice(to);
  }
  html = html.replaceAll('Jetzt online', 'Persönliche Beratung');
  fs.writeFileSync(file, html);
  console.log('Updated submit path: ' + slug);
}
