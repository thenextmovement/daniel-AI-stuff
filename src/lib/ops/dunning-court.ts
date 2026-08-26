import {
  SupabaseRestError,
  supabaseRequest,
} from "@/lib/quotes/supabase-rest";

export type DunningCourtEventType =
  | "application_draft_created"
  | "application_submitted"
  | "court_order_served"
  | "objection_received"
  | "enforcement_order_requested"
  | "enforcement_order_issued"
  | "closed";

type DunningCourtEventRow = {
  id: string;
  order_number: string;
  event_key: string;
  event_type: DunningCourtEventType;
  occurred_on: string;
  source_reference: string | null;
  actor: string | null;
  note: string | null;
  created_at: string;
};

export type DunningCourtEvent = {
  id: string;
  orderNumber: string;
  eventKey: string;
  eventType: DunningCourtEventType;
  eventLabel: string;
  occurredOn: string;
  sourceReference: string | null;
  actor: string | null;
  note: string | null;
  createdAt: string;
};

const EVENT_LABELS: Record<DunningCourtEventType, string> = {
  application_draft_created: "Mahnantrag erstellt",
  application_submitted: "Mahnantrag beim Gericht eingereicht",
  court_order_served: "Mahnbescheid zugestellt",
  objection_received: "Widerspruch eingegangen",
  enforcement_order_requested: "Vollstreckungsbescheid beantragt",
  enforcement_order_issued: "Vollstreckungsbescheid erlassen",
  closed: "Gerichtliches Mahnverfahren abgeschlossen",
};

export function dunningCourtEventLabel(eventType: DunningCourtEventType) {
  return EVENT_LABELS[eventType];
}

export function dunningCourtNextAction(
  event: DunningCourtEvent | null,
): string | null {
  if (!event) return null;
  switch (event.eventType) {
    case "application_draft_created":
      return "Mahnantrag prüfen und beim Gericht einreichen";
    case "application_submitted":
      return "Gerichtliche Bearbeitung und Zustellung abwarten";
    case "court_order_served":
      return "Widerspruchsfrist überwachen";
    case "objection_received":
      return "Widerspruch rechtlich prüfen";
    case "enforcement_order_requested":
      return "Entscheidung über Vollstreckungsbescheid abwarten";
    case "enforcement_order_issued":
      return "Vollstreckung bewusst prüfen";
    case "closed":
      return "Gerichtliches Mahnverfahren abgeschlossen";
  }
}

function eventFromRow(row: DunningCourtEventRow): DunningCourtEvent {
  return {
    id: row.id,
    orderNumber: row.order_number,
    eventKey: row.event_key,
    eventType: row.event_type,
    eventLabel: dunningCourtEventLabel(row.event_type),
    occurredOn: row.occurred_on,
    sourceReference: row.source_reference,
    actor: row.actor,
    note: row.note,
    createdAt: row.created_at,
  };
}

export async function loadDunningCourtEvents() {
  try {
    const rows = await supabaseRequest<DunningCourtEventRow[]>(
      "dunning_court_events",
      undefined,
      {
        select:
          "id,order_number,event_key,event_type,occurred_on,source_reference,actor,note,created_at",
        order: "occurred_on.desc,created_at.desc",
        limit: 5000,
      },
    );
    const byOrder = new Map<string, DunningCourtEvent[]>();
    for (const row of rows) {
      const event = eventFromRow(row);
      byOrder.set(row.order_number, [
        ...(byOrder.get(row.order_number) || []),
        event,
      ]);
    }
    return byOrder;
  } catch (error) {
    const details =
      error instanceof SupabaseRestError ? String(error.details || "") : "";
    if (
      error instanceof SupabaseRestError &&
      (error.status === 404 ||
        (details.includes("dunning_court_events") &&
          (details.includes("does not exist") ||
            details.includes("schema cache"))))
    )
      return new Map<string, DunningCourtEvent[]>();
    throw error;
  }
}
