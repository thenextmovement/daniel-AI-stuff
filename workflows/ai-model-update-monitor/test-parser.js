const { analyzeCode, finalizeCode, workflow } = require('./build-workflow');

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
    openaiApi: padded(`
      <h2>July 29, 2026</h2>
      <p>Released an update for gpt-4o-mini with improved structured outputs.</p>`),
  },
  'Anthropic Release Notes': {
    anthropicRelease: padded(`
      <h2>July 28, 2026</h2>
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
};

const state = {};
const $execution = { id: 'local-parser-test' };
const $now = { setZone: () => ({ toFormat: () => '30.07.2026 19:30' }) };
const sourceAccessor = (name) => ({ first: () => ({ json: sources[name] }) });
const $getWorkflowStaticData = () => state;
const runAnalyze = new Function('$', '$getWorkflowStaticData', '$execution', '$now', analyzeCode);

const seed = runAnalyze(sourceAccessor, $getWorkflowStaticData, $execution, $now)[0].json;
if (seed.mode !== 'seed' || seed.shouldEmail !== false) throw new Error('Initial run must seed without email');
if (seed.schemaVersion !== 2 || seed.candidateCount < 4) throw new Error('Unexpected parser/schema output');

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
state.schemaVersion = 2;

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

if (workflow.nodes.length !== 15) throw new Error('Unexpected workflow node count');
if (!workflow.nodes.some(node => node.name === 'Deutsche Key Points erstellen') ||
    !workflow.nodes.some(node => node.name === 'E-Mail finalisieren')) {
  throw new Error('Summary/finalizer nodes missing');
}

process.stdout.write(JSON.stringify({
  seedCandidates: seed.candidateCount,
  unchangedMode: unchanged.mode,
  migrationMode: migration.mode,
  roboticsModelIds: robotics.modelIds,
  roboticsImpactCount: roboticsEmail.impactCount,
  exactGeminiImpactCount: exactGeminiEmail.impactCount,
  fallbackMode: fallbackEmail.summaryMode,
}, null, 2));
