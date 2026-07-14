export function getVoiceOpenAiApiKey() {
  return String(process.env.OPS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
}

export function getVoiceCopilotExtractionModel() {
  return String(
    process.env.VOICE_COPILOT_EXTRACTION_MODEL
      || process.env.OPS_COPILOT_OPENAI_MODEL
      || "",
  ).trim();
}
