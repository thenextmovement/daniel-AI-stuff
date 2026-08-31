import { createHash } from "node:crypto";
import {
  getCompanyBrainActionPolicy,
  proposeCompanyBrainActionRun,
} from "@/lib/ops/company-brain-action-governance";
import type { CompanyBrainActor } from "@/lib/ops/company-brain-access";
import { updateCustomerRecord } from "@/lib/ops/customer-records";
import { recordOfferSentForSalesCalls } from "@/lib/ops/customer-call-module";
import { createOpsInternalTask, updateOpsInternalTask } from "@/lib/ops/internal-tasks";
import { recordQuoteEmailSentEvidence } from "@/lib/ops/offer-send-evidence";
import {
  getOfferById,
  patchOfferById,
  sendOfferUpdateMail,
  type OpsOfferPatchInput,
  type OpsOfferSendInput,
  type OpsOfferSendResult,
  type OpsOfferSnapshot,
} from "@/lib/ops/offers";
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

type OfferSendCandidateRow = {
  id?: string | null;
  request_id: string;
  trello_card_id?: string | null;
  offer_id: string;
  offer_number?: string | null;
  document_reference?: string | null;
  public_url?: string | null;
  recipient_email?: string | null;
  event_at?: string | null;
  source_event_id?: string | null;
  idempotency_key?: string | null;
};

type SuccessfulSendEvidence = {
  eventId: string | null;
  sentAt: string | null;
  source: "ops_offer_events" | "quote_email_log";
};

type QuoteEmailEvidenceResult = Awaited<ReturnType<typeof recordQuoteEmailSentEvidence>>;
type OfferSentSyncResult = Awaited<ReturnType<typeof recordOfferSentForSalesCalls>>;

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
  findOfferSendCandidates(requestId: string, failedEmail: string): Promise<OfferSendCandidateRow[]>;
  findSuccessfulOfferSend(requestId: string, offerId: string, recipientEmail: string): Promise<SuccessfulSendEvidence | null>;
  getOffer(offerId: string): Promise<OpsOfferSnapshot>;
  updateOfferEmail(offerId: string, input: OpsOfferPatchInput): Promise<Awaited<ReturnType<typeof patchOfferById>>>;
  sendOffer(offerId: string, input: OpsOfferSendInput): Promise<OpsOfferSendResult>;
  recordQuoteEvidence(input: Parameters<typeof recordQuoteEmailSentEvidence>[0]): Promise<QuoteEmailEvidenceResult>;
  recordOfferSent(input: Parameters<typeof recordOfferSentForSalesCalls>[0]): Promise<OfferSentSyncResult>;
  updateCustomerEmail(requestId: string, email: string): Promise<Awaited<ReturnType<typeof updateCustomerRecord>>>;
  updateTask: typeof updateOpsInternalTask;
  cancelPendingCorrectionRuns(requestId: string, failedEmail: string, correctedEmail: string): Promise<number>;
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

async function findOfferSendCandidates(requestId: string, failedEmail: string) {
  return supabaseRequest<OfferSendCandidateRow[]>("ops_offer_events", undefined, {
    select: "id,request_id,trello_card_id,offer_id,offer_number,document_reference,public_url,recipient_email,event_at,source_event_id,idempotency_key",
    request_id: `eq.${requestId}`,
    event_type: "eq.offer_sent",
    recipient_email: `eq.${failedEmail}`,
    order: "event_at.desc",
    limit: 20,
  });
}

async function findSuccessfulOfferSend(requestId: string, offerId: string, recipientEmail: string) {
  const [offerEvents, quoteEmails] = await Promise.all([
    supabaseRequest<Array<{ source_event_id?: string | null; event_at?: string | null }>>("ops_offer_events", undefined, {
      select: "source_event_id,event_at",
      request_id: `eq.${requestId}`,
      offer_id: `eq.${offerId}`,
      event_type: "eq.offer_sent",
      recipient_email: `eq.${recipientEmail}`,
      order: "event_at.desc",
      limit: 1,
    }),
    supabaseRequest<Array<{ source_event_id?: string | null; sent_at?: string | null; status?: string | null }>>("quote_email_log", undefined, {
      select: "source_event_id,sent_at,status",
      request_id: `eq.${requestId}`,
      offer_id: `eq.${offerId}`,
      recipient_email: `eq.${recipientEmail}`,
      order: "sent_at.desc.nullslast,created_at.desc",
      limit: 5,
    }),
  ]);
  if (offerEvents[0]) {
    return {
      eventId: cleanText(offerEvents[0].source_event_id, 300) || null,
      sentAt: cleanText(offerEvents[0].event_at, 80) || null,
      source: "ops_offer_events" as const,
    };
  }
  const quoteEmail = quoteEmails.find((row) => Boolean(row.sent_at || /sent|delivered|success|ok/i.test(cleanText(row.status, 80))));
  return quoteEmail ? {
    eventId: cleanText(quoteEmail.source_event_id, 300) || null,
    sentAt: cleanText(quoteEmail.sent_at, 80) || null,
    source: "quote_email_log" as const,
  } : null;
}

async function cancelPendingCorrectionRuns(requestId: string, failedEmail: string, correctedEmail: string) {
  const rows = await supabaseRequest<Array<{ id: string; frozen_input?: Record<string, unknown> | null }>>(
    "company_brain_action_runs",
    undefined,
    {
      select: "id,frozen_input",
      request_id: `eq.${requestId}`,
      action_key: "eq.correct_customer_email",
      status: "eq.awaiting_approval",
      limit: 20,
    },
  );
  const matchingIds = rows
    .filter((row) => (
      normalizeEmail(row.frozen_input?.recipientEmail) === failedEmail
      && normalizeEmail(row.frozen_input?.newCustomerEmail) === correctedEmail
    ))
    .map((row) => row.id);
  await Promise.all(matchingIds.map((id) => supabaseRequest("company_brain_action_runs", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      failure_code: "superseded_by_deterministic_offer_recovery",
      failure_detail: "Die eindeutige Provider-Domainkorrektur wurde nach bestaetigtem Angebotsversand automatisch abgeschlossen.",
      execution_result: {
        corrected_email: correctedEmail,
        customer_communication_sent: true,
        customer_data_changed: true,
      },
      verification_result: {
        basis: "known_provider_domain_single_edit",
        offer_delivery_confirmed: true,
      },
    }),
  }, {
    id: `eq.${id}`,
    status: "eq.awaiting_approval",
  })));
  return matchingIds.length;
}

export const defaultEmailBounceRecoveryDeps: EmailBounceRecoveryDeps = {
  findCustomerMatches,
  findRequest,
  findOfferSendCandidates,
  findSuccessfulOfferSend,
  getOffer: getOfferById,
  updateOfferEmail: patchOfferById,
  sendOffer: sendOfferUpdateMail,
  recordQuoteEvidence: recordQuoteEmailSentEvidence,
  recordOfferSent: recordOfferSentForSalesCalls,
  updateCustomerEmail: (requestId, email) => updateCustomerRecord(requestId, { email }, {
    mode: "automation",
    operatorName: AUTOMATION_ACTOR.email,
  }),
  updateTask: updateOpsInternalTask,
  cancelPendingCorrectionRuns,
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
  const [failedEmailMatches, correctedEmailMatches] = await Promise.all([
    deps.findCustomerMatches(analysis.failedEmail),
    analysis.suggestedEmail ? deps.findCustomerMatches(analysis.suggestedEmail) : Promise.resolve([]),
  ]);
  const customerMatches = [...failedEmailMatches, ...correctedEmailMatches];
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

  const currentCustomerEmail = normalizeEmail(customer?.email);
  if (
    requestId
    && request
    && analysis.reasonCode === "domain_not_found"
    && analysis.suggestedEmail
    && analysis.suggestionBasis === "known_provider_domain_single_edit"
    && analysis.confidence === "high"
    && (currentCustomerEmail === analysis.failedEmail || currentCustomerEmail === analysis.suggestedEmail)
  ) {
    const offerSendEvents = await deps.findOfferSendCandidates(requestId, analysis.failedEmail);
    const distinctOfferIds = [...new Set(offerSendEvents.map((row) => cleanText(row.offer_id, 180)).filter(Boolean))];
    if (distinctOfferIds.length === 1) {
      const offerEvent = offerSendEvents.find((row) => cleanText(row.offer_id, 180) === distinctOfferIds[0])!;
      const offer = await deps.getOffer(distinctOfferIds[0]);
      const offerRequestId = cleanText(offer.requestId || offer.request_id, 180);
      const offerBindingConfirmed = cleanText(offer.offerId, 180) === distinctOfferIds[0]
        && cleanText(offerEvent.request_id, 180) === requestId
        && (!offerRequestId || offerRequestId === requestId);
      const offerCustomerEmail = normalizeEmail(offer.offer.customerEmail);
      const accepted = Boolean(offer.acceptedAt || offer.acceptance || cleanText(offer.status, 80).toLowerCase() === "accepted");
      if (offerBindingConfirmed && offerCustomerEmail === analysis.failedEmail && !accepted) {
        const recipientEmail = analysis.suggestedEmail;
        const failedEmailHash = createHash("sha256").update(analysis.failedEmail).digest("hex").slice(0, 16);
        const correctedEmailHash = createHash("sha256").update(recipientEmail).digest("hex").slice(0, 16);
        const recoveryKey = `email-bounce-offer-recovery:${offer.offerId}:${failedEmailHash}:${correctedEmailHash}:v1`;
        let priorSend = await deps.findSuccessfulOfferSend(requestId, offer.offerId, recipientEmail);
        let sendResult: OpsOfferSendResult | null = null;
        const subject = `Ihr NEONTRIP Angebot ${offer.offerNumber}`;
        const message = [
          "Hallo,",
          "",
          "bei der ursprünglichen E-Mail-Adresse lag offenbar ein Tippfehler vor. Daher senden wir Ihnen Ihr NEONTRIP-Angebot erneut.",
          "",
          "Viele Grüße",
          "NEONTRIP",
        ].join("\n");
        if (!priorSend) {
          try {
            sendResult = await deps.sendOffer(offer.offerId, {
              recipientEmail,
              cc: [],
              subject,
              message,
              actor: AUTOMATION_ACTOR.email,
              reason: "Deterministische Korrektur einer nicht existierenden bekannten Provider-Domain nach Outlook-NDR.",
              idempotencyKey: recoveryKey,
            });
            if (!sendResult.sent) {
              throw new QuoteValidationError("Angebotsversand wurde nicht bestätigt.", ["offer_send_unconfirmed"], 502);
            }
          } catch (error) {
            const failureDetail = cleanText(error instanceof Error ? error.message : error, 1000) || "offer_send_unconfirmed";
            await deps.updateTask(task.id, {
              status: "open",
              description: [
                `Automatische Korrektur erkannt: ${analysis.failedEmail} -> ${recipientEmail}.`,
                `Angebot: ${offer.offerNumber}.`,
                "Der erneute Versand wurde nicht bestätigt. Die Kundendatei blieb unverändert.",
                `Fehler: ${failureDetail}`,
              ].join("\n"),
              metadata: {
                ...task.metadata,
                automatic_recovery_eligible: true,
                offer_id: offer.offerId,
                offer_number: offer.offerNumber,
                corrected_email: recipientEmail,
                send_outcome: "unconfirmed",
                customer_communication_sent: false,
                customer_data_changed: false,
              },
            }, { operatorName: AUTOMATION_ACTOR.email });
            const audit = await deps.recordAudit({
              workflowName: "NEONTRIP Outlook Customer Email Sync v1.0",
              workflowId: cleanText(input.workflow_id, 180) || null,
              action: "email_bounce_offer_recovery",
              status: "failed",
              requestId,
              documentId: requestId,
              trelloCardId: offer.trelloCardId || request.trello_card_id || null,
              offerId: offer.offerId,
              offerNumber: offer.offerNumber,
              executionId: cleanText(input.execution_id, 180) || null,
              sourceEventId: messageHash,
              idempotencyKey: `${sourceRef}:offer-recovery:send-failed`,
              errorMessage: failureDetail,
              summary: "Automatischer Neuversand wurde nicht bestätigt; Kundendaten blieben unverändert.",
              retrySafety: "blocked",
              safeActionKey: "manual_email_delivery_review",
              terminal: true,
              eventType: "email_bounce_offer_recovery_failed",
              customer_communication_sent: false,
              metadata: {
                audit_event_key: `workflow-audit:${sourceRef}:offer-recovery:send-failed`,
                failed_email: analysis.failedEmail,
                corrected_email: recipientEmail,
                offer_id: offer.offerId,
                offer_number: offer.offerNumber,
                task_id: task.id,
                send_outcome: "unconfirmed",
                customer_data_changed: false,
              },
            });
            return {
              ok: false,
              status: "offer_recovery_failed" as const,
              analysis,
              requestId,
              offer: { id: offer.offerId, number: offer.offerNumber },
              task: { id: task.id, status: "open", sourceRef: task.sourceRef },
              actionRun: null,
              audit,
              customerCommunicationSent: false,
              customerDataChanged: false,
            };
          }
          priorSend = {
            eventId: sendResult.eventId,
            sentAt: new Date().toISOString(),
            source: "ops_offer_events",
          };
        }

        const sentAt = priorSend.sentAt || new Date().toISOString();
        let opsSync: OfferSentSyncResult | OpsOfferSendResult["opsSync"] | null = sendResult?.opsSync || null;
        if (!opsSync) {
          try {
            opsSync = await deps.recordOfferSent({
              requestId,
              trelloCardId: offer.trelloCardId || offerEvent.trello_card_id || request.trello_card_id,
              offerId: offer.offerId,
              offerNumber: offer.offerNumber,
              documentReference: offer.documentReference,
              publicUrl: offer.publicUrl,
              recipientEmail,
              sentAt,
              source: "outlook_email_bounce_recovery",
              sourceEventId: sendResult?.eventId || priorSend.eventId,
              idempotencyKey: recoveryKey,
              actor: AUTOMATION_ACTOR.email,
              payload: {
                duplicate: Boolean(sendResult?.duplicate || !sendResult),
                direction: "outbound",
                subtype: "quote_bounce_recovery",
                failed_recipient_email: analysis.failedEmail,
              },
            });
          } catch (error) {
            opsSync = { ok: false, error: cleanText(error instanceof Error ? error.message : error, 1000) || "ops_sync_failed" };
          }
        }
        let quoteEvidence: { ok: boolean; rowId?: string | number | null; error?: string };
        try {
          const rows = await deps.recordQuoteEvidence({
            offerId: offer.offerId,
            offerNumber: offer.offerNumber,
            requestId,
            trelloCardId: offer.trelloCardId || offerEvent.trello_card_id || request.trello_card_id,
            recipientEmail,
            subject,
            status: sendResult?.duplicate || !sendResult ? "sent_duplicate" : "sent",
            sentAt,
            sourceEventId: sendResult?.eventId || priorSend.eventId,
            idempotencyKey: recoveryKey,
          });
          quoteEvidence = { ok: true, rowId: rows?.[0]?.id || null };
        } catch (error) {
          quoteEvidence = { ok: false, error: cleanText(error instanceof Error ? error.message : error, 1000) || "quote_evidence_failed" };
        }

        let offerEmailUpdate: { ok: boolean; changed: boolean; updatedAt?: string | null; error?: string } = {
          ok: true,
          changed: false,
        };
        try {
          if (offerCustomerEmail !== recipientEmail) {
            const patchResult = await deps.updateOfferEmail(offer.offerId, {
              expectedUpdatedAt: offer.updatedAt,
              actor: AUTOMATION_ACTOR.email,
              reason: "Deterministische Provider-Domainkorrektur nach bestaetigtem Angebotsversand.",
              revisionReason: "Empfaengeradresse nach bestaetigtem Bounce-Recovery-Versand korrigiert.",
              offer: { customerEmail: recipientEmail },
            });
            if (normalizeEmail(patchResult.offer.offer.customerEmail) !== recipientEmail) {
              throw new Error("offer_email_update_unconfirmed");
            }
            offerEmailUpdate = {
              ok: true,
              changed: true,
              updatedAt: patchResult.offer.updatedAt,
            };
          }
        } catch (error) {
          offerEmailUpdate = {
            ok: false,
            changed: false,
            error: cleanText(error instanceof Error ? error.message : error, 1000) || "offer_email_update_failed_after_send",
          };
        }

        let customerUpdate: { changedTables: unknown } | null = null;
        let customerUpdateError: string | null = null;
        try {
          customerUpdate = currentCustomerEmail === recipientEmail
            ? { changedTables: [] }
            : await deps.updateCustomerEmail(requestId, recipientEmail);
        } catch (error) {
          customerUpdateError = cleanText(error instanceof Error ? error.message : error, 1000) || "customer_update_failed_after_send";
        }

        const masterCustomerChanged = Boolean(customerUpdate) && currentCustomerEmail !== recipientEmail;
        const customerDataChanged = offerEmailUpdate.changed || masterCustomerChanged;
        if (!offerEmailUpdate.ok || customerUpdateError) {
          const failureDetail = [offerEmailUpdate.error, customerUpdateError].filter(Boolean).join("; ");
          await deps.updateTask(task.id, {
            status: "waiting",
            description: [
              `Angebot ${offer.offerNumber} wurde an ${recipientEmail} gesendet.`,
              "Die anschließende Korrektur in Angebot und Stammdaten ist noch nicht vollständig bestätigt.",
              `Fehler: ${failureDetail}`,
            ].join("\n"),
            customerEmail: recipientEmail,
            metadata: {
              ...task.metadata,
              automatic_recovery_eligible: true,
              offer_id: offer.offerId,
              offer_number: offer.offerNumber,
              corrected_email: recipientEmail,
              send_event_id: sendResult?.eventId || priorSend.eventId,
              send_duplicate: Boolean(sendResult?.duplicate || !sendResult),
              quote_email_evidence: quoteEvidence,
              ops_sync: opsSync,
              offer_email_update: offerEmailUpdate,
              customer_communication_sent: true,
              customer_data_changed: customerDataChanged,
              customer_update_outcome: customerUpdateError ? "unconfirmed" : "confirmed",
            },
          }, { operatorName: AUTOMATION_ACTOR.email });
          const audit = await deps.recordAudit({
            workflowName: "NEONTRIP Outlook Customer Email Sync v1.0",
            workflowId: cleanText(input.workflow_id, 180) || null,
            action: "email_bounce_offer_recovery",
            status: "blocked",
            requestId,
            documentId: requestId,
            trelloCardId: offer.trelloCardId || request.trello_card_id || null,
            offerId: offer.offerId,
            offerNumber: offer.offerNumber,
            executionId: cleanText(input.execution_id, 180) || null,
            sourceEventId: sendResult?.eventId || priorSend.eventId || messageHash,
            idempotencyKey: `${sourceRef}:offer-recovery:update-pending`,
            errorMessage: failureDetail,
            summary: "Angebot gesendet; E-Mail-Korrektur in Angebot oder Stammdaten wartet auf Abschluss.",
            retrySafety: "safe",
            safeActionKey: "complete_customer_email_update",
            terminal: true,
            eventType: "email_bounce_offer_sent_customer_update_pending",
            customer_communication_sent: true,
            metadata: {
              audit_event_key: `workflow-audit:${sourceRef}:offer-recovery:update-pending`,
              failed_email: analysis.failedEmail,
              corrected_email: recipientEmail,
              offer_id: offer.offerId,
              offer_number: offer.offerNumber,
              task_id: task.id,
              send_event_id: sendResult?.eventId || priorSend.eventId,
              quote_email_evidence: quoteEvidence,
              ops_sync: opsSync,
              offer_email_update: offerEmailUpdate,
              customer_communication_sent: true,
              customer_data_changed: customerDataChanged,
              customer_update_outcome: customerUpdateError ? "unconfirmed" : "confirmed",
            },
          });
          return {
            ok: false,
            status: "offer_sent_customer_update_pending" as const,
            analysis,
            requestId,
            offer: { id: offer.offerId, number: offer.offerNumber },
            task: { id: task.id, status: "waiting", sourceRef: task.sourceRef },
            actionRun: null,
            send: {
              sent: true,
              duplicate: Boolean(sendResult?.duplicate || !sendResult),
              eventId: sendResult?.eventId || priorSend.eventId,
            },
            quoteEvidence,
            opsSync,
            audit,
            customerCommunicationSent: true,
            customerDataChanged,
          };
        }

        const cancelledActionRuns = await deps.cancelPendingCorrectionRuns(requestId, analysis.failedEmail, recipientEmail);
        const completedTask = await deps.updateTask(task.id, {
          status: "done",
          description: [
            `Angebot ${offer.offerNumber} wurde an ${recipientEmail} erneut gesendet.`,
            `Korrigierte Provider-Domain: ${analysis.failedEmail} -> ${recipientEmail}.`,
            "Die Kundenadresse wurde erst nach bestätigtem Versand aktualisiert.",
          ].join("\n"),
          customerEmail: recipientEmail,
          metadata: {
            ...task.metadata,
            automatic_recovery_eligible: true,
            offer_id: offer.offerId,
            offer_number: offer.offerNumber,
            corrected_email: recipientEmail,
            send_event_id: sendResult?.eventId || priorSend.eventId,
            send_duplicate: Boolean(sendResult?.duplicate || !sendResult),
            quote_email_evidence: quoteEvidence,
            ops_sync: opsSync,
            offer_email_update: offerEmailUpdate,
            cancelled_action_runs: cancelledActionRuns,
            customer_communication_sent: true,
            customer_data_changed: customerDataChanged,
          },
        }, { operatorName: AUTOMATION_ACTOR.email });
        const audit = await deps.recordAudit({
          workflowName: "NEONTRIP Outlook Customer Email Sync v1.0",
          workflowId: cleanText(input.workflow_id, 180) || null,
          action: "email_bounce_offer_recovered",
          status: "sent",
          requestId,
          documentId: requestId,
          trelloCardId: offer.trelloCardId || request.trello_card_id || null,
          offerId: offer.offerId,
          offerNumber: offer.offerNumber,
          executionId: cleanText(input.execution_id, 180) || null,
          sourceEventId: sendResult?.eventId || priorSend.eventId || messageHash,
          idempotencyKey: `${sourceRef}:offer-recovery:sent`,
          summary: `Angebot ${offer.offerNumber} an die deterministisch korrigierte Adresse gesendet; Stammdaten danach aktualisiert.`,
          retrySafety: "safe",
          safeActionKey: "email_bounce_offer_recovery",
          terminal: true,
          eventType: "email_bounce_offer_recovered",
          customer_communication_sent: true,
          metadata: {
            audit_event_key: `workflow-audit:${sourceRef}:offer-recovery:sent`,
            failed_email: analysis.failedEmail,
            corrected_email: recipientEmail,
            offer_id: offer.offerId,
            offer_number: offer.offerNumber,
            task_id: task.id,
            send_event_id: sendResult?.eventId || priorSend.eventId,
            send_duplicate: Boolean(sendResult?.duplicate || !sendResult),
            quote_email_evidence: quoteEvidence,
            ops_sync: opsSync,
            offer_email_update: offerEmailUpdate,
            changed_tables: customerUpdate?.changedTables || [],
            cancelled_action_runs: cancelledActionRuns,
            customer_communication_sent: true,
            customer_data_changed: customerDataChanged,
          },
        });
        return {
          ok: true,
          status: "offer_recovered" as const,
          analysis,
          requestId,
          offer: { id: offer.offerId, number: offer.offerNumber },
          task: { id: completedTask.id, status: completedTask.status, sourceRef: completedTask.sourceRef },
          actionRun: null,
          send: {
            sent: true,
            duplicate: Boolean(sendResult?.duplicate || !sendResult),
            eventId: sendResult?.eventId || priorSend.eventId,
          },
          quoteEvidence,
          opsSync,
          audit,
          customerCommunicationSent: true,
          customerDataChanged,
        };
      }
    }
  }

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
    // workflow_audit_log accepts the operational lifecycle value "waiting";
    // the more specific action-run state remains "awaiting_approval".
    status: actionRun ? "waiting" : "prepared",
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
