#!/usr/bin/env node
/**
 * NEONTRIP LP Build System
 * Assembles landing pages from sections + configs.
 *
 * Usage:
 *   node build.js              # Build all LPs
 *   node build.js neon-schilder # Build single LP
 *   node build.js --no-minify  # Skip minification
 */

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = __dirname;
const DEPLOY_DIR = path.resolve(SOURCE_DIR, '..');
const SECTIONS_DIR = path.join(SOURCE_DIR, 'sections');
const OVERRIDES_DIR = path.join(SECTIONS_DIR, 'overrides');
const LAYOUTS_DIR = path.join(SOURCE_DIR, 'layouts');
const CONFIGS_DIR = path.join(SOURCE_DIR, 'configs');

// Section filename map (section name → filename)
const SECTION_FILES = {
  'header':        '01-header.html',
  'hero':          '02-hero.html',
  'stats-bar':     '03-stats-bar.html',
  'process':       '03-process.html',
  'projekte':      '04-projekte.html',
  'events':        '05-events.html',
  'anfrage-quick': '06-anfrage-quick.html',
  'bewertungen':   '07-bewertungen.html',
  'testimonials':  '08-testimonials.html',
  'vorteile':      '09-vorteile.html',
  'anfrage':       '10-anfrage.html',
  'faq':           '11-faq.html',
  'kunden':        '12-kunden.html',
  'kontakt':       '13-kontakt.html',
  'footer':        '14-footer.html',
};

// ─── Parse CLI args ───
const args = process.argv.slice(2);
const noMinify = args.includes('--no-minify');
const specificSlug = args.find(a => !a.startsWith('--'));

// ─── Load configs ───
function loadConfigs() {
  const configs = [];
  const configFiles = fs.readdirSync(CONFIGS_DIR).filter(f => f.endsWith('.json'));
  for (const file of configFiles) {
    const config = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, file), 'utf8'));
    configs.push(config);
  }
  return configs;
}

// ─── Load section ───
function loadSection(sectionName, slug) {
  const filename = SECTION_FILES[sectionName];
  if (!filename) {
    console.warn(`⚠ Unknown section: ${sectionName}`);
    return `<!-- Unknown section: ${sectionName} -->`;
  }

  // Check for LP-specific override first
  const overridePath = path.join(OVERRIDES_DIR, slug, filename);
  if (fs.existsSync(overridePath)) {
    return fs.readFileSync(overridePath, 'utf8');
  }

  // Fall back to shared section
  const sharedPath = path.join(SECTIONS_DIR, filename);
  if (fs.existsSync(sharedPath)) {
    return fs.readFileSync(sharedPath, 'utf8');
  }

  console.warn(`⚠ Section file not found: ${filename}`);
  return `<!-- Missing section: ${sectionName} -->`;
}

// ─── Generate DKI script ───
function generateDkiScript(config) {
  if (!config.dki_rules || config.dki_rules.length === 0) return '';

  const rulesStr = config.dki_rules
    .map(([kw, replacement]) => {
      const escapedKw = kw.replace(/'/g, "\\'");
      const escapedReplacement = replacement.replace(/'/g, "\\'");
      return `      ['${escapedKw}', '${escapedReplacement}']`;
    })
    .join(',\n');

  const hasSuffix = !!(config.dki_suffix && String(config.dki_suffix).length > 0);
  const escapedSuffix = hasSuffix ? config.dki_suffix.replace(/'/g, "\\'") : '';

  return `<!-- Dynamic Text Replacement (Google Ads Keyword Mapping) -->
  <script>
  (function(){
    var kw = (new URLSearchParams(location.search).get('kw') || '').toLowerCase().trim();
    if (!kw) return;
    var h, rules = [
${rulesStr}
    ];
    for (var i = 0; i < rules.length; i++) {
      if (kw.indexOf(rules[i][0]) !== -1) { h = rules[i][1]; break; }
    }
    if (!h) return;
    var suffix = '${escapedSuffix}';
    document.addEventListener('DOMContentLoaded', function() {
      var el = document.querySelector('#hero h1');
      if (el) el.innerHTML = h + suffix;
      var plain = h.replace(/<[^>]*>/g, '');
      var ft = document.getElementById('hero-form-title-d');
      var ftm = document.getElementById('hero-form-title');
      if (ft) ft.textContent = plain + ' — in 60 Sek.';
      if (ftm) ftm.textContent = plain + ' — in 1 Min.';
    });
  })();
  </script>`;
}

// ─── Generate structured data ───
function generateStructuredData(config) {
  if (!config.structured_data || config.structured_data.length === 0) return '';

  return config.structured_data.map(block => {
    const json = typeof block === 'string' ? block : JSON.stringify(block, null, 4);
    return `  <script type="application/ld+json">\n  ${json}\n  </script>`;
  }).join('\n\n');
}

// ─── Replace template variables ───
function replaceVariables(html, config) {
  const vars = {
    '{{LANG}}': config.lang || 'de',
    '{{TITLE}}': config.title,
    '{{META_DESCRIPTION}}': config.meta_description,
    '{{CANONICAL}}': config.canonical,
    '{{OG_TITLE}}': config.og_title,
    '{{OG_DESCRIPTION}}': config.og_description,
    '{{HREFLANG_TAGS}}': config.hreflang_tags || '',
    '{{DKI_SCRIPT}}': generateDkiScript(config),
    '{{STRUCTURED_DATA}}': generateStructuredData(config),
    '{{CLARITY_PAGE_TYPE}}': config.clarity_page_type || 'landing',
    '{{SLUG}}': config.slug,
    '{{H1_TEXT}}': config.h1_text,
    '{{HERO_SUBLINE}}': config.hero_subline || '',
    '{{FOOTER_TAGLINE}}': config.footer_tagline,
    '{{FOOTER_PRODUCTS}}': config.footer_products,
    '{{FAQ_CTA_TITLE}}': config.faq_cta_title || '',
    '{{HERO_VIDEO_DESKTOP}}': config.hero_video_desktop || '../assets/videos/hero-desktop-neon.mp4',
    '{{HERO_VIDEO_MOBILE}}': config.hero_video_mobile || '../assets/videos/hero-mobile.mp4',
    '{{DEFAULT_PRODUCT}}': config.default_product || 'LED Neonschild',
    '{{PRICE_ANCHOR}}': config.price_anchor || 'LED Neon ab 299 € · 3D Buchstaben ab 499 € · Leuchtkästen ab 499 €',
    '{{PRICE_ANCHOR_DESKTOP}}': config.price_anchor_desktop || 'LED Neon Schilder ab 199 EUR',
    '{{STICKY_PRODUKT}}': config.sticky_produkt || 'neonschild',
  };

  let result = html;
  for (const [key, value] of Object.entries(vars)) {
    // Use split/join for global replace (no regex escaping needed)
    result = result.split(key).join(value);
  }

  return result;
}

// ─── Simple HTML minifier ───
function minifyHtml(html) {
  // Step 1: Strip JS single-line comments inside <script> blocks BEFORE removing newlines.
  // Without this, // comments swallow the rest of the line after newlines are collapsed.
  html = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (match, scriptContent, offset, full) => {
    const tag = match.slice(0, match.indexOf('>') + 1);
    // Don't touch JSON-LD blocks
    if (tag.includes('application/ld+json')) return match;
    const cleaned = scriptContent.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1|(?<![:\w])\/\/(?![\/:]).*$/gm, (m) => {
      // Keep string literals, only strip actual // line comments
      return m.startsWith('/') ? '' : m;
    });
    return tag + cleaned + '</script>';
  });

  return html
    // Remove HTML comments (but keep conditional comments and structured data)
    .replace(/<!--(?!\[if)(?!.*ld\+json)[\s\S]*?-->/g, '')
    // Collapse whitespace between tags
    .replace(/>\s+</g, '><')
    // Remove leading/trailing whitespace on lines
    .replace(/^\s+/gm, '')
    // Collapse multiple newlines
    .replace(/\n{2,}/g, '\n')
    // Remove newlines (single line output)
    .replace(/\n/g, '')
    // Collapse multiple spaces (but not in strings)
    .replace(/\s{2,}/g, ' ');
}

// ─── Build single LP ───
function buildLP(config) {
  const startTime = Date.now();

  // Load base layout
  const baseHtml = fs.readFileSync(path.join(LAYOUTS_DIR, 'base.html'), 'utf8');

  // Assemble sections
  const sections = config.sections.map(sectionName => {
    return loadSection(sectionName, config.slug);
  }).join('\n\n');

  // Insert sections into base
  let html = baseHtml.replace('{{SECTIONS}}', sections);

  // Replace all template variables
  html = replaceVariables(html, config);

  // Minify (unless --no-minify)
  if (!noMinify) {
    html = minifyHtml(html);
  }

  // Write output
  const outputDir = path.join(DEPLOY_DIR, config.slug);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'index.html');

  // Backup existing file
  if (fs.existsSync(outputPath)) {
    const backupDir = path.join(SOURCE_DIR, '.backup-pre-build');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `${config.slug}-index.html`);
    fs.copyFileSync(outputPath, backupPath);
  }

  fs.writeFileSync(outputPath, html);

  const elapsed = Date.now() - startTime;
  const size = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`✓ ${config.slug}/index.html (${size}KB, ${elapsed}ms)`);
}

// ─── Main ───
function main() {
  console.log('NEONTRIP LP Build System');
  console.log('═══════════════════════');
  console.log(`Minify: ${!noMinify}`);
  console.log('');

  const configs = loadConfigs();

  if (specificSlug) {
    const config = configs.find(c => c.slug === specificSlug);
    if (!config) {
      console.error(`✗ Config not found for: ${specificSlug}`);
      console.error(`  Available: ${configs.map(c => c.slug).join(', ')}`);
      process.exit(1);
    }
    buildLP(config);
  } else {
    console.log(`Building ${configs.length} LPs...\n`);
    configs.forEach(buildLP);
  }

  console.log('\n✅ Build complete!');
}

main();
