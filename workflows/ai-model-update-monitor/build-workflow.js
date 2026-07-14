const analyzeCode = String.raw`
function sourceText(nodeName, fieldName) {
  const value = $(nodeName).first().json[fieldName];
  if (typeof value !== 'string' || value.length < 500) {
    throw new Error('Quelle ungueltig oder zu kurz: ' + nodeName + ' (' + fieldName + ')');
  }
  return value;
}

function decode(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function esc(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hash(value) {
  const s = String(value || '');
  let a = 2166136261;
  let b = 2246822519;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a ^= c;
    a = Math.imul(a, 16777619);
    b ^= c + i;
    b = Math.imul(b, 3266489917);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

const ACTION = /(introduc|launch|releas|new\b|update|upgrad|improv|available|availability|preview|general availability|\bga\b|deprecat|retir|sunset|shut down|model family|model update|rollout)/i;
const MODEL_PATTERNS = {
  OpenAI: /(gpt[-\s]?\d|chatgpt|sora|dall[-\s]?e|\bo\d(?:\b|-)|image model|audio model|voice model|realtime model|speech model|transcrib|text[-\s]?to[-\s]?speech|video model|vision model)/i,
  Anthropic: /(claude|opus|sonnet|haiku|fable|mythos|anthropic.{0,20}model|vision|image|audio|voice|video|multimodal)/i,
  Gemini: /(gemini|veo|imagen|lyria|nano banana|google.{0,20}model|flash|\bpro model|live api|\btts\b|text[-\s]?to[-\s]?speech|audio[-\s]?to[-\s]?audio|image generation|video generation)/i,
};

function relevant(provider, text) {
  return MODEL_PATTERNS[provider].test(text) && ACTION.test(text);
}

function tag(block, name) {
  const match = block.match(new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  return match ? decode(match[1]) : '';
}

function category(text) {
  const t = String(text || '').toLowerCase();
  const result = [];
  if (/audio|voice|speech|tts|realtime|transcrib|music|lyria/.test(t)) result.push('Sprache/Audio');
  if (/image|vision|imagen|dall|nano banana/.test(t)) result.push('Bild');
  if (/video|sora|veo/.test(t)) result.push('Video');
  if (!result.length || /gpt|gemini|claude|opus|sonnet|haiku|flash|pro model/.test(t)) result.unshift('Text/Multimodal');
  return [...new Set(result)].join(', ');
}

function impactRecommendations(item) {
  const text = (item.title + ' ' + item.summary + ' ' + item.category).toLowerCase();
  const isAudio = /audio|voice|speech|tts|realtime|transcrib|music/.test(text);
  const isImage = /image|vision|imagen|dall|nano banana/.test(text);
  const isVideo = /video|sora|veo/.test(text);
  const isEmbedding = /embedding|vector|retrieval|file search|multimodal search/.test(text);
  const isGeneralOpenAiModel = /gpt|chatgpt|\bo\d(?:\b|-)/.test(text);
  const isRetirement = /deprecat|retir|sunset|shut down|end.of.life/.test(text);
  const migrationPrefix = isRetirement ? 'Migration zeitnah planen; ' : '';
  const result = [];
  const add = (entry) => result.push({ provider: item.provider, trigger: item.title, ...entry });

  if (item.provider === 'Anthropic') {
    add({
      key: 'anthropic-ai-email-agent', priority: isRetirement ? 'HOCH' : 'MITTEL', match: 'Direkt betroffen',
      target: 'AI Email Agent v2 — Draft Only', location: 'n8n · ET6R8SAOjAquCpaH · Analyze Attachments Safely / Draft Reply JSON',
      action: migrationPrefix + 'neues Claude-Modell zuerst gegen gespeicherte Mail- und Attachment-Evals im Draft-only-Modus vergleichen.',
      chance: 'Bessere Anhangserkennung, stabilere JSON-Entwürfe und möglicherweise geringere Laufzeit oder Kosten.',
      risk: 'Prompt- und JSON-Drift kann falsche Aussagen, Zusagen oder unvollständige Anhanganalyse erzeugen.',
      guardrail: 'Keine Auto-Sends; JSON-Schema, Promise-Blocker und Human Review unverändert lassen.',
    });
    add({
      key: 'anthropic-followup-processor', priority: isRetirement ? 'HOCH' : 'MITTEL', match: 'Direkt betroffen',
      target: 'NEONTRIP Follow-up Queue Processor v3.6', location: 'n8n · CS4jhqo9tdd0cPe4 · Claude / Claude Retry / Classify Reply / Classify EC',
      action: migrationPrefix + 'Shadow-Auswertung auf historischen Antworten durchführen, bevor Klassifikation oder Retry-Modell geändert wird.',
      chance: 'Genauere Erkennung von Antwort, Absage und Terminwunsch; weniger unnötige Follow-ups.',
      risk: 'Fehlklassifikation kann Follow-ups stoppen oder Reschedule/Cancel-Aktionen falsch vorbereiten.',
      guardrail: 'Bestehende Parser, deterministische Action-Switches und Datenbank-Idempotenz nicht umgehen.',
    });
  }

  if (item.provider === 'OpenAI' && !isAudio && ((!isImage && !isVideo) || isGeneralOpenAiModel)) {
    add({
      key: 'openai-request-segmenter', priority: isRetirement ? 'HOCH' : 'MITTEL', match: 'Direkt betroffen',
      target: 'NEONTRIP Request Segmenter v1.0 (SHADOW)', location: 'n8n · ELpwCfdWOCRZ22gy · OpenAI Structured Segment Classifier',
      action: migrationPrefix + 'neues GPT-Modell im vorhandenen Shadow-Betrieb gegen die aktuelle Segment-Taxonomie testen.',
      chance: 'Höhere Klassifikationsqualität bei geringerem Tokenverbrauch und bessere strukturierte Outputs.',
      risk: 'Taxonomie-Drift oder andere JSON-Details können Routing und nachgelagerte Automationen verschieben.',
      guardrail: 'Nur validiertes Schema speichern; Trello bleibt Projektion und darf keine Klassifikationsquelle werden.',
    });
    add({
      key: 'openai-unstructured-requests', priority: isRetirement ? 'HOCH' : 'NIEDRIG', match: 'Direkt betroffen',
      target: 'RH | Unstruktuierte Anfragen Aktiv', location: 'n8n · AcYSau5MGsAxeAqL · Übersetzung / Message a model',
      action: migrationPrefix + 'Deutsch/Englisch/Chinesisch-Evals sowie Feldvollständigkeit vor einem Modellwechsel vergleichen.',
      chance: 'Bessere Mehrsprachigkeit und robustere Extraktion aus unstrukturierten Anfragen.',
      risk: 'Übersetzungsnuancen oder extrahierte Werte können sich ändern und operative Daten verfälschen.',
      guardrail: 'Preise, Termine und Zusagen weiterhin ausschließlich deterministisch validieren.',
    });
  }

  if (item.provider === 'OpenAI' && isAudio) {
    add({
      key: 'openai-voice-runtime', priority: isRetirement ? 'HOCH' : 'HOCH', match: 'Direkt betroffen',
      target: 'NEONTRIP Voice Runtime', location: 'Ops-Software · services/voice-runtime · OpenAI Realtime/SIP; Eval-Suite in src/lib/ops/voice-platform-evals.ts',
      action: migrationPrefix + 'neues Realtime-/Audio-Modell nur im internal_test-Modus gegen die bestehende 50+-Szenarien-Eval-Suite testen.',
      chance: 'Natürlichere Gespräche, geringere Latenz, bessere Unterbrechungserkennung und günstigere Calls.',
      risk: 'Turn-Taking, Tool Calls, Gesprächskosten, Disclosure und Human Handoff können regressieren.',
      guardrail: 'Kein Produktionswechsel ohne Consent-, Handoff-, Safety- und Kostenvergleich; keine Audio-/Transcript-Persistenz ergänzen.',
    });
    add({
      key: 'openai-voice-poller', priority: 'NIEDRIG', match: 'Indirekt betroffen',
      target: 'Voice Agent — Call Status Poller v1.0', location: 'n8n · PsymhpsiEs8Qj6vN · Vapi-Status und Supabase-Outcomes',
      action: 'Status- und Failure-Mapping prüfen, falls der Voice-Provider oder das Realtime-Modell neue Endzustände liefert.',
      chance: 'Präzisere Outcome-Erkennung und weniger hängenbleibende Reminder.',
      risk: 'Neue Statuswerte könnten als unbekannt behandelt werden und Recovery verhindern.',
      guardrail: 'Postgres bleibt Source of Truth; Statusänderungen idempotent halten.',
    });
  }

  if (item.provider === 'Gemini' && isVideo) {
    add({
      key: 'gemini-video-qc', priority: isRetirement ? 'HOCH' : 'HOCH', match: 'Direkt betroffen',
      target: 'KI-Video Generator — Video Content QC', location: 'n8n · 9FoJMH6OUdsi36FB · Analyze Video Content QC (Gemini)',
      action: migrationPrefix + 'neues Gemini-Modell parallel auf akzeptierten und abgelehnten Videos evaluieren; Schwellenwerte nicht automatisch übernehmen.',
      chance: 'Bessere Erkennung von falschem Inhalt, Artefakten und nicht passenden Neon-Mockups.',
      risk: 'False Positives blockieren Angebote; False Negatives lassen unpassende Kundenvideos durch.',
      guardrail: 'Bestehenden Watchdog, Review-Puffer und Failure-Pfad unverändert lassen.',
    });
    add({
      key: 'gemini-veo-vs-runway', priority: 'MITTEL', match: 'Testkandidat, kein Direkt-Upgrade',
      target: 'KI-Video Generator — Runway-Erzeugung', location: 'n8n · HIFQvcfBKPEK9oSN / 9FoJMH6OUdsi36FB · Build Runway Request / Submit to Runway',
      action: 'Veo als separaten Provider-Adapter mit identischen Mockups testen; Runway nicht direkt ersetzen.',
      chance: 'Möglicherweise bessere Bewegungsqualität, Prompttreue oder Preis-Leistung.',
      risk: 'Andere Dauer, Seitenverhältnisse, Moderation, Latenz, Kosten und Download-Verträge.',
      guardrail: 'Provider hinter Feature-Flag; bestehende Runway-Rollback-Route und Content-QC beibehalten.',
    });
  }

  if (item.provider === 'Gemini' && !isVideo) {
    add({
      key: 'gemini-video-qc-compatibility', priority: isRetirement ? 'HOCH' : 'MITTEL', match: 'Kompatibilität prüfen',
      target: 'KI-Video Generator — Gemini Video Content QC', location: 'n8n · 9FoJMH6OUdsi36FB · Analyze Video Content QC',
      action: migrationPrefix + 'prüfen, ob der verwendete Gemini-Modellname oder Alias betroffen ist; nur mit Video-QC-Evals umstellen.',
      chance: 'Besseres multimodales Reasoning kann die Qualitätskontrolle der Angebotsvideos verbessern.',
      risk: 'Ein allgemeines Gemini-Release muss nicht dieselben Videoeingaben oder dasselbe Ausgabeformat unterstützen.',
      guardrail: 'Kompatibilität, Video-Input und Parser-Output vor jedem Wechsel deterministisch validieren.',
    });
  }

  if (item.provider === 'OpenAI' && isVideo && !isGeneralOpenAiModel) {
    add({
      key: 'openai-video-vs-runway', priority: 'MITTEL', match: 'Testkandidat, kein Direkt-Upgrade',
      target: 'KI-Video Generator — Runway-Erzeugung', location: 'n8n · HIFQvcfBKPEK9oSN / 9FoJMH6OUdsi36FB · Build Runway Request / Submit to Runway',
      action: 'OpenAI-Videomodell als separaten Provider-Adapter mit denselben Neon-Mockups benchmarken; Runway nicht direkt ersetzen.',
      chance: 'Möglicherweise bessere Prompttreue, integriertes Audio oder attraktivere Kosten.',
      risk: 'Andere API-Verträge, Dauer, Auflösung, Moderation und asynchrone Statuswerte können den bestehenden Flow brechen.',
      guardrail: 'Feature-Flag, isolierte Storage-Pfade, Content-QC und sofortige Rückschaltung auf Runway.',
    });
  }

  if ((item.provider === 'Gemini' || item.provider === 'OpenAI') && isImage) {
    add({
      key: item.provider.toLowerCase() + '-image-mockups', priority: 'MITTEL', match: 'Testkandidat, kein Direkt-Upgrade',
      target: 'Mockup-/Design-Erzeugung', location: 'Ops-Software · design-generation-worker sowie sichere Mockup-Eingänge des KI-Video Generators',
      action: 'Neues Bildmodell in einem separaten Testpfad für Neon-Mockups, Varianten und Headerbilder benchmarken.',
      chance: 'Bessere Texttreue, realistischere Neon-Darstellung und weniger manuelle Korrekturen.',
      risk: 'Logo-/Schriftfehler, falsche Farben oder Geometrien können ungeprüft in Angebote gelangen.',
      guardrail: 'Keine automatische Kundenauslieferung; visuelle Freigabe und Originaldatei-Abgleich verpflichtend.',
    });
  }

  if (isEmbedding) {
    add({
      key: item.provider.toLowerCase() + '-knowledge-embeddings', priority: 'MITTEL', match: 'Architektur-Kandidat',
      target: 'NEONTRIP Wissensbasis / Pinecone-RAG', location: 'n8n · Google Drive → Pinecone Sync und AI Email Agent Knowledge Retrieval',
      action: 'Neues Embedding-Modell nur in einem neuen Index testen; bestehenden Index niemals in-place mischen.',
      chance: 'Bessere mehrsprachige und multimodale Suche in Dokumenten, Bildern und Supportwissen.',
      risk: 'Dimensions- oder Vektorraumwechsel macht bestehende Einbettungen inkompatibel und verschlechtert Retrieval still.',
      guardrail: 'Vollständiger Reindex, Recall-Evals und atomarer Alias-Switch mit Rollback.',
    });
  }

  if (!result.length) {
    add({
      key: item.provider.toLowerCase() + '-observe-only', priority: isRetirement ? 'HOCH' : 'NIEDRIG', match: 'Kein direkter Einsatz gefunden',
      target: 'NEONTRIP Modell-Radar', location: 'Kein aktuell identifizierter produktiver Modellknoten',
      action: migrationPrefix + 'Release beobachten und erst bei klarer Prozesspassung einen isolierten Benchmark anlegen.',
      chance: 'Frühe Kenntnis ohne unnötigen Migrationsaufwand.',
      risk: 'Ein Modellwechsel ohne konkreten Use Case erzeugt Kosten und Regressionen ohne messbaren Nutzen.',
      guardrail: 'Keine produktive Änderung allein aufgrund einer Release-Ankündigung.',
    });
  }
  return result;
}

function makeCandidate(provider, title, date, url, summary, identity) {
  const cleanTitle = decode(title).slice(0, 220);
  const cleanSummary = decode(summary).slice(0, 650);
  const basis = provider + '|' + (identity || url) + '|' + cleanTitle + '|' + cleanSummary;
  return {
    key: provider.toLowerCase() + '-' + hash(basis),
    provider,
    title: cleanTitle || (provider + ' Modell-Update'),
    date: decode(date).slice(0, 80),
    url,
    summary: cleanSummary,
    category: category(cleanTitle + ' ' + cleanSummary),
  };
}

function parseRss(xml, provider, sourceUrl) {
  const result = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const item of items.slice(0, 100)) {
    const title = tag(item, 'title');
    const link = tag(item, 'link') || sourceUrl;
    const date = tag(item, 'pubDate') || tag(item, 'dc:date');
    const summary = tag(item, 'description') || tag(item, 'content:encoded');
    const combined = title + ' ' + summary;
    if (relevant(provider, combined)) {
      result.push(makeCandidate(provider, title, date, link, summary, link + '|' + date));
    }
  }
  return result;
}

function parseDatedHtml(html, provider, sourceUrl) {
  const headings = [];
  const re = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi;
  let match;
  while ((match = re.exec(html))) {
    const text = decode(match[1]);
    if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}$/i.test(text)) {
      headings.push({ date: text, start: match.index, end: re.lastIndex });
    }
  }
  const result = [];
  for (let i = 0; i < Math.min(headings.length, 80); i++) {
    const h = headings[i];
    const end = headings[i + 1] ? headings[i + 1].start : Math.min(html.length, h.end + 20000);
    const body = decode(html.slice(h.end, end)).slice(0, 3500);
    if (relevant(provider, body)) {
      const firstSentence = body.split(/(?<=[.!?])\s+/)[0] || body;
      result.push(makeCandidate(provider, provider + ' Update – ' + h.date, h.date, sourceUrl, firstSentence, sourceUrl + '|' + h.date + '|' + hash(body)));
    }
  }
  return result;
}

function titleFromUrl(url) {
  const slug = String(url).replace(/\/$/, '').split('/').pop() || 'Claude update';
  return slug.split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function parseAnthropicSitemap(xml) {
  const result = [];
  const urls = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];
  for (const block of urls) {
    const loc = tag(block, 'loc');
    const lastmod = tag(block, 'lastmod');
    if (!/anthropic\.com\/(news\/|claude\/)/i.test(loc)) continue;
    const title = titleFromUrl(loc);
    if (relevant('Anthropic', title)) {
      result.push(makeCandidate('Anthropic', title, lastmod, loc, 'Offizielle Anthropic-Seite wurde neu veröffentlicht oder aktualisiert.', loc + '|' + lastmod));
    }
  }
  return result;
}

const openaiNews = sourceText('OpenAI News RSS', 'openaiNews');
const openaiApi = sourceText('OpenAI API Changelog', 'openaiApi');
const anthropicRelease = sourceText('Anthropic Release Notes', 'anthropicRelease');
const anthropicSitemap = sourceText('Anthropic News Sitemap', 'anthropicSitemap');
const geminiApi = sourceText('Gemini API Changelog', 'geminiApi');
const googleAi = sourceText('Google AI RSS', 'googleAi');

let candidates = [
  ...parseRss(openaiNews, 'OpenAI', 'https://openai.com/news/rss.xml'),
  ...parseDatedHtml(openaiApi, 'OpenAI', 'https://developers.openai.com/api/docs/changelog'),
  ...parseDatedHtml(anthropicRelease, 'Anthropic', 'https://platform.claude.com/docs/en/release-notes/overview'),
  ...parseAnthropicSitemap(anthropicSitemap),
  ...parseDatedHtml(geminiApi, 'Gemini', 'https://ai.google.dev/gemini-api/docs/changelog'),
  ...parseRss(googleAi, 'Gemini', 'https://blog.google/technology/ai/rss/'),
];

const unique = new Map();
for (const item of candidates) {
  if (!unique.has(item.key)) unique.set(item.key, item);
}
candidates = [...unique.values()];

for (const provider of ['OpenAI', 'Anthropic', 'Gemini']) {
  if (!candidates.some(item => item.provider === provider)) {
    throw new Error('Parser lieferte keine relevanten Eintraege fuer ' + provider + '. Quelle oder HTML-Struktur pruefen.');
  }
}

const state = $getWorkflowStaticData('global');
const sent = state.sent && typeof state.sent === 'object' ? state.sent : {};
const initialized = state.initialized === true;
const fresh = initialized ? candidates.filter(item => !sent[item.key]) : [];
const keysToMark = (initialized ? fresh : candidates).map(item => item.key);

const providerOrder = { OpenAI: 1, Anthropic: 2, Gemini: 3 };
fresh.sort((a, b) => (providerOrder[a.provider] || 9) - (providerOrder[b.provider] || 9));
const impactMap = new Map();
for (const item of fresh) {
  for (const impact of impactRecommendations(item)) {
    const existing = impactMap.get(impact.key);
    if (!existing) impactMap.set(impact.key, { ...impact, triggers: [item.title] });
    else if (!existing.triggers.includes(item.title)) existing.triggers.push(item.title);
  }
}
const impacts = [...impactMap.values()]
  .sort((a, b) => ({ HOCH: 1, MITTEL: 2, NIEDRIG: 3 }[a.priority] - ({ HOCH: 1, MITTEL: 2, NIEDRIG: 3 }[b.priority])))
  .slice(0, 10);

const correlationId = 'ai-model-updates-' + $execution.id;
const nowBerlin = $now.setZone('Europe/Berlin').toFormat('dd.MM.yyyy HH:mm');
let emailHtml = '';
let emailSubject = '';

if (fresh.length) {
  const groups = {};
  for (const item of fresh) (groups[item.provider] ||= []).push(item);
  const sections = Object.entries(groups).map(([provider, items]) => {
    const cards = items.map(item =>
      '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:10px 0">' +
      '<div style="font-size:12px;color:#6b7280;margin-bottom:5px">' + esc(item.category) + (item.date ? ' · ' + esc(item.date) : '') + '</div>' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:6px">' + esc(item.title) + '</div>' +
      (item.summary ? '<div style="font-size:14px;line-height:1.5;color:#374151;margin-bottom:8px">' + esc(item.summary) + '</div>' : '') +
      '<a style="color:#2563eb" href="' + esc(item.url) + '">Offizielle Quelle öffnen</a>' +
      '</div>'
    ).join('');
    return '<h2 style="font-size:18px;margin:22px 0 8px">' + esc(provider) + '</h2>' + cards;
  }).join('');
  const impactHtml = impacts.length ?
    '<h2 style="font-size:20px;margin:28px 0 8px">NEONTRIP Impact-Check</h2>' +
    '<p style="font-size:13px;color:#4b5563;margin:0 0 10px">Vorschläge sind intern und lösen keine automatische Modelländerung aus.</p>' +
    impacts.map(impact => {
      const color = impact.priority === 'HOCH' ? '#b91c1c' : impact.priority === 'MITTEL' ? '#b45309' : '#374151';
      return '<div style="border:1px solid #d1d5db;border-left:5px solid ' + color + ';border-radius:8px;padding:14px;margin:10px 0">' +
        '<div style="font-size:12px;font-weight:700;color:' + color + '">' + esc(impact.priority) + ' · ' + esc(impact.match) + '</div>' +
        '<div style="font-size:16px;font-weight:700;margin:5px 0">' + esc(impact.target) + '</div>' +
        '<div style="font-size:12px;color:#6b7280;margin-bottom:8px">' + esc(impact.location) + '</div>' +
        '<div style="font-size:14px;margin:4px 0"><strong>Empfehlung:</strong> ' + esc(impact.action) + '</div>' +
        '<div style="font-size:14px;margin:4px 0"><strong>Chance:</strong> ' + esc(impact.chance) + '</div>' +
        '<div style="font-size:14px;margin:4px 0"><strong>Risiko:</strong> ' + esc(impact.risk) + '</div>' +
        '<div style="font-size:14px;margin:4px 0"><strong>Schutzmaßnahme:</strong> ' + esc(impact.guardrail) + '</div>' +
        '</div>';
    }).join('') : '';
  emailSubject = '[KI-Modell-Update] ' + fresh.length + ' neue Meldung' + (fresh.length === 1 ? '' : 'en') + ': ' + Object.keys(groups).join(', ');
  emailHtml = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#111827;max-width:720px;line-height:1.45">' +
    '<div style="background:#111827;color:white;border-radius:9px;padding:16px 18px">' +
    '<div style="font-size:19px;font-weight:700">Neue KI-Modell-Updates</div>' +
    '<div style="font-size:13px;color:#d1d5db;margin-top:4px">Text, Sprache/Audio, Bild und Video · nur offizielle Quellen</div></div>' +
    sections + impactHtml +
    '<p style="font-size:12px;color:#6b7280;margin-top:24px">Automatischer NEONTRIP-Monitor · ' + esc(nowBerlin) + ' (Europe/Berlin)<br>Correlation ID: ' + esc(correlationId) + '</p>' +
    '</div>';
}

return [{ json: {
  shouldEmail: fresh.length > 0,
  mode: initialized ? (fresh.length ? 'notify' : 'nochange') : 'seed',
  candidateCount: candidates.length,
  newCount: fresh.length,
  impactCount: impacts.length,
  keysToMark,
  emailTo: 'info@neontrip.de',
  emailSubject,
  emailHtml,
  correlationId,
  checkedAt: new Date().toISOString(),
} }];
`;

const recordCode = String.raw`
const result = $('Updates analysieren').first().json;
const state = $getWorkflowStaticData('global');
state.sent = state.sent && typeof state.sent === 'object' ? state.sent : {};
const stampedAt = new Date().toISOString();
for (const key of (result.keysToMark || [])) state.sent[key] = stampedAt;
state.initialized = true;
state.lastCheckedAt = result.checkedAt;
state.lastMode = result.mode;
state.lastCorrelationId = result.correlationId;

const entries = Object.entries(state.sent);
if (entries.length > 2000) {
  entries.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  for (const [key] of entries.slice(0, entries.length - 2000)) delete state.sent[key];
}

return [{ json: {
  ok: true,
  mode: result.mode,
  newCount: result.newCount,
  recordedKeys: (result.keysToMark || []).length,
  totalStoredKeys: Object.keys(state.sent).length,
  correlationId: result.correlationId,
} }];
`;

new Function(analyzeCode);
new Function(recordCode);

const httpNode = (id, name, url, outputPropertyName, x, y) => ({
  id,
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.4,
  position: [x, y],
  parameters: {
    method: 'GET',
    url,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'User-Agent', value: 'NEONTRIP-AI-Model-Update-Monitor/1.0 (+https://neontrip.de)' },
        { name: 'Accept', value: 'text/html,application/xml,text/xml,application/rss+xml;q=0.9,*/*;q=0.8' },
      ],
    },
    options: {
      timeout: 45000,
      response: { response: { responseFormat: 'text', outputPropertyName } },
      redirect: { redirect: { followRedirects: true, maxRedirects: 5 } },
    },
  },
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 15000,
  onError: 'stopWorkflow',
});

const nodes = [
  {
    id: 'schedule_6h',
    name: 'Alle 6 Stunden',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.3,
    position: [0, 320],
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '15 */6 * * *' }] } },
  },
  httpNode('openai_news', 'OpenAI News RSS', 'https://openai.com/news/rss.xml', 'openaiNews', 240, 320),
  httpNode('openai_api', 'OpenAI API Changelog', 'https://developers.openai.com/api/docs/changelog', 'openaiApi', 500, 320),
  httpNode('anthropic_release', 'Anthropic Release Notes', 'https://platform.claude.com/docs/en/release-notes/overview', 'anthropicRelease', 760, 320),
  httpNode('anthropic_sitemap', 'Anthropic News Sitemap', 'https://www.anthropic.com/sitemap.xml', 'anthropicSitemap', 1020, 320),
  httpNode('gemini_api', 'Gemini API Changelog', 'https://ai.google.dev/gemini-api/docs/changelog', 'geminiApi', 1280, 320),
  httpNode('google_ai', 'Google AI RSS', 'https://blog.google/technology/ai/rss/', 'googleAi', 1540, 320),
  {
    id: 'analyze_updates',
    name: 'Updates analysieren',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1800, 320],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: analyzeCode },
    onError: 'stopWorkflow',
  },
  {
    id: 'if_new_updates',
    name: 'Neue Updates?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [2060, 320],
    parameters: {
      options: {},
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
        combinator: 'and',
        conditions: [{
          id: 'new-updates-true',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
          leftValue: '={{ $json.shouldEmail }}',
          rightValue: '',
        }],
      },
    },
  },
  {
    id: 'send_outlook',
    name: 'Update E-Mail senden',
    type: 'n8n-nodes-base.microsoftOutlook',
    typeVersion: 2,
    position: [2320, 220],
    parameters: {
      resource: 'message',
      operation: 'send',
      toRecipients: '={{ $json.emailTo }}',
      subject: '={{ $json.emailSubject }}',
      bodyContent: '={{ $json.emailHtml }}',
      additionalFields: { bodyContentType: 'HTML' },
    },
    credentials: {
      microsoftOutlookOAuth2Api: {
        id: 'CTEmJD5CjYu9hawu',
        name: 'Microsoft Outlook support@neontrip.de',
      },
    },
    retryOnFail: true,
    maxTries: 5,
    waitBetweenTries: 60000,
    onError: 'stopWorkflow',
  },
  {
    id: 'record_sent',
    name: 'Versand protokollieren',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2580, 220],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: recordCode },
    onError: 'stopWorkflow',
  },
  {
    id: 'record_baseline',
    name: 'Stand protokollieren',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2320, 440],
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: recordCode },
    onError: 'stopWorkflow',
  },
  {
    id: 'info_note',
    name: 'Betriebsinfo',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [0, 20],
    parameters: {
      width: 1040,
      height: 220,
      content: '## KI-Modell-Update-Monitor v1.0\n\nPrüft alle 6 Stunden ausschließlich offizielle Quellen von OpenAI/ChatGPT, Anthropic/Claude und Google/Gemini auf Text-, Sprach-/Audio-, Bild- und Video-Modellupdates.\n\n**Versand:** support@neontrip.de → info@neontrip.de. Die erste erfolgreiche Ausführung setzt nur die Baseline. Danach wird pro Lauf maximal eine Sammelmail versendet. Deduplizierung erfolgt erst nach erfolgreichem Outlook-Versand.\n\n**Fehler:** Globaler Error Workflow `NEONTRIP Error Alerting v1.0`. Rollback: Workflow deaktivieren; keine externen Daten außer E-Mail-Versand.',
    },
  },
];

const chain = (node) => ({ main: [[{ node, type: 'main', index: 0 }]] });
const connections = {
  'Alle 6 Stunden': chain('OpenAI News RSS'),
  'OpenAI News RSS': chain('OpenAI API Changelog'),
  'OpenAI API Changelog': chain('Anthropic Release Notes'),
  'Anthropic Release Notes': chain('Anthropic News Sitemap'),
  'Anthropic News Sitemap': chain('Gemini API Changelog'),
  'Gemini API Changelog': chain('Google AI RSS'),
  'Google AI RSS': chain('Updates analysieren'),
  'Updates analysieren': chain('Neue Updates?'),
  'Neue Updates?': {
    main: [
      [{ node: 'Update E-Mail senden', type: 'main', index: 0 }],
      [{ node: 'Stand protokollieren', type: 'main', index: 0 }],
    ],
  },
  'Update E-Mail senden': chain('Versand protokollieren'),
};

const workflow = {
  name: 'NEONTRIP KI-Modell-Update-Monitor v1.0',
  nodes,
  connections,
  settings: {
    executionOrder: 'v1',
    timezone: 'Europe/Berlin',
    saveDataErrorExecution: 'all',
    saveDataSuccessExecution: 'none',
    executionTimeout: 300,
    errorWorkflow: 'ArT3LN25Mb1PAuBE',
  },
};

if (require.main === module) process.stdout.write(JSON.stringify(workflow));
else module.exports = { workflow, analyzeCode, recordCode };
