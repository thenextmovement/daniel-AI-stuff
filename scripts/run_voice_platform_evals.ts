import { VOICE_EVAL_SCENARIOS, VOICE_EVAL_SUITE_VERSION, VOICE_MODEL_COMPARISON_IDS, validateVoiceEvalSuite } from "../src/lib/ops/voice-platform-evals";

const suite = validateVoiceEvalSuite();
if (!suite.valid) throw new Error("Voice eval suite contract failed");

const comparison = VOICE_MODEL_COMPARISON_IDS.map((modelId) => ({
  modelId,
  suiteVersion: VOICE_EVAL_SUITE_VERSION,
  scenarioIds: VOICE_EVAL_SCENARIOS.map((entry) => entry.id),
  contractScenarioCount: VOICE_EVAL_SCENARIOS.length,
  liveQualityStatus: "requires-explicit-eval-run",
}));

process.stdout.write(`${JSON.stringify({ suite, comparison }, null, 2)}\n`);
