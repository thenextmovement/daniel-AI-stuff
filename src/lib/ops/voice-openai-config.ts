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

export function getVoiceCopilotSuggestionModel() {
  return String(
    process.env.VOICE_COPILOT_SUGGESTION_MODEL
      || process.env.VOICE_COPILOT_EXTRACTION_MODEL
      || process.env.OPS_COPILOT_OPENAI_MODEL
      || "",
  ).trim();
}

export function getVoiceCopilotTranscriptionModel() {
  return String(process.env.VOICE_COPILOT_TRANSCRIPTION_MODEL || "gpt-realtime-whisper").trim();
}

export function isVoiceLiveCopilotEnabled() {
  return String(process.env.VOICE_LIVE_COPILOT_ENABLED || "").trim().toLowerCase() === "true";
}
