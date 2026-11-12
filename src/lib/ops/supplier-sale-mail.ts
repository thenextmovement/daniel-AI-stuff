import { microsoftGraphToken } from "@/lib/ops/arrival-labels/clients";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import type { ReviewMail } from "./supplier-sale-review";

type Recipient = { emailAddress?: { address?: string } };
type GraphMessage = {
  id: string; conversationId: string; subject?: string; body?: { content?: string; contentType?: string };
  receivedDateTime?: string; sentDateTime?: string; from?: Recipient;
  toRecipients?: Recipient[]; ccRecipients?: Recipient[]; webLink?: string; isDraft?: boolean; hasAttachments?: boolean;
};
const SELECT = "id,conversationId,subject,body,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,webLink,isDraft,hasAttachments";
const escapeFilter = (value: string) => value.replace(/'/g, "''");
const address = (r?: Recipient) => String(r?.emailAddress?.address || "").toLowerCase();

/** All pages or an explicit error; never present a truncated search as a completed mail review. */
export async function readSupplierSaleMail(input: { email: string; requestId: string | null; since?: string }, dependencies?: {
  token?: () => Promise<string>; fetch?: typeof fetch; now?: Date;
}): Promise<ReviewMail[]> {
  const email = input.email.trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) throw new Error("Kunden-E-Mail fehlt oder ist ungültig.");
  const mailbox = String(process.env.MICROSOFT_GRAPH_MAILBOX || "").trim().toLowerCase();
  if (mailbox !== "support@neontrip.de") throw new Error("Der vorhandene Graph-Zugriff muss an support@neontrip.de gebunden sein.");
  const token = await (dependencies?.token || microsoftGraphToken)();
  const fetcher = dependencies?.fetch || fetch;
  const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages`;
  async function collect(query: Record<string, string>, search = false) {
    let next: string | null = `${endpoint}?${new URLSearchParams({ "$select": SELECT, "$top": "100", ...query })}`;
    const messages: GraphMessage[] = [];
    let pages = 0;
    while (next) {
      const url = new URL(next);
      if (url.origin !== "https://graph.microsoft.com" || url.pathname !== new URL(endpoint).pathname || url.username || url.password) throw new Error("Ungültiger Outlook-Seitenlink.");
      if (++pages > 30) throw new Error("Mailverlauf überschreitet das Prüflimit. Keine vollständige Mailprüfung möglich.");
      const response = await fetcher(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' },
        cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Outlook-Lesezugriff fehlgeschlagen (HTTP ${response.status}).`);
      const payload = await response.json() as { value?: GraphMessage[]; "@odata.nextLink"?: string };
      if (!Array.isArray(payload.value)) throw new Error("Outlook lieferte keinen vollständigen Nachrichtenstapel.");
      messages.push(...payload.value);
      next = payload["@odata.nextLink"] || null;
    }
    // Graph message search has a provider-side 1,000-result ceiling.
    if (search && messages.length >= 1000) throw new Error("Outlook-Suchlimit erreicht; der Verlauf ist nicht vollständig prüfbar.");
    return messages;
  }
  const linkedThreads = new Set<string>();
  if (input.requestId) {
    for (let offset = 0; ; offset += 500) {
      const rows = await supabaseRequest<Array<{ conversation_id: string; mailbox: string }>>("customer_email_messages", undefined, {
        select: "conversation_id,mailbox", linked_request_id: `eq.${input.requestId}`, order: "id.asc", limit: 500, offset,
      });
      for (const row of rows) if (row.mailbox?.toLowerCase() === mailbox && row.conversation_id) linkedThreads.add(row.conversation_id);
      if (rows.length < 500) break;
      if (offset >= 1500) throw new Error("Zu viele verknüpfte E-Mails; eine vollständige Prüfung ist nicht möglich.");
    }
  }
  const search = await collect({ "$search": `"participants:${email}"` }, true);
  // Search is eventually consistent. Also read recent messages directly, without the search index.
  const now = dependencies?.now || new Date();
  const recentSince = input.since || new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await collect({ "$filter": `receivedDateTime ge ${recentSince}` });
  const participates = (m: GraphMessage) => address(m.from) === email || [...(m.toRecipients || []), ...(m.ccRecipients || [])].some(r => address(r) === email);
  const relevantSeeds = [...search, ...recent].filter(m => !m.isDraft && (participates(m) || linkedThreads.has(m.conversationId)));
  const threadIds = new Set([...linkedThreads, ...relevantSeeds.map(m => m.conversationId).filter(Boolean)]);
  if (threadIds.size > 40) throw new Error("Mehr als 40 Kunden-Threads. Bitte den auftragsbezogenen Verlauf zuerst eingrenzen.");
  const found = new Map<string, GraphMessage>();
  for (const m of relevantSeeds) found.set(m.id, m);
  for (const threadId of threadIds) {
    for (const m of await collect({ "$filter": `conversationId eq '${escapeFilter(threadId)}'` })) {
      if (!m.isDraft) found.set(m.id, m);
    }
  }
  const messages = [...found.values()];
  if (messages.length > 250) throw new Error("Mehr als 250 Nachrichten; der Verlauf benötigt eine gezielte manuelle Zuordnung.");
  const mapped = messages.map((m): ReviewMail => {
    if (!m.id || !m.conversationId || !m.body || typeof m.body.content !== "string" || m.body.contentType?.toLowerCase() !== "text") throw new Error("Outlook-Volltext fehlt. Die Mailprüfung bleibt offen.");
    return {
      id: m.id, threadId: m.conversationId, subject: m.subject || "(ohne Betreff)", body: m.body.content,
      at: m.sentDateTime || m.receivedDateTime || "", direction: /@neontrip\.(de|com)$/i.test(address(m.from)) ? "outbound" : "inbound",
      href: m.webLink?.startsWith("https://outlook.") ? m.webLink : null,
      hasAttachments: Boolean(m.hasAttachments),
    };
  }).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  if (mapped.reduce((n, m) => n + m.body.length, 0) > 450_000) throw new Error("Mailvolltexte überschreiten das Prüflimit. Es wurde nichts gekürzt oder freigegeben.");
  return mapped;
}
