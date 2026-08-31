import { createHash } from "node:crypto";
import {
  getCompanyBrainActionPolicy,
  proposeCompanyBrainActionRun,
} from "@/lib/ops/company-brain-action-governance";
import type { CompanyBrainActor } from "@/lib/ops/company-brain-access";
import { createOpsInternalTask } from "@/lib/ops/internal-tasks";
import { recordWorkflowAuditEvent } from "@/lib/ops/workflow-audit";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

const AUTOMATION_ACTOR: CompanyBrainActor = {
  email: "outlook-bounce-automation@neontrip.de",
  roles: ["operator"],
  identified: true,
  local: false,
};

const KNOWN_PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "gmx.de",
  "web.de",
  "outlook.com",
  "hotmail.com",
  "yahoo.de",
  "yahoo.com",
  "t-online.de",
  "icloud.com",
  "freenet.de",
] as const;

type CustomerMatchRow = {
  request_id?: string | null;
  email?: string | null;
  original_email?: string | null;
  name?: string | null;
  company?: string | null;
};

type RequestMatchRow = {
  request_id: string;
  trello_card_id?: string | null;
  title?: string | null;
};

export type OutlookBounceIntakeInput = {
  message_id?: string | null;
  internet_message_id?: string | null;
  direction?: string | null;
  matched_email?: string | null;
  to_emails?: unknown;
  subject?: string | null;
  body_preview?: string | null;
  received_at?: string | null;
  workflow_id?: string | null;
  execution_id?: string | number | null;
};

export type EmailBounceAnalysis = {
  isBounce: boolean;
  reasonCode: "domain_not_found" | "unknown_recipient" | "delivery_failure" | null;
  failedEmail: string | null;
  suggestedEmail: string | null;
  suggestionBasis: "known_provider_domain_single_edit" | null;
  confidence: "high" | null;
};

export type EmailBounceRecoveryDeps = {
  findCustomerMatches(email: string): Promise<CustomerMatchRow[]>;
  findRequest(requestId: string): Promise<RequestMatchRow | null>;
  createTask: typeof createOpsInternalTask;
  getActionPolicy: typeof getCompanyBrainActionPolicy;
  proposeActionRun: typeof proposeCompanyBrainActionRun;
  recordAudit: typeof recordWorkflowAuditEvent;
};

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function normalizeEmail(value: unknown) {
  const email = cleanText(value, 320).toLowerCase().replace(/^[<\s]+|[>\s,;:.]+$/g, "");
  return /^[^\s@<>]+@[^\s@<>]+$/.test(email) ? email : null;
}

function oneEditOrAdjacentTransposition(left: string, right: string) {
  if (left === right || Math.abs(left.length - right.length) > 1) return false;

  if (left.length === right.length) {
    const differences: number[] = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) differences.push(index);
      if (differences.length > 2) return false;
    }
    if (differences.length === 1) return true;
    return differences.length === 2
      && differences[1] === differences[0] + 1
      && left[differences[0]] === right[differences[1]]
      && left[differences[1]] === right[differences[0]];
  }

  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex += 1;
  }
  return true;
}

export function suggestKnownProviderEmailCorrection(emailInput: unknown) {
  const email = normalizeEmail(emailInput);
  if (!email) return null;
  const separator = email.lastIndexOf("@");
  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  if (!localPart || !domain || KNOWN_PERSONAL_EMAIL_DOMAINS.includes(domain as typeof KNOWN_PERSONAL_EMAIL_DOMAINS[number])) {
    return null;
  }

  const candidates = KNOWN_PERSONAL_EMAIL_DOMAINS.filter((knownDomain) => oneEditOrAdjacentTransposition(domain, knownDomain));
  if (candidates.length !== 1) return null;
  return `${localPart}@${candidates[0]}`;
}

function emailCandidates(input: OutlookBounceIntakeInput) {
  const values: unknown[] = [input.matched_email];
  if (Array.isArray(input.to_emails)) values.push(...input.to_emails);
  const text = `${cleanText(input.subject, 500)} ${cleanText(input.body_preview, 5000)}`;
  values.push(...(text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/gi) || []));
  return [...new Set(values.map(normalizeEmail).filter((value): value is string => Boolean(value)))]
    .filter((email) => !/@(?:neontrip\.de|neontrip\.com)$/i.test(email));
}

export function analyzeOutlookBounce(input: OutlookBounceIntakeInput): EmailBounceAnalysis {
  const subject = cleanText(input.subject, 500);
  const bodyPreview = cleanText(input.body_preview, 5000);
  const text = `${subject} ${bodyPreview}`.toLowerCase();
  const strongSubject = /unzustellbar|undeliver(?:able|ed)?|delivery status notification|mail delivery (?:failed|subsystem)/i.test(subject);
  const deliveryFailureText = /nicht zugestellt|nachrichtenzustellung|requested action not taken|recipient.*unknown|unknown recipient|mailbox unavailable|domäne.*nicht vorhanden|domain.*(?:does not exist|not found)|\b550\b|\b5\.1\.\d+\b/i.test(text);
  const isBounce = cleanText(input.direction, 40).toLowerCase() === "inbound" && (strongSubject || deliveryFailureText);
  if (!isBounce) {
    return {
      isBounce: false,
      reasonCode: null,
      failedEmail: null,
      suggestedEmail: null,
      suggestionBasis: null,
      confidence: null,
    };
  }

  const failedEmail = emailCandidates(input)[0] || null;
  const suggestedEmail = failedEmail ? suggestKnownProviderEmailCorrection(failedEmail) : null;
  const reasonCode = /domäne.*nicht vorhanden|domain.*(?:does not exist|not found)|dns/i.test(text)
    ? "domain_not_found"
    : /recipient.*unknown|unknown recipient|mailbox unavailable|postfach.*nicht verfügbar|\b5\.1\.(?:1|351)\b/i.test(text)
      ? "unknown_recipient"
      : "delivery_failure";

  return {
    isBounce: true,
    reasonCode,
    failedEmail,
    suggestedEmail,
    suggestionBasis: suggestedEmail ? "known_provider_domain_single_edit" : null,
    confidence: suggestedEmail ? "high" : null,
  };
}

async function findCustomerMatches(email: string) {
  const select = "request_id,email,original_email,name,company";
  const [currentRows, originalRows] = await Promise.all([
    supabaseRequest<CustomerMatchRow[]>("master_customers", undefined, {
      select,
      email: `eq.${email}`,
      limit: 20,
    }),
    supabaseRequest<CustomerMatchRow[]>("master_customers", undefined, {
      select,
      original_email: `eq.${email}`,
      limit: 20,
    }),
  ]);
  const unique = new Map<string, CustomerMatchRow>();
  for (const row of [...currentRows, ...originalRows]) {
    const requestId = cleanText(row.request_id, 180);
    if (requestId) unique.set(requestId, row);
  }
  return [...unique.values()];
}

async function findRequest(requestId: string) {
  const rows = await supabaseRequest<RequestMatchRow[]>("master_requests", undefined, {
    select: "request_id,trello_card_id,title",
    request_id: `eq.${requestId}`,
    limit: 1,
  });
  return rows[0] || null;
}

export const defaultEmailBounceRecoveryDeps: EmailBounceRecoveryDeps = {
  findCustomerMatches,
  findRequest,
  createTask: createOpsInternalTask,
  getActionPolicy: getCompanyBrainActionPolicy,
  proposeActionRun: proposeCompanyBrainActionRun,
  recordAudit: recordWorkflowAuditEvent,
};

export async function processOutlookBounce(
  input: OutlookBounceIntakeInput,
  deps: EmailBounceRecoveryDeps = defaultEmailBounceRecoveryDeps,
) {
  const analysis = analyzeOutlookBounce(input);
  if (!analysis.isBounce) {
    return {
      ok: true,
      status: "ignored" as const,
      reason: "not_a_delivery_failure",
      customerCommunicationSent: false,
      customerDataChanged: false,
    };
  }
  if (!analysis.failedEmail) {
    throw new QuoteValidationError(
      "Bounce ohne eindeutige Empfängeradresse.",
      ["failed_recipient_missing"],
      422,
    );
  }

  const messageIdentity = cleanText(input.message_id || input.internet_message_id, 500);
  if (!messageIdentity) {
    throw new QuoteValidationError(
      "Bounce ohne stabile Nachrichten-ID.",
      ["message_id_required_for_idempotency"],
      422,
    );
  }

  const messageHash = createHash("sha256").update(messageIdentity).digest("hex").slice(0, 32);
  const sourceRef = `outlook-email-bounce:${messageHash}:v1`;
  const customerMatches = await deps.findCustomerMatches(analysis.failedEmail);
  const distinctRequestIds = [...new Set(customerMatches.map((row) => cleanText(row.request_id, 180)).filter(Boolean))];
  const requestId = distinctRequestIds.length === 1 ? distinctRequestIds[0] : null;
  const customer = requestId ? customerMatches.find((row) => cleanText(row.request_id, 180) === requestId) || null : null;
  const request = requestId ? await deps.findRequest(requestId) : null;
  const suggestionLine = analysis.suggestedEmail
    ? `Deterministischer Vorschlag: ${analysis.suggestedEmail} (bekannte Provider-Domain, genau eine Zeichenänderung).`
    : "Kein eindeutiger deterministischer Adressvorschlag. Adresse muss manuell oder über einen zweiten Kanal verifiziert werden.";
  const correlationLine = requestId
    ? `Kanonische Anfrage: ${requestId}.`
    : distinctRequestIds.length > 1
      ? `Mehrdeutige Zuordnung: ${distinctRequestIds.length} Anfragen verwenden diese Adresse.`
      : "Keine kanonische Anfrage wurde über die fehlerhafte Adresse gefunden.";

  const task = await deps.createTask({
    title: `E-Mail-Zustellung prüfen: ${analysis.failedEmail}`,
    description: [
      "Outlook hat einen Zustellfehler gemeldet.",
      `Fehlerhafte Adresse: ${analysis.failedEmail}`,
      `Fehlerklasse: ${analysis.reasonCode}`,
      suggestionLine,
      correlationLine,
      "Es wurde keine Mail gesendet und keine Kundendatei verändert.",
      "Nächster Schritt: Vorschlag gegen Anfrage/Kundennachweis prüfen und die Datenkorrektur separat freigeben.",
    ].join("\n"),
    status: "open",
    priority: analysis.suggestedEmail ? "high" : "normal",
    category: "problem",
    requestId,
    customerName: cleanText(customer?.name || customer?.company || request?.title, 240) || null,
    customerEmail: analysis.failedEmail,
    trelloCardId: request?.trello_card_id || null,
    sourceApp: "outlook_email_bounce_recovery",
    sourceRef,
    metadata: {
      company_brain_action: "prepare_email_correction",
      failed_email: analysis.failedEmail,
      suggested_email: analysis.suggestedEmail,
      suggestion_basis: analysis.suggestionBasis,
      suggestion_confidence: analysis.confidence,
      reason_code: analysis.reasonCode,
      message_identity_hash: messageHash,
      matched_request_count: distinctRequestIds.length,
      customer_communication_sent: false,
      customer_data_changed: false,
    },
  }, { operatorName: AUTOMATION_ACTOR.email });

  let actionRun: Awaited<ReturnType<typeof proposeCompanyBrainActionRun>> | null = null;
  if (requestId && analysis.suggestedEmail) {
    const policy = await deps.getActionPolicy("correct_customer_email");
    if (
      policy.actionKey !== "correct_customer_email"
      || !policy.requiresFourEyes
      || !policy.approvalRole
      || policy.customerSideEffect
    ) {
      throw new QuoteValidationError(
        "Sicherheitsrichtlinie für die E-Mail-Korrektur ist nicht freigabefähig.",
        ["email_correction_policy_mismatch"],
        409,
      );
    }
    actionRun = await deps.proposeActionRun({
      policy,
      actor: AUTOMATION_ACTOR,
      caseKey: `request:${requestId}`,
      requestId,
      frozenInput: {
        actionKey: "correct_customer_email",
        requestId,
        problemType: "automation_failed",
        confirmed: true,
        confirmationText: "Freigabe",
        recipientEmail: analysis.failedEmail,
        newCustomerEmail: analysis.suggestedEmail,
        trelloCardId: request?.trello_card_id || null,
        note: `Outlook-Bounce ${analysis.reasonCode}; deterministischer Provider-Domain-Vorschlag.`,
      },
      preview: {
        actionKey: "correct_customer_email",
        requestId,
        trelloCardId: request?.trello_card_id || null,
        currentEmail: analysis.failedEmail,
        proposedEmail: analysis.suggestedEmail,
        suggestionBasis: analysis.suggestionBasis,
        confidence: analysis.confidence,
        reasonCode: analysis.reasonCode,
        messageIdentityHash: messageHash,
        customerCommunicationSent: false,
      },
    });
  }

  const audit = await deps.recordAudit({
    workflowName: "NEONTRIP Outlook Customer Email Sync v1.0",
    workflowId: cleanText(input.workflow_id, 180) || null,
    action: "email_bounce_detected",
    status: actionRun ? "awaiting_approval" : "prepared",
    requestId,
    documentId: requestId || `outlook-message:${messageHash}`,
    trelloCardId: request?.trello_card_id || null,
    executionId: cleanText(input.execution_id, 180) || null,
    sourceEventId: messageHash,
    idempotencyKey: sourceRef,
    errorMessage: "delivery_failure",
    summary: analysis.suggestedEmail
      ? "Zustellfehler erkannt; deterministischer Adressvorschlag wartet auf Freigabe."
      : "Zustellfehler erkannt; manuelle Adressprüfung erforderlich.",
    retrySafety: "blocked",
    safeActionKey: "correct_customer_email",
    terminal: true,
    eventType: "email_bounce_detected",
    customer_communication_sent: false,
    metadata: {
      audit_event_key: `workflow-audit:${sourceRef}`,
      failed_email: analysis.failedEmail,
      suggested_email: analysis.suggestedEmail,
      suggestion_basis: analysis.suggestionBasis,
      suggestion_confidence: analysis.confidence,
      reason_code: analysis.reasonCode,
      matched_request_count: distinctRequestIds.length,
      action_run_id: actionRun?.run.id || null,
      task_id: task.id,
      customer_communication_sent: false,
      customer_data_changed: false,
    },
  });

  return {
    ok: true,
    status: actionRun ? "correction_proposed" as const : "review_task_created" as const,
    analysis,
    requestId,
    task: { id: task.id, status: task.status, sourceRef: task.sourceRef },
    actionRun: actionRun ? {
      id: actionRun.run.id,
      status: actionRun.run.status,
      duplicate: actionRun.duplicate,
    } : null,
    audit,
    customerCommunicationSent: false,
    customerDataChanged: false,
  };
}
