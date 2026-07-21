import { ArrivalIntegrationError, fetchWithRetry, microsoftGraphToken, requiredEnv } from "./clients";
import { extractDhlTrackingNumbers } from "./domain";
import { PrintInputError, readBoundedResponseBytes } from "./printing";

type GraphMessage = {
  id?: string;
  parentFolderId?: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
};

export type InspectedOutlookArchiveTarget = {
  accessToken: string;
  mailbox: string;
  sourceMessageId: string;
};

export class OutlookArchiveTargetError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "OutlookArchiveTargetError";
  }
}

export function validateOutlookArchiveWorkerId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/.test(value)) {
    throw new PrintInputError("Ungueltige Outlook-Archiv-Worker-ID.");
  }
  return value;
}

function validateMessageId(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 2048 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new OutlookArchiveTargetError("Outlook-Nachrichten-ID ist ungueltig.", "invalid_message_id");
  }
  return normalized;
}

function allowedDhlSender(address: string) {
  const senderDomain = address.trim().toLowerCase().split("@").pop() || "";
  const allowedDomains = String(process.env.DHL_EXPRESS_SENDER_DOMAINS || "dhl.com,dpdhl.com,dhl.de")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(senderDomain) && allowedDomains.some((domain) => senderDomain === domain || senderDomain.endsWith(`.${domain}`));
}

async function boundedJson<T>(response: Response, maximumBytes = 2 * 1024 * 1024) {
  const bytes = await readBoundedResponseBytes(response, maximumBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new OutlookArchiveTargetError("Microsoft Graph lieferte kein gueltiges JSON.", "invalid_graph_json", true);
  }
}

export function isRetryableOutlookInspectionError(error: unknown) {
  if (error instanceof OutlookArchiveTargetError) return error.retryable;
  if (error instanceof ArrivalIntegrationError) return error.retryable;
  return true;
}

export function outlookArchiveErrorCode(error: unknown) {
  if (error instanceof OutlookArchiveTargetError || error instanceof ArrivalIntegrationError) return error.code;
  return error instanceof Error ? error.name : "unknown_error";
}

export async function inspectExactDhlOutlookArchiveTarget(input: {
  sourceMessageId: string;
  expectedTrackingNumber: string;
}): Promise<InspectedOutlookArchiveTarget> {
  const sourceMessageId = validateMessageId(input.sourceMessageId);
  const expectedTrackingNumber = String(input.expectedTrackingNumber || "").replace(/\D/g, "");
  if (!/^[0-9]{10,40}$/.test(expectedTrackingNumber)) {
    throw new OutlookArchiveTargetError("Erwartete DHL-Sendungsnummer ist ungueltig.", "invalid_tracking_number");
  }

  const mailbox = requiredEnv("MICROSOFT_GRAPH_MAILBOX");
  const accessToken = await microsoftGraphToken();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    Prefer: 'outlook.body-content-type="text"',
  };
  const messageUrl = new URL(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(sourceMessageId)}`);
  messageUrl.searchParams.set("$select", "id,parentFolderId,subject,body,from");
  const inboxUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox?$select=id`;

  let messageResponse: Response;
  let inboxResponse: Response;
  try {
    [messageResponse, inboxResponse] = await Promise.all([
      fetchWithRetry(messageUrl.toString(), { headers }, {
        attempts: 3,
        timeoutMs: 15_000,
        integration: "microsoft_graph_archive_message",
      }),
      fetchWithRetry(inboxUrl, { headers }, {
        attempts: 3,
        timeoutMs: 15_000,
        integration: "microsoft_graph_archive_inbox",
      }),
    ]);
  } catch (error) {
    if (error instanceof ArrivalIntegrationError) throw error;
    throw new OutlookArchiveTargetError("Outlook-Nachricht konnte nicht vorab geprueft werden.", "graph_inspection_failed", true);
  }

  const [message, inbox] = await Promise.all([
    boundedJson<GraphMessage>(messageResponse),
    boundedJson<{ id?: string }>(inboxResponse, 64 * 1024),
  ]);
  if (message.id !== sourceMessageId || !inbox.id) {
    throw new OutlookArchiveTargetError("Outlook-Nachricht oder Posteingang konnte nicht eindeutig bestaetigt werden.", "graph_identity_mismatch");
  }
  if (message.parentFolderId !== inbox.id) {
    throw new OutlookArchiveTargetError("Die DHL-Nachricht befindet sich nicht mehr im Posteingang.", "message_not_in_inbox");
  }
  const senderAddress = String(message.from?.emailAddress?.address || "");
  if (!allowedDhlSender(senderAddress)) {
    throw new OutlookArchiveTargetError("Outlook-Absender ist keine freigegebene DHL-Domain.", "sender_not_allowlisted");
  }
  const searchable = `${String(message.subject || "")}\n${String(message.body?.content || "")}`;
  if (!extractDhlTrackingNumbers(searchable).includes(expectedTrackingNumber)) {
    throw new OutlookArchiveTargetError("Die exakte DHL-Sendungsnummer fehlt in der Outlook-Nachricht.", "tracking_not_confirmed");
  }

  return { accessToken, mailbox, sourceMessageId };
}

export async function moveInspectedOutlookMessageToArchiveOnce(target: InspectedOutlookArchiveTarget) {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(target.mailbox)}/messages/${encodeURIComponent(target.sourceMessageId)}/move`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${target.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ destinationId: "archive" }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new OutlookArchiveTargetError(`Outlook-Verschiebung endete mit HTTP ${response.status}.`, "graph_move_uncertain");
  }
  const moved = await boundedJson<{ id?: string }>(response, 256 * 1024);
  const movedMessageId = validateMessageId(String(moved.id || ""));
  return { movedMessageId };
}
