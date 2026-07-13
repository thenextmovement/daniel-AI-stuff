export type RuntimeConfig = ReturnType<typeof loadRuntimeConfig>;

function required(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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
    openAiApiKey: required("OPENAI_API_KEY"),
    openAiWebhookSecret: required("OPENAI_WEBHOOK_SECRET"),
    openAiProjectId: required("OPENAI_PROJECT_ID"),
    sipBindingSecret: required("VOICE_SIP_BINDING_SECRET"),
    twilioAccountSid: required("TWILIO_ACCOUNT_SID"),
    twilioAuthToken: required("TWILIO_AUTH_TOKEN"),
    twilioFromNumber: required("TWILIO_FROM_NUMBER"),
    handoffUri: String(process.env.VOICE_HUMAN_HANDOFF_URI || "").trim(),
    n8nOutcomeUrl,
    n8nWebhookToken,
    workerId: String(process.env.VOICE_RUNTIME_WORKER_ID || `voice-runtime-${process.pid}`).trim(),
    commitSha: String(process.env.SOURCE_COMMIT || process.env.GIT_COMMIT || "unknown").trim(),
  };
}
