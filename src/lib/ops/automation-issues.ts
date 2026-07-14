export type AutomationIssueKey =
  | "customer_email_missing"
  | "customer_email_invalid"
  | "delivery_failure"
  | "send_guard_unavailable"
  | "ai_customer_copy_blocked"
  | "outlook_auth_failed"
  | "offer_api_failed"
  | "source_mapping_conflict"
  | "video_content_qc_failed"
  | "video_content_qc_unavailable"
  | "asset_processing_failed"
  | "workflow_hard_error"
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

export function isBlockingAutomationIssueKey(key: AutomationIssueKey) {
  return key !== "unknown";
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
  if (
    /ai_customer_copy_blocked|forbidden[_\s-]*word|verbotene?\s+w(?:o|ö)rter?|hard-?block|final[_\s-]*block|copy\s+blocked|e-?mail\s+blockiert/i.test(text)
  ) {
    return {
      key: "ai_customer_copy_blocked",
      rootCause: "Die Kunden-E-Mail wurde durch die Inhaltsprüfung blockiert, weil der KI-Text nach dem Retry weiterhin gesperrte Begriffe enthielt.",
      recommendedFix: "Keine Kundenmail automatisch senden; Angebots-/Prompt-Kontext und gesperrte Begriffe prüfen, danach Text manuell freigeben oder Workflow-Prompt korrigieren.",
      safeFix: "E-Mail-Text intern prüfen und erst nach fachlicher Freigabe manuell oder guarded erneut versenden.",
      retrySafety: "Retry blockiert, bis der Textinhalt geprüft ist und der Duplicate-Mail-Check grün ist.",
    };
  }
  if (
    /(outlook|graph|microsoft|msgraph).{0,90}(401|403|unauthori[sz]ed|forbidden|invalid[_\s-]*client|invalid[_\s-]*grant|access denied|insufficient|permission|mail\.read|mail\.send|token|tenant|authentication|authentifizierung)|authorization_requestdenied|invalid_client|invalid_grant/i.test(text)
  ) {
    return {
      key: "outlook_auth_failed",
      rootCause: "Outlook/Graph-Zugriff ist an Authentifizierung, Berechtigung oder Tenant-Konfiguration gescheitert.",
      recommendedFix: "Graph App, Mailbox, Berechtigungen und Application Access Policy prüfen; keinen Angebotsversand wiederholen, bis Outlook/quote_email_log eindeutig ist.",
      safeFix: "Outlook-/Graph-Konfiguration und Versandbelege intern prüfen.",
      retrySafety: "Retry blockiert, bis Graph/Outlook-Zugriff und bestehende Versandbelege geklärt sind.",
    };
  }
  if (
    /(offer|quote|angebot|angebote).{0,100}(api|endpoint|create|creation|erstell|snapshot|payload|validation|schema|http|500|timeout)|(?:api|endpoint|http|500|timeout).{0,80}(offer|quote|angebot).{0,80}(failed|error|timeout|500|schema|fehlgeschlagen|fehler)|offer_api_failed|quote_api_failed/i.test(text)
  ) {
    return {
      key: "offer_api_failed",
      rootCause: "Die Angebotsanlage oder Offer-API ist fehlgeschlagen, bevor ein belastbarer Versand bewertet werden kann.",
      recommendedFix: "Offer-API-Response, Angebots-Snapshot, Offer-Bridge und Idempotency prüfen; erst danach Versandstatus oder Retry bewerten.",
      safeFix: "Angebotsanlage/Offer-Bridge reparieren und Fall erneut laden.",
      retrySafety: "Retry blockiert, bis ein eindeutiger Angebotssnapshot und fehlender Versandbeleg vorliegen.",
    };
  }
  if (
    /source[_\s-]*mapping[_\s-]*conflict|offer[_\s-]*request[_\s-]*mismatch|request[_\s-]*mismatch|card[_\s-]*mismatch|trello[_\s-]*card[_\s-]*mismatch|offer.{0,80}(belongs|geh[oö]rt|verkn[uü]pft).{0,80}(other|ander|falsch|request|card|trello)|(?:request|trello|card).{0,80}(mismatch|conflict|konflikt|passt nicht|abweich|ander)/i.test(text)
  ) {
    return {
      key: "source_mapping_conflict",
      rootCause: "Angebot, Trello-Karte oder Kundenakte sind nicht eindeutig auf denselben Source-of-Truth-Fall verknüpft.",
      recommendedFix: "Offer-Bridge, Request-ID und Trello-Card-ID in Postgres prüfen und korrigieren; keinen E-Mail-Fix oder Angebots-Resend auslösen.",
      safeFix: "Source-of-Truth-Verknüpfung in Postgres/Offer-Bridge reparieren und Fall neu laden.",
      retrySafety: "Retry blockiert, bis Angebot, Kundenakte und Trello-Projektion eindeutig demselben Fall zugeordnet sind.",
    };
  }
  if (
    /video_content_qc_unavailable|ki-?video.{0,100}(konnte nicht sicher gepr[uü]ft|pr[uü]fung.{0,40}(nicht verf[uü]gbar|unavailable|fehlgeschlagen))|video.{0,60}qc.{0,60}(unavailable|parse|invalid|timeout)/i.test(text)
  ) {
    return {
      key: "video_content_qc_unavailable",
      rootCause: "Die Video-Inhaltsprüfung konnte kein belastbares Ergebnis liefern. Der Angebotsversand wurde vorsorglich gestoppt.",
      recommendedFix: "Genau einen automatischen Video-QC-Neuversuch zulassen. Bleibt die Prüfung unklar, Mockup und Video intern prüfen und keinen Kundenversand freigeben.",
      safeFix: "Automatischen Zweitversuch abwarten; danach Mockup und Video manuell prüfen.",
      retrySafety: "Ein automatischer Video-Neuversuch vor dem Versand ist zulässig; danach bleibt der Versand blockiert.",
    };
  }
  if (
    /video_content_qc_failed|design_morph|color_shift|invented_text|invented_object|unwanted_branding|sign_disappears|floating_sign|bad_crop|ki-?video.{0,120}(inhaltspr[uü]fung|qualit[aä]tspr[uü]fung).{0,80}(nicht bestanden|abgelehnt|failed|reject)/i.test(text)
  ) {
    const issue = text.match(/\b(DESIGN_MORPH|COLOR_SHIFT|INVENTED_TEXT|INVENTED_OBJECT|UNWANTED_BRANDING|SIGN_DISAPPEARS|FLOATING_SIGN|BAD_CROP|OTHER)\b/i)?.[1]?.toUpperCase();
    return {
      key: "video_content_qc_failed",
      rootCause: issue
        ? `Die Video-Inhaltsprüfung hat das erzeugte Video wegen ${issue} abgelehnt. Das Angebot wurde nicht versendet.`
        : "Die Video-Inhaltsprüfung hat das erzeugte Video abgelehnt. Das Angebot wurde nicht versendet.",
      recommendedFix: "Einen automatischen Zweitversuch mit demselben geprüften Mockup zulassen. Scheitert er erneut, Mockup/Logo prüfen oder neu erzeugen und erst danach einen neuen Video-Lauf freigeben.",
      safeFix: "Automatischen Zweitversuch abwarten; bei erneutem Fehler das verwendete Mockup auf Form-, Schrift- und Farbabweichungen prüfen.",
      retrySafety: "Genau ein automatischer Video-Neuversuch vor jedem Kundenversand; danach Retry blockieren, bis das Mockup geprüft oder ersetzt wurde.",
    };
  }
  if (
    /(asset|attachment|anhang|bild|image|mockup|design|download|upload|storage|s3|file|datei).{0,100}(missing|not found|404|unsupported|failed|error|timeout|fehlt|fehlgeschlagen|konnte nicht|ungueltig|ungültig)|asset_processing_failed|attachment_download_failed/i.test(text)
  ) {
    return {
      key: "asset_processing_failed",
      rootCause: "Design-/Anhang-Assets konnten nicht geladen oder verarbeitet werden.",
      recommendedFix: "Trello-/Outlook-/Offer-Anhänge und Asset-URLs prüfen; keinen Kundenversand freigeben, solange relevante Designs fehlen.",
      safeFix: "Fehlende Assets sichern oder neu verknüpfen und Angebot/Fall erneut prüfen.",
      retrySafety: "Retry blockiert, bis die für das Angebot relevanten Assets vorhanden und geprüft sind.",
    };
  }
  if (
    /workflow_hard_error|n8n workflow hard error|workflow[-_\s]*fehler|execution.{0,80}(failed|error|fehlgeschlagen)|node.{0,80}(failed|error|fehlgeschlagen)|outlook.{0,80}(send|senden|failed|error|fehler)|graph\.microsoft\.com/i.test(text)
  ) {
    return {
      key: "workflow_hard_error",
      rootCause: "Die n8n-Automation ist hart fehlgeschlagen; der betroffene Node oder API-Call muss anhand der Execution geprüft werden.",
      recommendedFix: "n8n-Execution, betroffenen Node, Outlook/quote_email_log und Duplicate-Guard prüfen; keinen Angebotsversand wiederholen, solange die Versandbeleglage unklar ist.",
      safeFix: "Execution-Fehler intern analysieren und Versandbelege konsolidieren.",
      retrySafety: "Retry blockiert, bis Ursache, Versandbeleglage und Idempotency geklärt sind.",
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
