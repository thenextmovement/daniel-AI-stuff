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
  'intent-guide':  '04-intent-guide.html',
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
  const configFiles = fs.readdirSync(CONFIGS_DIR).filter(f => f.endsWith('.json'));
  const rawConfigs = new Map();
  for (const file of configFiles) {
    const config = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, file), 'utf8'));
    if (!config.slug) throw new Error(`Config is missing slug: ${file}`);
    if (rawConfigs.has(config.slug)) throw new Error(`Duplicate config slug: ${config.slug}`);
    rawConfigs.set(config.slug, config);
  }

  // Small intent pages can inherit the proven page shell without copying a
  // several-hundred-line config. Arrays are intentionally replaced, while
  // section variants are merged so a child can override only one section.
  const resolving = new Set();
  const resolved = new Map();
  function resolve(slug) {
    if (resolved.has(slug)) return resolved.get(slug);
    const own = rawConfigs.get(slug);
    if (!own) throw new Error(`Extended config not found: ${slug}`);
    if (resolving.has(slug)) throw new Error(`Circular config inheritance: ${[...resolving, slug].join(' -> ')}`);
    resolving.add(slug);
    const parent = own.extends ? resolve(String(own.extends)) : {};
    const config = {
      ...parent,
      ...own,
      section_variants: {
        ...(parent.section_variants || {}),
        ...(own.section_variants || {}),
      },
    };
    delete config.extends;
    resolving.delete(slug);
    resolved.set(slug, config);
    return config;
  }

  return [...rawConfigs.keys()].map(resolve);
}

// ─── Load section ───
function loadSection(sectionName, slug, sectionVariants = {}) {
  const filename = SECTION_FILES[sectionName];
  if (!filename) {
    console.warn(`⚠ Unknown section: ${sectionName}`);
    return `<!-- Unknown section: ${sectionName} -->`;
  }

  // A page may reuse one proven section implementation while keeping its own
  // copy, images and tracking identifiers in config. Only allow safe slug
  // characters so this cannot escape the overrides directory.
  const requestedVariant = sectionVariants && sectionVariants[sectionName];
  const variantSlug = requestedVariant
    ? String(requestedVariant).replace(/[^a-zA-Z0-9_-]/g, '')
    : slug;

  // Check for LP-specific or explicitly shared override first
  const overridePath = path.join(OVERRIDES_DIR, variantSlug, filename);
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
  const accentClass = String(config.dki_accent_class || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const accentTerms = Array.isArray(config.dki_accent_terms)
    ? config.dki_accent_terms.map(term => String(term).replace(/'/g, "\\'"))
    : [];
  // Keep the offer-led form title stable. DKI belongs in the H1; duplicating a
  // long search phrase inside the compact form hurts clarity and mobile fit.
  const syncFormTitle = config.dki_sync_form_title === true;

  return `<!-- Dynamic Text Replacement (Google Ads Keyword Mapping) -->
  <script>
  (function(){
    var kw = (new URLSearchParams(location.search).get('kw') || '').toLowerCase().trim();
    if (!kw) return;
    var h, rules = [
${rulesStr}
    ], accentClass = '${accentClass}', accentTerms = [${accentTerms.map(term => `'${term}'`).join(', ')}], syncFormTitle = ${syncFormTitle};
    for (var i = 0; i < rules.length; i++) {
      if (kw.indexOf(rules[i][0]) !== -1) { h = rules[i][1]; break; }
    }
    if (!h) return;
    var suffix = '${escapedSuffix}';
    document.addEventListener('DOMContentLoaded', function() {
      var el = document.querySelector('#hero h1');
      var headline = h;
      if (accentClass && accentTerms.length) {
        for (var j = 0; j < accentTerms.length; j++) {
          var needle = accentTerms[j];
          var at = headline.toLowerCase().indexOf(needle.toLowerCase());
          if (at !== -1) {
            headline = headline.slice(0, at) + '<span class="' + accentClass + '">' + headline.slice(at, at + needle.length) + '</span>' + headline.slice(at + needle.length);
            break;
          }
        }
      }
      if (el) el.innerHTML = headline + suffix;
      var plain = (h + suffix).replace(/<[^>]*>/g, '');
      var ft = document.getElementById('hero-form-title-d');
      var ftm = document.getElementById('hero-form-title');
      if (syncFormTitle && ft) ft.textContent = plain + ' — in 60 Sek.';
      if (syncFormTitle && ftm) ftm.textContent = plain + ' — in 1 Min.';
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
    '{{ROBOTS_META}}': config.robots_meta || 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
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
    '{{HERO_PRELOAD_DESKTOP}}': config.hero_preload_desktop || '../assets/images/hero-poster-desktop-neon.webp',
    '{{HERO_PRELOAD_MOBILE}}': config.hero_preload_mobile || '../assets/images/hero-poster-neon-mobile.webp',
    '{{HERO_IMAGE}}': config.hero_image || '../assets/images/hero-poster-desktop-neon.webp',
    '{{HERO_IMAGE_MOBILE}}': config.hero_image_mobile || config.hero_image || '../assets/images/hero-poster-neon-mobile.webp',
    '{{HERO_EYEBROW}}': config.hero_eyebrow || 'Individuelle Leuchtreklame für Unternehmen',
    '{{HERO_FORM_TITLE}}': config.hero_form_title || 'Kostenlose 3D-Vorschau + Festpreisangebot',
    '{{HERO_FORM_SUBLINE}}': config.hero_form_subline || 'Unverbindlich anfragen · persönliche Beratung',
    '{{HERO_PROCESS_IMAGE_1}}': config.hero_process_image_1 || '../assets/images/kundenlogos/3.svg',
    '{{HERO_PROCESS_IMAGE_2}}': config.hero_process_image_2 || '../assets/images/projekte/loveme-backlit.webp',
    '{{HERO_PROCESS_IMAGE_3}}': config.hero_process_image_3 || '../assets/images/projekte/aperol-deli-neon.webp',
    '{{HERO_PROCESS_TITLE_1}}': config.hero_process_title_1 || 'Logo hochladen',
    '{{HERO_PROCESS_TITLE_2}}': config.hero_process_title_2 || '3D-Vorschau erhalten',
    '{{HERO_PROCESS_TITLE_3}}': config.hero_process_title_3 || 'Schild produzieren',
    '{{HERO_PROOF_TEXT}}': config.hero_proof_text || '4,9/5 bei 236 Google-Bewertungen',
    '{{HERO_REVIEW_QUOTE}}': config.hero_review_quote || 'Schnelle Visualisierung, persönliche Beratung und zuverlässige Umsetzung.',
    '{{HERO_REVIEW_AUTHOR}}': config.hero_review_author || 'Verifizierte Google-Bewertung',
    '{{DEFAULT_PRODUCT}}': config.default_product || 'LED Neonschild',
    '{{DEFAULT_LOCATION}}': config.default_location || '',
    '{{INTENT_ID}}': config.intent_id || config.slug,
    '{{LP_VARIANT}}': config.lp_variant || 'photo_upload_v1',
    '{{FUNNEL_EVENT_CATEGORY}}': config.funnel_event_category || `${config.slug}_funnel`,
    '{{HERO_FORM_NAME}}': config.hero_form_name || `hero_form_${config.slug.replace(/-/g, '_')}`,
    '{{HERO_FORM_SOURCE}}': config.hero_form_source || `hero-form-${config.slug}-photo-v1`,
    '{{PRICE_ANCHOR}}': config.price_anchor || 'LED Neon ab 299 € · 3D Buchstaben ab 499 € · Leuchtkästen ab 499 €',
    '{{PRICE_ANCHOR_DESKTOP}}': config.price_anchor_desktop || 'LED Neon Schilder ab 199 EUR',
    '{{STICKY_PRODUKT}}': config.sticky_produkt || 'neonschild',
    '{{PRODUCT_SECTION_TITLE}}': config.product_section_title || 'Welche Umsetzung passt zu Ihrem Projekt?',
    '{{PRODUCT_SECTION_LEAD}}': config.product_section_lead || 'Produkte vergleichen, Beispiele ansehen und direkt die passende Ausführung anfragen.',
    '{{INTENT_GUIDE_EYEBROW}}': config.intent_guide_eyebrow || 'Orientierung vor der Anfrage',
    '{{INTENT_GUIDE_TITLE}}': config.intent_guide_title || 'Worauf es bei der passenden Lichtwerbung ankommt',
    '{{INTENT_GUIDE_LEAD}}': config.intent_guide_lead || 'Bauart, Einsatzort und gewünschte Wirkung entscheiden gemeinsam über die passende Umsetzung.',
    '{{INTENT_GUIDE_CARD_1_TITLE}}': config.intent_guide_card_1_title || 'Wirkung und Lesbarkeit',
    '{{INTENT_GUIDE_CARD_1_BODY}}': config.intent_guide_card_1_body || 'Betrachtungsabstand, Kontrast und Umgebung bestimmen, wie klar das Motiv später wirkt.',
    '{{INTENT_GUIDE_CARD_2_TITLE}}': config.intent_guide_card_2_title || 'Technik und Material',
    '{{INTENT_GUIDE_CARD_2_BODY}}': config.intent_guide_card_2_body || 'Wir wählen Bauart und Material passend zu Motiv, Montagefläche und gewünschter Lichtwirkung.',
    '{{INTENT_GUIDE_CARD_3_TITLE}}': config.intent_guide_card_3_title || 'Visualisierung im Umfeld',
    '{{INTENT_GUIDE_CARD_3_BODY}}': config.intent_guide_card_3_body || 'Mit Logo und Einsatzort entsteht eine Vorschau, die Proportion und Wirkung besser einschätzbar macht.',
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

  // Load the configured layout. Slugs opt in explicitly so existing LPs keep
  // their current shell while pilots can ship a lean, page-specific document.
  const layoutName = String(config.layout || 'base').replace(/[^a-zA-Z0-9_-]/g, '');
  const layoutPath = path.join(LAYOUTS_DIR, `${layoutName}.html`);
  if (!fs.existsSync(layoutPath)) {
    throw new Error(`Layout not found: ${layoutName}.html`);
  }
  const baseHtml = fs.readFileSync(layoutPath, 'utf8');

  // Assemble sections
  const sections = config.sections.map(sectionName => {
    return loadSection(sectionName, config.slug, config.section_variants || {});
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
