const { analyzeCode, finalizeCode, recordCode, workflow } = require('./build-workflow');

function padded(value) {
  return value + '\n<!-- ' + 'official-source-fixture '.repeat(40) + '-->';
}

const sources = {
  'OpenAI News RSS': {
    openaiNews: padded(`<?xml version="1.0"?>
      <rss><channel><item>
        <title>GPT-4o mini model update released</title>
        <link>https://openai.com/index/gpt-4o-mini-update</link>
        <pubDate>Wed, 29 Jul 2026 10:00:00 GMT</pubDate>
        <description>Released an update for gpt-4o-mini with improved structured outputs.</description>
      </item></channel></rss>`),
  },
  'OpenAI API Changelog': {
    openaiApi: padded(`# Changelog\n\n## July, 2026\n\n### Jul 29\n\nReleased an update for gpt-4o-mini with improved structured outputs.`),
  },
  'Anthropic Release Notes': {
    anthropicRelease: padded(`
      <h2>July 28, 2026<button>Copy link</button></h2>
      <p>Released claude-sonnet-4-6 with improved tool use and JSON reliability.</p>`),
  },
  'Anthropic News Sitemap': {
    anthropicSitemap: padded(`<?xml version="1.0"?>
      <urlset><url>
        <loc>https://www.anthropic.com/news/claude-sonnet-4-6</loc>
        <lastmod>2026-07-28</lastmod>
      </url></urlset>`),
  },
  'Gemini API Changelog': {
    geminiApi: padded(`
      <h2>July 30, 2026</h2>
      <p>Gemini Robotics ER 2 in public preview: Released two new embodied reasoning model endpoints for robotics:</p>
      <ul>
        <li>gemini-robotics-er-2-preview: Advanced spatial reasoning, agentic code execution, multi-step tool orchestration, video moment finding, progress classification, and multi-robot coordination.</li>
        <li>gemini-robotics-er-2-streaming-preview: Real-time text streaming with bidirectional audio and video input.</li>
      </ul>
      <p>Deprecation announcement: gemini-robotics-er-1.6-preview will be shut down on August 31, 2026. Use gemini-robotics-er-2-preview instead.</p>
      <h2>April 14, 2026</h2>
      <p>Released gemini-robotics-er-1.6-preview, our updated robotics model.</p>`),
  },
  'Google AI RSS': {
    googleAi: padded(`<?xml version="1.0"?>
      <rss><channel><item>
        <title>Gemini 3 Pro Image model update</title>
        <link>https://blog.google/technology/ai/gemini-3-pro-image-update/</link>
        <pubDate>Tue, 28 Jul 2026 09:00:00 GMT</pubDate>
        <description>Released an update for gemini-3-pro-image.</description>
      </item></channel></rss>`),
  },
  'xAI Release Notes': {
    xaiRelease: padded(`# Release Notes\n\n## September\n\n### Grok 4.7\n\nReleased grok-4.7, now available with improved tool use. See [announcement](https://x.ai/news/grok-4-7).\n\n### Grok Voice\n\nReleased grok-voice-think-fast-2.0.`),
  },
  'xAI Modellkatalog': {
    xaiModels: padded(`# Models\n\n| Model | Input |\n| --- | --- |\n| grok-4.7 (< 200k) | $2 |\n| grok-4.7 (>= 200k) | $4 |\n| grok-imagine-image-2.0 | $0.04 |`),
  },
};

const state = {};
const $execution = { id: 'local-parser-test' };
const $now = { setZone: () => ({ toFormat: () => '30.07.2026 19:30' }) };
const sourceAccessor = (name) => ({ first: () => ({ json: sources[name] }) });
const $getWorkflowStaticData = () => state;
const runAnalyze = new Function('$', '$getWorkflowStaticData', '$execution', '$now', analyzeCode);

const seed = runAnalyze(sourceAccessor, $getWorkflowStaticData, $execution, $now)[0].json;
if (seed.mode !== 'seed' || seed.shouldEmail !== false) throw new Error('Initial run must seed without email');
if (seed.schemaVersion !== 3 || seed.candidateCount < 8) throw new Error('Unexpected parser/schema output');

state.initialized = true;
state.schemaVersion = seed.schemaVersion;
state.sent = Object.fromEntries(seed.keysToMark.map(key => [key, new Date().toISOString()]));
const unchanged = runAnalyze(sourceAccessor, $getWorkflowStaticData, $execution, $now)[0].json;
if (unchanged.mode !== 'nochange' || unchanged.newCount !== 0) throw new Error('Deduplication failed');

state.schemaVersion = 1;
const migration = runAnalyze(sourceAccessor, $getWorkflowStaticData, $execution, $now)[0].json;
if (migration.mode !== 'key-migration' || migration.shouldEmail !== false || migration.keysToMark.length < 4) {
  throw new Error('Schema migration must establish a silent baseline');
}
state.schemaVersion = 3;

state.sent = {};
const allFresh = runAnalyze(sourceAccessor, $getWorkflowStaticData, $execution, $now)[0].json;
const robotics = allFresh.freshItems.find(item => item.provider === 'Gemini' && item.date === 'July 30, 2026');
if (!robotics) throw new Error('Robotics fixture was not parsed');
if (!robotics.modelIds.includes('gemini-robotics-er-2-preview') ||
    !robotics.modelIds.includes('gemini-robotics-er-2-streaming-preview') ||
    !robotics.modelIds.includes('gemini-robotics-er-1.6-preview')) {
  throw new Error('Model IDs were not extracted completely');
}

state.sent = Object.fromEntries(allFresh.freshItems.map(item => [item.key, new Date().toISOString()]));
delete state.sent[robotics.key];
const roboticsOnly = runAnalyze(sourceAccessor, $getWorkflowStaticData, $execution, $now)[0].json;
if (roboticsOnly.mode !== 'notify' || roboticsOnly.newCount !== 1) throw new Error('Single-event detection failed');

const germanSummary = {
  summaries: [{
    key: robotics.key,
    bullets: [
      'Gemini Robotics ER 2 ist mit zwei neuen Modell-Endpunkten als Public Preview verfügbar.',
      'Die Modelle analysieren unter anderem Video-Eingaben; sie erzeugen selbst keine Videos.',
      'Gemini Robotics ER 1.6 wird laut Quelle am 31. August 2026 abgeschaltet.',
    ],
    modelEvents: [
      { modelId: 'gemini-robotics-er-2-preview', eventType: 'preview' },
      { modelId: 'gemini-robotics-er-2-streaming-preview', eventType: 'preview' },
      { modelId: 'gemini-robotics-er-1.6-preview', eventType: 'shutdown' },
    ],
  }],
};

function runFinalize(analysis, aiOutput) {
  const $ = (name) => {
    if (name === 'Updates analysieren') return { first: () => ({ json: analysis }) };
    throw new Error('Unexpected node reference: ' + name);
  };
  const $input = { first: () => ({ json: aiOutput }) };
  return new Function('$', '$input', finalizeCode)($, $input)[0].json;
}

const roboticsEmail = runFinalize(roboticsOnly, germanSummary);
if (!roboticsEmail.emailHtml.includes('Wichtige Punkte') ||
    !roboticsEmail.emailHtml.includes('Public Preview verfügbar') ||
    !roboticsEmail.emailHtml.includes('Offizielle Quelle öffnen')) {
  throw new Error('German bullet summary or official link missing');
}
if (roboticsEmail.impactCount !== 0 ||
    /9FoJMH6OUdsi36FB|HIFQvcfBKPEK9oSN|Runway|S4gjf0YeZjP0pqFR/.test(roboticsEmail.emailHtml)) {
  throw new Error('Unrelated workflow/provider impact leaked into Robotics alert');
}
if (!roboticsEmail.emailHtml.includes('Keine direkte Übereinstimmung')) {
  throw new Error('No-impact explanation missing');
}

const exactGeminiAnalysis = {
  ...roboticsOnly,
  newCount: 1,
  freshItems: [{
    ...robotics,
    key: 'gemini-exact-current-model',
    title: 'Gemini 3.5 Flash Update',
    summary: 'Released an update for gemini-3.5-flash.',
    modelIds: ['gemini-3.5-flash'],
    eventType: 'update',
    inferredAffectedModelIds: ['gemini-3.5-flash'],
  }],
};
const exactGeminiEmail = runFinalize(exactGeminiAnalysis, {
  summaries: [{
    key: 'gemini-exact-current-model',
    bullets: [
      'Google hat ein Update für Gemini 3.5 Flash veröffentlicht.',
      'Die verbindlichen Details stehen in der offiziellen Quelle.',
    ],
    modelEvents: [{ modelId: 'gemini-3.5-flash', eventType: 'update' }],
  }],
});
if (!exactGeminiEmail.emailHtml.includes('S4gjf0YeZjP0pqFR') ||
    !exactGeminiEmail.emailHtml.includes('vseFp5GZU975CeOM') ||
    exactGeminiEmail.emailHtml.includes('T4mdDxLquLMJ6FMl')) {
  throw new Error('Exact dependency matching failed');
}

const fallbackEmail = runFinalize(roboticsOnly, { invalid: true });
if (fallbackEmail.summaryMode !== 'mixed-fallback' ||
    !fallbackEmail.emailHtml.includes('Genannte Modell-IDs') ||
    fallbackEmail.impactCount !== 0 ||
    fallbackEmail.impactUncertainCount !== 1 ||
    !fallbackEmail.emailHtml.includes('keine Workflow-Treffer ausgegeben')) {
  throw new Error('Validated German fallback failed');
}

if (workflow.nodes.length !== 17) throw new Error('Unexpected workflow node count');
if (!workflow.nodes.some(node => node.name === 'Deutsche Key Points erstellen') ||
    !workflow.nodes.some(node => node.name === 'E-Mail finalisieren')) {
  throw new Error('Summary/finalizer nodes missing');
}

const xaiItems = allFresh.freshItems.filter(item => item.provider === 'xAI');
if (xaiItems.length !== 4 || !xaiItems.some(item => item.modelIds.includes('grok-4.7'))) {
  throw new Error('xAI sources or repeated catalog-row deduplication failed');
}
if (xaiItems.some(item => item.modelIds.includes('grok-4-7'))) throw new Error('URL slug mistaken for model ID');
if (!allFresh.freshItems.some(item => item.provider === 'Anthropic' && item.date === 'July 28, 2026')) {
  throw new Error('Anthropic heading controls broke dated extraction');
}
for (const name of ['OpenAI API Changelog', 'Anthropic Release Notes', 'xAI Release Notes', 'xAI Modellkatalog']) {
  const savedSource = sources[name];
  sources[name] = Object.fromEntries(Object.keys(savedSource).map(field => [field, padded('<html>Unknown page</html>')]));
  let rejected = false;
  try { runAnalyze(sourceAccessor, $getWorkflowStaticData, $execution, $now); } catch { rejected = true; }
  sources[name] = savedSource;
  if (!rejected) throw new Error('Invalid source silently accepted: ' + name);
}
state.sent = {};
const beforeSending = JSON.stringify(state);
const pending = runAnalyze(sourceAccessor, $getWorkflowStaticData, $execution, $now)[0].json;
if (JSON.stringify(state) !== beforeSending) throw new Error('Analysis persisted keys before sending');
const record = new Function('$', '$getWorkflowStaticData', recordCode);
record(() => ({ first: () => ({ json: pending }) }), $getWorkflowStaticData);
const replay = runAnalyze(sourceAccessor, $getWorkflowStaticData, $execution, $now)[0].json;
if (replay.newCount !== 0 || replay.shouldEmail) throw new Error('Successful-send replay notified twice');
sources['OpenAI API Changelog'].openaiApi = sources['OpenAI API Changelog'].openaiApi.replace('improved structured outputs', 'improved reliable structured outputs');
if (runAnalyze(sourceAccessor, $getWorkflowStaticData, $execution, $now)[0].json.newCount !== 0) {
  throw new Error('OpenAI prose edit changed stable event identity');
}
sources['xAI Release Notes'].xaiRelease += '\n\n### Grok 4.8\n\nReleased grok-4.8 with new multimodal features.';
const xaiNew = runAnalyze(sourceAccessor, $getWorkflowStaticData, $execution, $now)[0].json;
if (xaiNew.newCount !== 1 || xaiNew.freshItems[0].provider !== 'xAI') throw new Error('New xAI event not isolated');
if (workflow.nodes.find(node => node.id === 'schedule_6h').parameters.rule.interval[0].expression !== '15 */6 * * *') {
  throw new Error('Six-hour schedule changed');
}

let liveEvidence;
if (process.argv[2]) {
  const fs = require('fs');
  const path = require('path');
  const fields = {
    'OpenAI News RSS': 'openaiNews', 'OpenAI API Changelog': 'openaiApi',
    'Anthropic Release Notes': 'anthropicRelease', 'Anthropic News Sitemap': 'anthropicSitemap',
    'Gemini API Changelog': 'geminiApi', 'Google AI RSS': 'googleAi',
    'xAI Release Notes': 'xaiRelease', 'xAI Modellkatalog': 'xaiModels',
  };
  const liveAccessor = name => ({ first: () => ({ json: {
    [fields[name]]: fs.readFileSync(path.join(process.argv[2], (name === 'OpenAI API Changelog' ? 'openaiApiMarkdown' : fields[name]) + '.txt'), 'utf8'),
  } }) });
  const liveState = process.argv[3]
    ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).staticData.global
    : { initialized: true, schemaVersion: 2, sent: { 'previously-sent': '2026-09-28T07:15:06Z' } };
  const oldKeys = Object.keys(liveState.sent);
  const baseline = runAnalyze(liveAccessor, () => liveState, $execution, $now)[0].json;
  if (baseline.mode !== 'key-migration' || baseline.shouldEmail) throw new Error('Live baseline must not send');
  record(() => ({ first: () => ({ json: baseline }) }), () => liveState);
  if (oldKeys.some(key => !liveState.sent[key])) throw new Error('Existing sent key lost in migration');
  const liveReplay = runAnalyze(liveAccessor, () => liveState, $execution, $now)[0].json;
  if (liveReplay.newCount || liveReplay.shouldEmail) throw new Error('Live replay must not send');
  const findings = runAnalyze(liveAccessor, () => ({ initialized: true, schemaVersion: 3, sent: {} }), $execution, $now)[0].json;
  liveEvidence = { candidates: baseline.candidateCount, preservedSentKeys: oldKeys.length, replayMode: liveReplay.mode,
    providerCounts: findings.freshItems.reduce((counts, item) => ({ ...counts, [item.provider]: (counts[item.provider] || 0) + 1 }), {}) };
}

process.stdout.write(JSON.stringify({
  seedCandidates: seed.candidateCount,
  unchangedMode: unchanged.mode,
  migrationMode: migration.mode,
  roboticsModelIds: robotics.modelIds,
  roboticsImpactCount: roboticsEmail.impactCount,
  exactGeminiImpactCount: exactGeminiEmail.impactCount,
  fallbackMode: fallbackEmail.summaryMode,
  liveEvidence,
}, null, 2));
