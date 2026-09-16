import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";
import type { CustomerCommunicationEntry, CustomerQuoteSummary, CustomerRequestSummary } from "@/lib/ops/customer-records";

// The business request_id is text; linked_request_id in the mail mirror is a UUID.
type RequestRow = {
  id: string; request_id: string; customer_id: string | null;
  title: string | null; description: string | null; status: string | null;
  segment: string | null; size: string | null; color: string[] | null;
  application: string | null; delivery_time: string | null;
  trello_card_id: string | null; trello_card_url: string | null;
};
type CustomerRow = {
  id: string; request_id: string | null; name: string | null;
  first_name: string | null; last_name: string | null; company: string | null;
  company_name: string | null; email: string | null; phone: string | null;
};
type OfferRow = {
  id: string; request_id: string; offer_status: string | null;
  total_value: number | null; currency: string | null; sent_at: string | null;
  viewed_at: string | null; accepted_at: string | null;
};
type MessageRow = {
  id: string; linked_request_id: string | null; linked_customer_id: string | null;
  matched_email: string | null; subject: string | null; body_preview: string | null;
  direction: string | null; received_at: string | null; sent_at: string | null;
  created_at: string | null; message_created_at: string | null; message_id: string | null; conversation_id: string | null;
};
export type VoiceContextRecord = {
  requestId: string; masterCustomerId: string; displayName: string | null;
  company: string | null; email: string | null; phone: string | null;
  request: Pick<CustomerRequestSummary, "title" | "description" | "status" | "segment" | "size" | "colors" | "application" | "deliveryTime" | "trelloCardId" | "trelloCardUrl">;
  quote: CustomerQuoteSummary | null; offerTracking: { offerId: string } | null;
  communications: CustomerCommunicationEntry[]; outlookCommunications: CustomerCommunicationEntry[];
  optionalSources: { offer: boolean; outlook: boolean };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const literal = (value: string) => '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
function invalid(code: string, message: string, status = 409): never {
  throw new QuoteValidationError(message, [code], status);
}

export async function loadVoiceContextRecord(requestId: string, expectedCustomerId?: string | null): Promise<VoiceContextRecord> {
  if (!requestId || requestId.length > 160 || /[\u0000-\u001f]/.test(requestId)) {
    invalid("invalid_request_id", "Ungültige Vorgangsnummer.", 422);
  }
  if (expectedCustomerId != null && !UUID.test(expectedCustomerId)) {
    invalid("invalid_customer_id", "Ungültige Kundenzuordnung.", 422);
  }
  const signal = AbortSignal.timeout(5000);
  const read = <T>(table: string, query: Record<string, string | number>) =>
    supabaseRequest<T[]>(table, { signal }, query);
  const requests = await read<RequestRow>("master_requests", {
    select: "id,request_id,customer_id,title,description,status,segment,size,color,application,delivery_time,trello_card_id,trello_card_url",
    request_id: "eq." + requestId, limit: 2,
  });
  if (!requests.length) invalid("voice_request_not_found", "Dieser Vorgang wurde nicht gefunden.", 404);
  if (requests.length !== 1 || requests[0].request_id !== requestId || !UUID.test(requests[0].id)) {
    invalid("request_binding_mismatch", "Der Vorgang ist nicht eindeutig zugeordnet.");
  }
  const request = requests[0];
  if (request.customer_id && !UUID.test(request.customer_id)) {
    invalid("customer_binding_mismatch", "Die Kundenzuordnung des Vorgangs ist ungültig.");
  }
  const customers = await read<CustomerRow>("master_customers", {
    select: "id,request_id,name,first_name,last_name,company,company_name,email,phone",
    ...(request.customer_id ? { id: "eq." + request.customer_id } : { request_id: "eq." + requestId }),
    limit: 2,
  });
  const customer = customers[0];
  if (customers.length !== 1 || !UUID.test(customer?.id || "") ||
    (request.customer_id ? customer.id !== request.customer_id : customer.request_id !== requestId) ||
    (expectedCustomerId && customer.id !== expectedCustomerId)) {
    invalid("customer_binding_mismatch", "Der Vorgang passt nicht eindeutig zum ausgewählten Kunden.");
  }
  const email = text(customer.email)?.toLowerCase() || null;
  const messageFilters = ["linked_request_id.eq." + request.id, "linked_customer_id.eq." + customer.id];
  if (email) messageFilters.push("matched_email.eq." + literal(email));
  const [quotes, tracking, messages] = await Promise.allSettled([
    read<OfferRow>("v_offer_history", {
      select: "id,request_id,offer_status,total_value,currency,sent_at,viewed_at,accepted_at",
      request_id: "eq." + requestId, order: "created_at.desc,id.desc", limit: 1,
    }),
    read<{ request_id: string; offer_id: string }>("ops_offer_events", {
      select: "request_id,offer_id", request_id: "eq." + requestId,
      offer_id: "not.is.null", order: "event_at.desc,id.desc", limit: 1,
    }),
    read<MessageRow>("customer_email_messages", {
      select: "id,linked_request_id,linked_customer_id,matched_email,subject,body_preview,direction,received_at,sent_at,created_at,message_created_at,message_id,conversation_id",
      or: "(" + messageFilters.join(",") + ")", order: "message_created_at.desc.nullslast,id.desc", limit: 30,
    }),
  ]);
  const quote = quotes.status === "fulfilled" && quotes.value[0]?.request_id === requestId ? quotes.value[0] : null;
  const event = tracking.status === "fulfilled" && tracking.value[0]?.request_id === requestId ? tracking.value[0] : null;
  const communications: CustomerCommunicationEntry[] = (messages.status === "fulfilled" ? messages.value : [])
    .filter((message) => {
      if (message.linked_customer_id && message.linked_customer_id !== customer.id) return false;
      if (message.linked_customer_id === customer.id) return true;
      if (message.linked_request_id) return message.linked_request_id === request.id;
      return Boolean(email && text(message.matched_email)?.toLowerCase() === email);
    }).map((message) => ({
      id: message.id, source: "customer_email_messages", title: text(message.subject) || "E-Mail",
      preview: text(message.body_preview), body: null, status: null,
      occurredAt: message.sent_at || message.received_at || message.message_created_at || message.created_at,
      href: null, direction: text(message.direction), messageId: text(message.message_id),
      conversationId: text(message.conversation_id), classification: "contact",
    }));
  return {
    requestId, masterCustomerId: customer.id,
    displayName: text(customer.name) || text([customer.first_name, customer.last_name].filter(Boolean).join(" ")),
    company: text(customer.company) || text(customer.company_name), email, phone: text(customer.phone),
    request: {
      title: text(request.title), description: text(request.description), status: text(request.status),
      segment: text(request.segment), size: text(request.size), colors: (request.color || []).filter(x => typeof x === "string"),
      application: text(request.application), deliveryTime: text(request.delivery_time),
      trelloCardId: text(request.trello_card_id), trelloCardUrl: text(request.trello_card_url),
    },
    quote: quote ? {
      quoteId: quote.id, status: text(quote.offer_status), totalValue: quote.total_value, currency: quote.currency,
      shareLink: null, editLink: null, sentAt: quote.sent_at, viewedAt: quote.viewed_at,
      signedAt: quote.accepted_at, whatsappSentAt: null,
    } : null,
    offerTracking: event && text(event.offer_id) ? { offerId: event.offer_id } : null,
    communications, outlookCommunications: communications,
    optionalSources: { offer: quotes.status === "fulfilled" && tracking.status === "fulfilled", outlook: messages.status === "fulfilled" },
  };
}
