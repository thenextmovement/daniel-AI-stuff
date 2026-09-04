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
const DEFAULT_OPENAI_ADS_PIXEL_ID = '6GqgnrdSPjJSGdthY89B9Y';

// Section filename map (section name → filename)
const SECTION_FILES = {
  'header':        '01-header.html',
  'hero':          '02-hero.html',
  'stats-bar':     '03-stats-bar.html',
  'process':       '03-process.html',
  'projekte':      '04-projekte.html',
  'events':        '05-events.html',
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
function loadSection(sectionName, slug, overrideAliases = {}) {
  const filename = SECTION_FILES[sectionName];
  if (!filename) {
    console.warn(`⚠ Unknown section: ${sectionName}`);
    return `<!-- Unknown section: ${sectionName} -->`;
  }

  // Check for LP-specific override first
  const overrideSlug = overrideAliases[sectionName] || slug;
  const overridePath = path.join(OVERRIDES_DIR, overrideSlug, filename);
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
    document.addEventListener('DOMContentLoaded', function() {
      var el = document.querySelector('#hero h1');
      if (el) el.innerHTML = h;
      var plain = h.replace(/<[^>]*>/g, '');
      var ft = document.getElementById('hero-form-title-d');
      var ftm = document.getElementById('hero-form-title');
      if (ft) ft.textContent = 'Anfrage für ' + plain + ' — in 60 Sek.';
      if (ftm) ftm.textContent = 'Anfrage für ' + plain + ' — in 60 Sek.';
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

// ─── Generate OpenAI Ads Measurement Pixel setup ───
function generateOpenAiAdsPixelSetup(config) {
  const pixelId = String(config.openai_ads_pixel_id || DEFAULT_OPENAI_ADS_PIXEL_ID).trim();
  if (!pixelId) return '';
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(pixelId)) {
    throw new Error(`Invalid OpenAI Ads pixel ID for ${config.slug}`);
  }

  return `  <!-- OpenAI Ads Measurement Pixel (explicit Cookiebot consent) -->
  <script>
  (function(){
    !function(w,d,s,u){if(w.oaiq)return;var q=function(){q.q.push(arguments)};q.q=[];w.oaiq=q;var j=d.createElement(s);j.async=1;j.src=u;var f=d.getElementsByTagName(s)[0];f.parentNode.insertBefore(j,f)}(window,document,"script","https://bzrcdn.openai.com/sdk/oaiq.min.js");
    oaiq("consent",false);
    oaiq("init",{pixelId:${JSON.stringify(pixelId)}});
    function syncOpenAiAdsConsent(){
      var granted=Boolean(window.Cookiebot&&window.Cookiebot.consent&&window.Cookiebot.consent.marketing===true);
      oaiq("consent",granted);
    }
    window.addEventListener("CookiebotOnConsentReady",syncOpenAiAdsConsent);
    window.addEventListener("CookiebotOnAccept",syncOpenAiAdsConsent);
    window.addEventListener("CookiebotOnDecline",syncOpenAiAdsConsent);
    if(window.Cookiebot&&window.Cookiebot.consent)syncOpenAiAdsConsent();
  })();
  </script>`;
}

function generateProjectContextFields(config, variant) {
  if (!config.enable_b2b_project_context) return '';

  const isContact = variant === 'contact';
  const isDesktop = variant === 'desktop';
  const idSuffix = isContact ? 'kontakt' : isDesktop ? 'hero-d' : 'hero';
  const labelClass = isContact
    ? 'text-xs font-medium text-dark tracking-tight mb-1 block'
    : isDesktop
      ? 'text-[12px] font-semibold text-dark tracking-[-0.01em] block mb-1'
      : 'text-[11px] font-semibold text-dark block mb-1';
  const inputClass = isContact
    ? 'w-full bg-[#F5F5F5] rounded-[10px] px-3.5 py-2 text-base md:text-sm font-medium tracking-tight text-dark outline-none focus:ring-1 focus:ring-gray-300'
    : isDesktop
      ? 'w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3.5 py-2.5 text-[13px] font-medium text-dark outline-none focus:border-dark/20 focus:bg-white transition-all duration-200'
      : 'w-full bg-dark/[0.03] border border-black/[0.06] rounded-xl px-3 py-2.5 text-[14px] font-medium text-dark';

  return `<div>
                  <label for="${idSuffix}-project-context" class="${labelClass}">Anwendungsfall <span class="font-normal text-dark/40">(optional)</span></label>
                  <select name="project_context" id="${idSuffix}-project-context" class="${inputClass}">
                    <option value="" selected>Bitte wählen</option>
                    <option value="Empfang, Büro oder Showroom">Empfang, Büro oder Showroom</option>
                    <option value="Ladenbau, Retail oder Gastronomie">Ladenbau, Retail oder Gastronomie</option>
                    <option value="Messe, Event oder Pop-up">Messe, Event oder Pop-up</option>
                    <option value="Außenfassade oder Werbeanlage">Außenfassade oder Werbeanlage</option>
                    <option value="Filial- oder Serien-Rollout">Filial- oder Serien-Rollout</option>
                    <option value="Sonstiger gewerblicher Einsatz">Sonstiger gewerblicher Einsatz</option>
                  </select>
                </div>
                <div class="grid grid-cols-2 gap-2${isContact ? '.5' : ''}">
                  <div>
                    <label for="${idSuffix}-quantity-band" class="${labelClass}">Menge / Rollout <span class="font-normal text-dark/40">(optional)</span></label>
                    <select name="quantity_band" id="${idSuffix}-quantity-band" class="${inputClass}">
                      <option value="" selected>Bitte wählen</option>
                      <option value="Einzelanfertigung">1 Stück</option>
                      <option value="Kleinserie 2–5 Stück">2–5 Stück</option>
                      <option value="Rollout 6–20 Stück">6–20 Stück</option>
                      <option value="Serienproduktion 21+ Stück">21+ / Serie</option>
                      <option value="Menge noch offen">Noch offen</option>
                    </select>
                  </div>
                  <div>
                    <label for="${idSuffix}-desired-deadline" class="${labelClass}">Wunschtermin <span class="font-normal text-dark/40">(optional)</span></label>
                    <input type="date" name="desired_deadline" id="${idSuffix}-desired-deadline" class="${inputClass}">
                  </div>
                </div>`;
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
    '{{OPENAI_ADS_PIXEL_SETUP}}': generateOpenAiAdsPixelSetup(config),
    '{{CLARITY_PAGE_TYPE}}': config.clarity_page_type || 'landing',
    '{{SLUG}}': config.slug,
    '{{H1_TEXT}}': config.h1_text,
    '{{HERO_SUBLINE}}': config.hero_subline || '',
    '{{HERO_POSTER_DESKTOP}}': config.hero_poster_desktop || '../assets/images/hero-poster-desktop-neon.webp',
    '{{HERO_POSTER_MOBILE}}': config.hero_poster_mobile || '../assets/images/hero-poster-neon-mobile.webp',
    '{{HERO_POSTER_ALT_DESKTOP}}': config.hero_poster_alt_desktop || 'NEONTRIP LED Neonschild',
    '{{HERO_POSTER_ALT_MOBILE}}': config.hero_poster_alt_mobile || 'NEONTRIP LED Leuchtreklame',
    '{{PROJECT_COUNT_LABEL}}': config.project_count_label || 'Über 8.200+ realisierte Projekte',
    '{{REFERENCE_PROJECT_COUNT_LABEL}}': config.reference_project_count_label || 'Über 8.247 Projekte für Agenturen, Marken und Unternehmen jeder Größe',
    '{{REVIEW_SUMMARY}}': config.review_summary || '4,9 bei 186 Bewertungen',
    '{{EXPRESS_FORM_LABEL}}': config.express_form_label || 'Express-Fertigung (ab 3 Werktage)',
    '{{EXPRESS_STAT_VALUE}}': config.express_stat_value || '3 Tage',
    '{{EXPRESS_STAT_LABEL}}': config.express_stat_label || 'Express-Versand',
    '{{DELIVERY_PROCESS_COPY}}': config.delivery_process_copy || 'Fertig montiert geliefert – ab 3 Tagen',
    '{{EXPRESS_HEADLINE}}': config.express_headline || 'Express in 3 Tagen',
    '{{EXPRESS_COPY}}': config.express_copy || 'Europaweit bei Eilaufträgen.',
    '{{VORTEILE_SUMMARY_TITLE}}': config.vorteile_summary_title || 'Warum Unternehmen ihre Neon Schilder bei NEONTRIP bestellen',
    '{{VORTEILE_SUMMARY_COPY}}': config.vorteile_summary_copy || 'Persönlicher Ansprechpartner, kostenlose 3D-Vorschau in 24h, Qualitätskontrolle vor Versand und termingerechte Lieferung — auch bei Express. Jedes Neon Schild wird individuell nach Ihrem Design gefertigt.',
    '{{CONTACT_ADVISOR_COPY}}': config.contact_advisor_copy || 'Head of Customer Experience. Persönliche Beratung von der Idee bis zum fertigen Neon Schild.',
    '{{PROJECT_COUNTER_BASE}}': String(config.project_counter_base || 8247),
    '{{PROJECT_COUNTER_RATE}}': String(config.project_counter_static ? 0 : (17 / 3)),
    '{{PROJECT_COUNTER_SOURCE_RAW}}': String(config.project_counter_source_raw || 8247),
    '{{PROJECT_COUNTER_SOURCE_LABEL}}': JSON.stringify(config.project_counter_source_label || '8.247'),
    '{{AI_CITABLE_DESCRIPTION}}': config.ai_citable_description || 'NEONTRIP ist ein Spezialist für individuelle LED Neon Schilder und Leuchtschriften aus Düsseldorf.',
    '{{AI_CITABLE_OFFER}}': config.ai_citable_offer || 'Individuelle Neon Schilder von NEONTRIP sind ab 199 EUR erhältlich — in jeder Schriftart, Farbe und Größe.',
    '{{AI_CITABLE_DELIVERY}}': config.ai_citable_delivery || 'Die Fertigungszeit für LED Neon Schilder beträgt 5–7 Werktage, Express-Fertigung ab 3 Werktagen.',
    '{{AI_CITABLE_MATERIAL}}': config.ai_citable_material || 'Material: Hochwertiges LED Neon Flex auf Acrylglasplatte. Energiesparend, bruchsicher und langlebig.',
    '{{AI_CITABLE_PROOF}}': config.ai_citable_proof || 'Über 8.247 realisierte Projekte für Marken wie Campari, Amazon, Aperol und Mercedes-Benz. 4,9 von 5 Sternen bei 236 Google-Bewertungen.',
    '{{WHATSAPP_MESSAGE}}': encodeURIComponent(config.whatsapp_message || 'Hallo, ich interessiere mich für ein individuelles Neonschild. Können Sie mich beraten?'),
    '{{PROJECT_CONTEXT_FIELDS_MOBILE}}': generateProjectContextFields(config, 'mobile'),
    '{{PROJECT_CONTEXT_FIELDS_DESKTOP}}': generateProjectContextFields(config, 'desktop'),
    '{{PROJECT_CONTEXT_FIELDS_CONTACT}}': generateProjectContextFields(config, 'contact'),
    '{{FOOTER_TAGLINE}}': config.footer_tagline,
    '{{FOOTER_PRODUCTS}}': config.footer_products,
    '{{FAQ_CTA_TITLE}}': config.faq_cta_title || '',
    '{{HERO_VIDEO_DESKTOP}}': config.hero_video_desktop || '../assets/videos/hero-desktop-neon.mp4',
    '{{HERO_VIDEO_MOBILE}}': config.hero_video_mobile || '../assets/videos/hero-mobile.mp4',
    '{{DEFAULT_PRODUCT}}': config.default_product || 'LED Neonschild',
    '{{PRICE_ANCHOR}}': config.price_anchor || 'LED Neon ab 299 € · 3D Buchstaben ab 499 € · Leuchtkästen ab 499 €',
    '{{PRICE_ANCHOR_DESKTOP}}': config.price_anchor_desktop || 'LED Neon Schilder ab 199 EUR',
    '{{PRODUCT_OPTIONS}}': config.product_options || [
      '<option value="LED Neonschild">LED Neonschild</option>',
      '<option value="LED Schriftzug">LED Schriftzug</option>',
      '<option value="LED Logo Wandschild">LED Logo Wandschild</option>',
      '<option value="3D Buchstaben (Front)">3D Buchstaben (Front)</option>',
      '<option value="3D Buchstaben (Rückbeleuchtet)">3D Buchstaben (Rückbeleuchtet)</option>',
      '<option value="Leuchtkasten">Leuchtkasten</option>',
      '<option value="Marquee-Buchstaben">Marquee-Buchstaben</option>',
      '<option value="Vollflächig beleuchtet">Vollflächig beleuchtet</option>',
      '<option value="Unbeleuchtet">Unbeleuchtet</option>',
    ].join('\n                        '),
    '{{STICKY_PRODUKT}}': config.sticky_produkt || 'neonschild',
    '{{PRIMARY_CTA_HREF}}': config.use_local_form_cta
      ? '#hero'
      : `/anfrage?produkt=${encodeURIComponent(config.sticky_produkt || 'neonschild')}`,
    '{{USE_LOCAL_FORM_CTA}}': config.use_local_form_cta ? 'true' : 'false',
    '{{LIGHTBOX_CTA_ATTRS}}': config.use_local_form_cta
      ? 'onclick="closeLightbox()"'
      : 'target="_blank" rel="noopener noreferrer"',
    '{{VORTEILE_SUBLINE}}': config.vorteile_subline || 'Individuelle LED Neon Schilder — vom Entwurf bis zur Lieferung montagefertig.',
    '{{EVENTS_SUBLINE_MOBILE}}': config.events_subline_mobile || 'Bekannte Marken & Events vertrauen auf NEONTRIP Neon Schilder.',
    '{{PRODUKTE_SUBLINE}}': config.produkte_subline || 'Neon Schilder, LED Schriftzüge & mehr — klicken Sie für Beispiele und direkte Anfrage.',
    '{{PRODUCT_GRID_ORDER}}': config.product_grid_order || '',
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
    return loadSection(sectionName, config.slug, config.section_override_aliases || {});
  }).join('\n\n');

  // Insert sections into base
  let html = baseHtml.replace('{{SECTIONS}}', sections);

  // Replace all template variables
  html = replaceVariables(html, config);

  // Rewrite asset paths for root-level pages (e.g. ../assets/ → /assets/)
  if (config.asset_prefix) {
    html = html.split('../assets/').join(config.asset_prefix);
  }

  // Minify (unless --no-minify)
  if (!noMinify) {
    html = minifyHtml(html);
  }

  // Write output — support config.output_dir for root-level pages
  const outputDir = config.output_dir
    ? path.resolve(DEPLOY_DIR, config.output_dir)
    : path.join(DEPLOY_DIR, config.slug);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, config.output_file || 'index.html');

  // Backup existing file
  if (fs.existsSync(outputPath)) {
    const backupDir = path.join(DEPLOY_DIR, '.backup-pre-build');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupName = config.output_dir === '.'
      ? (config.output_file || 'index.html').replace('.html', '')
      : `${config.slug}-index`;
    const backupPath = path.join(backupDir, `${backupName}.html`);
    fs.copyFileSync(outputPath, backupPath);
  }

  fs.writeFileSync(outputPath, html);

  const elapsed = Date.now() - startTime;
  const size = (Buffer.byteLength(html) / 1024).toFixed(0);
  const displayName = config.output_dir === '.'
    ? (config.output_file || 'index.html')
    : `${config.slug}/index.html`;
  console.log(`✓ ${displayName} (${size}KB, ${elapsed}ms)`);
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
