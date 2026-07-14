const fs = require('fs');
const { analyzeCode } = require('./build-workflow');

const sources = {
  'OpenAI News RSS': { openaiNews: fs.readFileSync('/tmp/openai-news.xml', 'utf8') },
  'OpenAI API Changelog': { openaiApi: fs.readFileSync('/tmp/openai-api.html', 'utf8') },
  'Anthropic Release Notes': { anthropicRelease: fs.readFileSync('/tmp/anthropic-release.html', 'utf8') },
  'Anthropic News Sitemap': { anthropicSitemap: fs.readFileSync('/tmp/anthropic-sitemap.xml', 'utf8') },
  'Gemini API Changelog': { geminiApi: fs.readFileSync('/tmp/gemini-api.html', 'utf8') },
  'Google AI RSS': { googleAi: fs.readFileSync('/tmp/google-ai.xml', 'utf8') },
};

const $ = (name) => ({ first: () => ({ json: sources[name] }) });
const state = {};
const $getWorkflowStaticData = () => state;
const $execution = { id: 'local-parser-test' };
const $now = { setZone: () => ({ toFormat: () => '14.07.2026 21:30' }) };
const run = new Function('$', '$getWorkflowStaticData', '$execution', '$now', analyzeCode);
const output = run($, $getWorkflowStaticData, $execution, $now);

if (!Array.isArray(output) || !output[0] || output[0].json.mode !== 'seed') {
  throw new Error('Unexpected parser output');
}
if (output[0].json.candidateCount < 3) throw new Error('Too few model-update candidates');
state.initialized = true;
state.sent = Object.fromEntries(output[0].json.keysToMark.map(key => [key, new Date().toISOString()]));
const unchanged = run($, $getWorkflowStaticData, $execution, $now);
if (unchanged[0].json.mode !== 'nochange' || unchanged[0].json.newCount !== 0) {
  throw new Error('Deduplication failed for unchanged sources');
}

delete state.sent[output[0].json.keysToMark[0]];
const changed = run($, $getWorkflowStaticData, $execution, $now);
if (changed[0].json.mode !== 'notify' || changed[0].json.newCount !== 1) {
  throw new Error('New-update detection failed');
}
if (changed[0].json.emailTo !== 'info@neontrip.de' || !changed[0].json.emailHtml.includes('Offizielle Quelle')) {
  throw new Error('Email payload validation failed');
}
if (changed[0].json.impactCount < 1 || !changed[0].json.emailHtml.includes('NEONTRIP Impact-Check')) {
  throw new Error('NEONTRIP impact recommendations missing');
}
if (!/Chance:<\/strong>|Risiko:<\/strong>|Schutzmaßnahme:<\/strong>/.test(changed[0].json.emailHtml)) {
  throw new Error('Impact chance/risk/guardrail content missing');
}

process.stdout.write(JSON.stringify({
  baselineCandidates: output[0].json.candidateCount,
  unchangedMode: unchanged[0].json.mode,
  simulatedNewCount: changed[0].json.newCount,
  simulatedImpactCount: changed[0].json.impactCount,
  simulatedSubject: changed[0].json.emailSubject,
}, null, 2));
