import type { VoiceCustomerContext } from "./voice-knowledge";
import type { VoiceCopilotSuggestion } from "./voice-copilot";

const common = new Set("aber alle bitte danke dass diese dieser dieses durch eine einer einen eine einem jetzt keine können lassen machen meine nicht noch oder schon sein sind über und uns unser unsere viele welcher welche welche wir wird wurde würde würden zur zum".split(" "));

function terms(text: string) {
  return new Set((text.toLocaleLowerCase("de").match(/[\p{L}\p{N}]{3,}/gu) || []).filter(word => !common.has(word)));
}

export function findVoiceMailHint(question: string, messages: VoiceCustomerContext["outlook"]): VoiceCopilotSuggestion | null {
  const words = terms(question);
  let best = 1;
  let match: VoiceCustomerContext["outlook"][number] | undefined;
  for (const mail of messages) {
    if (mail.scope !== "contact" || !mail.preview?.trim()) continue;
    const evidence = terms(mail.subject + " " + mail.preview);
    const score = [...words].filter(word => evidence.has(word)).length;
    if (score > best) { best = score; match = mail; }
  }
  if (!match) return null;
  return { kind: "answer", text: match.preview!.trim(), reason: "Aus der E-Mail: " + match.subject,
    sourceLabels: ["Outlook"], confidence: 1 };
}
