#!/usr/bin/env node
// Rebuild with the esbuild version already pinned by package-lock.json (npm ci).
// CSS: python3 scripts/neontrip/build-configurator-css.py
// JS/cache URLs: node scripts/neontrip/build-configurator-runtime.cjs [--check]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
if (esbuild.version !== '0.28.1') throw new Error('Use locked esbuild 0.28.1');
if (process.argv.includes('--minify-css')) {
  process.stdout.write(esbuild.transformSync(fs.readFileSync(0, 'utf8'), {loader: 'css', minify: true, target: 'es2022'}).code);
  return;
}
// The complete verified Pages artifact also supports isolated rebuild/readback;
// origin/main alone does not contain every published configurator dependency.
const root = process.env.NEONTRIP_CONFIGURATOR_ROOT
  ? path.resolve(process.env.NEONTRIP_CONFIGURATOR_ROOT)
  : path.resolve(__dirname, '../../deploy/configurator');
const check = process.argv.includes('--check'), stale = [];
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
const sharedVersions = {};
let contentVersion = '';
const contentModule = /^\.\/content-experience\.js(?:\?|$)/;
const sharedStartupModules = /^(?:\.\/)?(?:tube-geometry|backing-contour|color-examples)\.js(?:\?|$)/;
function output(file, value) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === value) return;
  stale.push(path.relative(root, file));
  if (!check) fs.writeFileSync(file, value);
}
async function bundle(name, workerVersion = '') {
  const result = await esbuild.build({
    entryPoints: [path.join(root, name + '.js')], outfile: path.join(root, name + '.min.js'),
    tsconfig: path.resolve(__dirname, '../../tsconfig.json'),
    bundle: true, minify: true, format: 'esm', target: 'es2022', legalComments: 'eof', write: false,
    plugins: [{name: 'existing-local-module-urls', setup(build) {
      // Query strings version identical local source files. On-demand AR/share
      // modules retain their public URLs and load through their existing paths.
      // content-experience also has its own page script. Keep that one module
      // instance so its galleries, calendar state and listeners initialize once.
      // These shared preview modules stay independently cacheable and discoverable
      // in the head instead of extending the large entry download.
      build.onResolve({filter: /^\.\.?\//}, args => args.kind === 'dynamic-import' || contentModule.test(args.path) || (name === 'configurator' && sharedStartupModules.test(args.path))
        ? {path: name === 'configurator' && sharedStartupModules.test(args.path)
            ? args.path.replace(/\.js(?:\?.*)?$/, '.min.js?v=' + sharedVersions[path.basename(args.path.split('?')[0], '.js')])
            : contentModule.test(args.path) ? './content-experience.min.js?v=' + contentVersion : args.path, external: true}
        : {path: path.resolve(args.resolveDir, args.path.split('?')[0])});
      if (workerVersion) build.onLoad({filter: /\/configurator\.js$/}, args => ({
        contents: fs.readFileSync(args.path, 'utf8').replaceAll('./font-worker.min.js', './font-worker.min.js?v=' + workerVersion), loader: 'js'
      }));
    }}]
  });
  const code = result.outputFiles[0].text;
  output(path.join(root, name + '.min.js'), code);
  return hash(code);
}
(async () => {
  // Keep the early parallel downloads, but ship minified helpers and inline
  // their local dependencies once. The full source modules stay available.
  for (const name of ['tube-geometry', 'backing-contour', 'color-examples']) sharedVersions[name] = await bundle(name);
  const workerVersion = await bundle('font-worker');
  // Keep the page script and editor import on one module instance, with its
  // existing calendar/pricing dependencies in one parallel download.
  contentVersion = await bundle('content-experience');
  const mainVersion = await bundle('configurator', workerVersion);
  const sharedUrls = [...fs.readFileSync(path.join(root, 'configurator.js'), 'utf8').matchAll(/^import .*?from ['"](.+?)['"]/gm)]
    .map(match => match[1]).filter(url => sharedStartupModules.test(url)).map(url => url.replace(/^\.\//, ''));
  const stylesheetVersions = Object.fromEntries(['startup-base', 'startup-theme', 'startup-studio']
    .map(name => [name, hash(fs.readFileSync(path.join(root, name + '.css')))]));
  for (const file of fs.readdirSync(root).filter(file => file === 'index.html' || /^neon-.*\.html$/.test(file))) {
    const target = path.join(root, file);
    let html = fs.readFileSync(target, 'utf8');
    for (const url of sharedUrls) {
      const name = path.basename(url.split('?')[0], '.js');
      const hint = new RegExp('<link rel="modulepreload" href="' + name + '(?:\\.min)?\\.js\\?v=[^"]+"[^>]*>');
      if (!hint.test(html)) throw new Error('Missing shared module preload: ' + file + ' / ' + url);
      html = html.replace(hint, '<link rel="modulepreload" href="' + name + '.min.js?v=' + sharedVersions[name] + '" fetchpriority="low">');
    }
    html = html.replace(/\s*<link rel="modulepreload" href="deterministic-raster\.js"[^>]*>/, '');
    // This small shared dependency is needed before the editor can evaluate.
    // Discover it alongside the entry, keeping the visible font/image priority.
    const contentHint = '<link rel="modulepreload" href="content-experience.min.js?v=' + contentVersion + '" fetchpriority="low">';
    const existingContentHint = /<link rel="modulepreload" href="content-experience(?:\.min)?\.js\?v=[^"]+"[^>]*>/;
    html = existingContentHint.test(html) ? html.replace(existingContentHint, contentHint)
      : html.replace(/(<link rel="modulepreload" href="configurator(?:\.min)?\.js\?v=[^"]+"[^>]*>)/, contentHint + '\n$1');
    html = html.replace(/content-experience(?:\.min)?\.js\?v=[\w-]+/g, 'content-experience.min.js?v=' + contentVersion)
      .replace(/configurator(?:\.min)?\.js\?v=[\w-]+/g, 'configurator.min.js?v=' + mainVersion)
      .replace(/font-worker\.min\.js\?v=[\w-]+/g, 'font-worker.min.js?v=' + workerVersion)
      .replace(/(startup-(?:base|theme|studio))\.css\?v=[\w-]+/g, (_, name) => name + '.css?v=' + stylesheetVersions[name]);
    if (!html.includes(contentHint) || !html.includes('configurator.min.js?v=' + mainVersion) || !html.includes('font-worker.min.js?v=' + workerVersion)) throw new Error('Missing startup reference: ' + file);
    output(target, html);
  }
  if (check && stale.length) throw new Error('Rebuild configurator runtime: ' + stale.join(', '));
  console.log('Configurator runtime ' + (check ? 'verified' : 'built') + ': main ' + mainVersion + ', worker ' + workerVersion);
})().catch(error => {console.error(error); process.exitCode = 1;});
