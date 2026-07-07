export type AutomationIssueKey =
  | "customer_email_missing"
  | "customer_email_invalid"
  | "delivery_failure"
  | "send_guard_unavailable"
  | "duplicate_guard"
  | "unknown";

export type AutomationIssueHint = {
  key: AutomationIssueKey;
  rootCause: string;
  recommendedFix: string;
  safeFix: string;
  retrySafety: string;
};

function cleanText(value: unknown, maxLength = 3000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function malformedEmailTokens(text: string) {
  return uniqueStrings(
    text
      .split(/[\s<>"'()[\]{},;]+/)
      .map((token) => token.trim().replace(/[.:!?]+$/g, ""))
      .filter((token) => token.includes("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token)),
  ).slice(0, 3);
}

export function classifyAutomationIssueText(value: unknown): AutomationIssueHint {
  const text = cleanText(value);
  const lower = text.toLowerCase();
  const malformedEmails = malformedEmailTokens(text);
  if (
    /customer[_\s-]*email.*(missing|fehlt|leer|null|undefined|required)|(?:missing|fehlt|keine).{0,40}(kunden-?e-?mail|customer[_\s-]*email|recipient|empfänger)/i.test(text)
  ) {
    return {
      key: "customer_email_missing",
      rootCause: "Die Automation hatte keine belastbare Kunden-E-Mail-Adresse für den Angebotsversand.",
      recommendedFix: "Kunden-E-Mail in der Kundenakte und im Angebot korrigieren, Fall erneut auflösen, dann erst guarded resend mit Duplicate-Check freigeben.",
      safeFix: "Kunden-E-Mail/Postfach verifizieren und in der Kundenakte korrigieren.",
      retrySafety: "Retry blockiert, bis eine echte Kunden-E-Mail belegt und der Duplicate-Mail-Check grün ist.",
    };
  }
  if (
    malformedEmails.length ||
    /(invalid|ungültig|ungueltig|syntax|domain|recipient).{0,50}(email|e-mail|mail|adresse|recipient|empfänger)|email.{0,40}(invalid|ungültig|ungueltig|syntax)/i.test(text)
  ) {
    return {
      key: "customer_email_invalid",
      rootCause: malformedEmails.length
        ? `Die gespeicherte Kunden-E-Mail wirkt unvollständig oder ungültig (${malformedEmails.join(", ")}).`
        : "Die Automation meldet eine ungültige Empfänger-/Kunden-E-Mail.",
      recommendedFix: "Korrekte Kunden-E-Mail belegen und in Kundenakte/Angebot synchronisieren; danach Company Brain erneut prüfen und guarded resend nur bei fehlendem Versandbeleg auslösen.",
      safeFix: "Ungültige Kunden-E-Mail korrigieren oder verifizieren.",
      retrySafety: "Kein Retry an die alte Adresse; erst E-Mail-Fix, dann Duplicate- und Bounce-Check.",
    };
  }
  if (/unzustellbar|undeliver|delivery status notification|recipient.*unknown|mailbox|postfach|nicht zugestellt|konnte nicht zugestellt/i.test(lower)) {
    return {
      key: "delivery_failure",
      rootCause: "Es gibt einen Zustell-/Empfängerfehler für den Angebotsversand.",
      recommendedFix: "Empfängeradresse mit Kunde/Quelle verifizieren, Bounce-Beleg prüfen, erst danach guarded resend freigeben.",
      safeFix: "Bounce/Empfängerproblem klären und Adresse korrigieren.",
      retrySafety: "Retry blockiert, solange ein aktueller Bounce für die Empfängeradresse vorliegt.",
    };
  }
  if (/(send[_\s-]*guard|guardrail|guard).{0,60}(unavailable|nicht erreichbar|ungueltig|ungültig|invalid|timeout|failed|error)|send_guard_unavailable|invalid_guard_response/i.test(lower)) {
    return {
      key: "send_guard_unavailable",
      rootCause: "Der Versand-Guard konnte keine eindeutige Freigabe liefern.",
      recommendedFix: "Keinen Angebotsversand wiederholen; Guard-/Supabase-Erreichbarkeit und bestehende Versandbelege prüfen, danach Fall erneut auswerten.",
      safeFix: "Guard-/Supabase-Fehler prüfen und Versandbelege konsolidieren.",
      retrySafety: "Retry blockiert, solange der Send-Guard keine eindeutige Freigabe liefert.",
    };
  }
  if (/(duplicate|doppelt).{0,40}(detected|gefunden|blocked|blockiert|send|sent|mail|versand)|already sent|bereits.*(gesendet|versendet)|idempotency.{0,30}(conflict|blocked|duplicate)/i.test(lower)) {
    return {
      key: "duplicate_guard",
      rootCause: "Die Automation oder Guardrail meldet Duplicate-/Idempotency-Schutz.",
      recommendedFix: "Keinen erneuten Versand auslösen; vorhandene Versandbelege, Outlook und quote_email_log prüfen.",
      safeFix: "Versandbelege konsolidieren und Projektion/Trello-Status korrigieren.",
      retrySafety: "Kein Retry ohne eindeutigen Nachweis, dass keine Kundenmail rausging.",
    };
  }
  return {
    key: "unknown",
    rootCause: "Kein spezifischer Automation-Fehlertyp erkannt.",
    recommendedFix: "n8n-Execution, Source-of-Truth-Datensatz und Versandbelege gemeinsam prüfen.",
    safeFix: "Fehlerbelege sammeln und intern eskalieren.",
    retrySafety: "Retry nur nach Duplicate-Mail-Check und idempotenter Freigabe.",
  };
}
