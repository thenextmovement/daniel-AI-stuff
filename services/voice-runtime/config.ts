export type RuntimeConfig = ReturnType<typeof loadRuntimeConfig>;

const OPENAI_PROVIDER_VARIABLES = ["OPENAI_API_KEY", "OPENAI_WEBHOOK_SECRET", "OPENAI_PROJECT_ID"] as const;
const TELEPHONY_PROVIDER_VARIABLES = [
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "OPENAI_PROJECT_ID", "VOICE_SIP_BINDING_SECRET",
] as const;

function required(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(name: string) {
  return String(process.env[name] || "").trim();
}

export function getProviderReadiness(env: Record<string, string | undefined> = process.env) {
  const missingOpenAi = OPENAI_PROVIDER_VARIABLES.filter((name) => !String(env[name] || "").trim());
  const missingTelephony = TELEPHONY_PROVIDER_VARIABLES.filter((name) => !String(env[name] || "").trim());
  return {
    openAi: missingOpenAi.length === 0,
    telephony: missingTelephony.length === 0,
    dispatch: missingOpenAi.length === 0 && missingTelephony.length === 0,
    missing: [...new Set([...missingOpenAi, ...missingTelephony])],
  };
}

export function loadRuntimeConfig() {
  const publicUrl = required("VOICE_RUNTIME_PUBLIC_URL").replace(/\/+$/, "");
  const opsBaseUrl = required("VOICE_OPS_BASE_URL").replace(/\/+$/, "");
  const port = Number(process.env.PORT || 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT is invalid");
  const n8nOutcomeUrl = String(process.env.VOICE_N8N_OUTCOME_URL || "").trim();
  const n8nWebhookToken = String(process.env.VOICE_N8N_WEBHOOK_TOKEN || "").trim();
  if (Boolean(n8nOutcomeUrl) !== Boolean(n8nWebhookToken)) {
    throw new Error("VOICE_N8N_OUTCOME_URL and VOICE_N8N_WEBHOOK_TOKEN must be configured together");
  }
  return {
    port,
    publicUrl,
    opsBaseUrl,
    opsToken: required("VOICE_RUNTIME_API_TOKEN"),
    dispatchToken: required("VOICE_DISPATCH_TOKEN"),
    openAiApiKey: optional("OPENAI_API_KEY"),
    openAiWebhookSecret: optional("OPENAI_WEBHOOK_SECRET"),
    openAiProjectId: optional("OPENAI_PROJECT_ID"),
    sipBindingSecret: optional("VOICE_SIP_BINDING_SECRET"),
    twilioAccountSid: optional("TWILIO_ACCOUNT_SID"),
    twilioAuthToken: optional("TWILIO_AUTH_TOKEN"),
    twilioFromNumber: optional("TWILIO_FROM_NUMBER"),
    providerReadiness: getProviderReadiness(),
    handoffUri: String(process.env.VOICE_HUMAN_HANDOFF_URI || "").trim(),
    n8nOutcomeUrl,
    n8nWebhookToken,
    workerId: String(process.env.VOICE_RUNTIME_WORKER_ID || `voice-runtime-${process.pid}`).trim(),
    commitSha: String(process.env.SOURCE_COMMIT || process.env.GIT_COMMIT || "unknown").trim(),
  };
}
