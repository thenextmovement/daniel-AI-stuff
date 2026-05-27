import type { CustomerWorkboardSection } from "./customer-records";

export type SessionBadgeLabel =
  | "Eingang"
  | "Arbeitsbereich"
  | "Problemfälle"
  | "Reparaturen"
  | "Antworten"
  | "Rückrufe"
  | "Erinnerungen"
  | "Abschluss"
  | "Kaufinteresse"
  | "Übergaben"
  | "Mein Arbeitsbereich"
  | "Abläufe"
  | "Kontaktdossier";

export type SessionPreferredTab = "contact" | "deal" | "trello" | "communication" | "sales" | "history";

export type CustomerPersonalLaneKey =
  | "handover"
  | "recent_replies"
  | "special_cases"
  | "repairs"
  | "callbacks"
  | "sales_recovery"
  | "commercial"
  | "active_flows"
  | "due_followups"
  | "contact_clusters";

export type OperatorRadarKey =
  | "replies"
  | "callbacks"
  | "special_cases"
  | "repairs"
  | "flows"
  | "signals"
  | "commercial"
  | "clusters";

export type GlobalRadarKey =
  | "recent_replies"
  | "callbacks"
  | "viewed_without_order"
  | "order_open_ops"
  | "missing_design_context"
  | "contact_stops";

export type ActionQueueKey = "reply" | "callback" | "followup" | "signal" | "context";

export type CommercialDeskKey = "live_quotes" | "viewed_without_order" | "crm_builder" | "order_open_ops";

export type SystemGapKey =
  | "email_drift"
  | "blocked_followups"
  | "trello_context_thin"
  | "viewed_without_order"
  | "order_open_ops"
  | "callback_no_phone"
  | "outbound_only_followup";

export type OpsFeedSessionContext = {
  direction: "inbound" | "outbound" | "internal" | "system";
  hasSpecialCase: boolean;
  isHandover: boolean;
  hasRepairGap: boolean;
  hasActiveFlow: boolean;
  hasCluster: boolean;
  hasSalesRecovery: boolean;
  hasCommercial: boolean;
  hasCallbackPressure: boolean;
  hasFollowupPressure: boolean;
};

export type RecordSessionContext = {
  hasSpecialCase: boolean;
  isHandover: boolean;
  repairGapKey?: SystemGapKey | null;
  hasInboundReply: boolean;
  hasActiveFlow: boolean;
  hasCluster: boolean;
  hasSalesRecovery: boolean;
  hasCommercial: boolean;
  hasCallbackPressure: boolean;
  hasFollowupPressure: boolean;
};

export function getSessionSourceLabel(source: "inbox" | "workboard", badgeLabel?: SessionBadgeLabel): string {
  if (badgeLabel) {
    return getSessionContextLabel(badgeLabel);
  }
  return source === "workboard" ? "Arbeitsbereich" : "Eingang";
}

export function getSessionDetail(badgeLabel?: SessionBadgeLabel): string {
  switch (badgeLabel) {
    case "Problemfälle":
      return "Problemfälle bleiben jetzt in einem klaren Arbeitsbereich.";
    case "Reparaturen":
      return "Reparaturfälle laufen jetzt gesammelt in den Reparaturen.";
    case "Antworten":
      return "Offene Antworten werden jetzt Fall für Fall abgearbeitet.";
    case "Rückrufe":
      return "Rückrufe bleiben jetzt in einer durchgehenden Telefonspur.";
    case "Erinnerungen":
      return "Fällige Erinnerungen laufen jetzt in einer durchgehenden Spur.";
    case "Abschluss":
      return "Abschlussfälle bleiben jetzt in einer gemeinsamen Verkaufs- und Angebotslage.";
    case "Kaufinteresse":
      return "Fälle mit Kaufinteresse bleiben jetzt in einer gemeinsamen Rückgewinnung.";
    case "Übergaben":
      return "Übergaben werden jetzt gebündelt übernommen statt einzeln gesucht.";
    case "Mein Arbeitsbereich":
      return "Das ist dein persönlicher Arbeitsbereich für die nächsten Fälle.";
    case "Abläufe":
      return "Laufende Abläufe werden jetzt gemeinsam fortgeführt.";
    case "Kontaktdossier":
      return "Kontaktdossiers bleiben jetzt als gemeinsames Dossier geöffnet.";
    default:
      return "Du arbeitest dich jetzt Fall für Fall durch, ohne zurück zur Übersicht springen zu müssen.";
  }
}

export function getPersonalLaneBadgeLabel(laneKey: CustomerPersonalLaneKey): SessionBadgeLabel {
  switch (laneKey) {
    case "repairs":
      return "Reparaturen";
    case "callbacks":
      return "Rückrufe";
    case "commercial":
      return "Abschluss";
    case "sales_recovery":
      return "Kaufinteresse";
    case "active_flows":
      return "Abläufe";
    case "contact_clusters":
      return "Kontaktdossier";
    case "due_followups":
      return "Erinnerungen";
    default:
      return "Mein Arbeitsbereich";
  }
}

export function getPersonalLaneSessionMeta(laneKey: CustomerPersonalLaneKey): {
  badgeLabel: SessionBadgeLabel;
  preferredTab: SessionPreferredTab | null;
} {
  switch (laneKey) {
    case "handover":
      return { badgeLabel: "Übergaben", preferredTab: "contact" };
    case "recent_replies":
      return { badgeLabel: "Antworten", preferredTab: "communication" };
    case "special_cases":
      return { badgeLabel: "Problemfälle", preferredTab: "contact" };
    case "repairs":
      return { badgeLabel: "Reparaturen", preferredTab: null };
    case "callbacks":
      return { badgeLabel: "Rückrufe", preferredTab: "communication" };
    case "sales_recovery":
      return { badgeLabel: "Kaufinteresse", preferredTab: "deal" };
    case "commercial":
      return { badgeLabel: "Abschluss", preferredTab: "deal" };
    case "active_flows":
      return { badgeLabel: "Abläufe", preferredTab: null };
    case "due_followups":
      return { badgeLabel: "Erinnerungen", preferredTab: "communication" };
    case "contact_clusters":
      return { badgeLabel: "Kontaktdossier", preferredTab: "contact" };
  }
}

export function getWorkboardSectionSessionMeta(sectionKey: CustomerWorkboardSection["key"]): {
  badgeLabel: SessionBadgeLabel;
  preferredTab: SessionPreferredTab | null;
} {
  switch (sectionKey) {
    case "recent_replies":
      return { badgeLabel: "Antworten", preferredTab: "communication" };
    case "callbacks":
      return { badgeLabel: "Rückrufe", preferredTab: "communication" };
    case "due_followups":
      return { badgeLabel: "Erinnerungen", preferredTab: "communication" };
    case "sales_recovery":
      return { badgeLabel: "Kaufinteresse", preferredTab: "deal" };
    default:
      return { badgeLabel: "Arbeitsbereich", preferredTab: null };
  }
}

export function getOperatorRadarSessionMeta(itemKey: OperatorRadarKey): {
  badgeLabel: SessionBadgeLabel;
  preferredTab: SessionPreferredTab | null;
} {
  switch (itemKey) {
    case "replies":
      return { badgeLabel: "Antworten", preferredTab: "communication" };
    case "callbacks":
      return { badgeLabel: "Rückrufe", preferredTab: "communication" };
    case "special_cases":
      return { badgeLabel: "Problemfälle", preferredTab: "contact" };
    case "repairs":
      return { badgeLabel: "Reparaturen", preferredTab: null };
    case "flows":
      return { badgeLabel: "Abläufe", preferredTab: null };
    case "signals":
      return { badgeLabel: "Kaufinteresse", preferredTab: "deal" };
    case "commercial":
      return { badgeLabel: "Abschluss", preferredTab: "deal" };
    case "clusters":
      return { badgeLabel: "Kontaktdossier", preferredTab: "contact" };
  }
}

export function getGlobalRadarSessionMeta(itemKey: GlobalRadarKey): {
  badgeLabel: SessionBadgeLabel;
  preferredTab: SessionPreferredTab | null;
} {
  switch (itemKey) {
    case "recent_replies":
      return { badgeLabel: "Antworten", preferredTab: "communication" };
    case "callbacks":
      return { badgeLabel: "Rückrufe", preferredTab: "sales" };
    case "viewed_without_order":
      return { badgeLabel: "Kaufinteresse", preferredTab: "sales" };
    case "order_open_ops":
      return { badgeLabel: "Abschluss", preferredTab: "history" };
    case "missing_design_context":
      return { badgeLabel: "Arbeitsbereich", preferredTab: "trello" };
    case "contact_stops":
      return { badgeLabel: "Arbeitsbereich", preferredTab: "history" };
  }
}

export function getActionQueueSessionMeta(itemKey: ActionQueueKey): {
  badgeLabel: SessionBadgeLabel;
  preferredTab: SessionPreferredTab | null;
} {
  switch (itemKey) {
    case "reply":
      return { badgeLabel: "Antworten", preferredTab: "communication" };
    case "callback":
      return { badgeLabel: "Rückrufe", preferredTab: "communication" };
    case "followup":
      return { badgeLabel: "Erinnerungen", preferredTab: "communication" };
    case "signal":
      return { badgeLabel: "Kaufinteresse", preferredTab: "deal" };
    default:
      return { badgeLabel: "Arbeitsbereich", preferredTab: null };
  }
}

export function getCommercialDeskSessionMeta(itemKey: CommercialDeskKey): {
  badgeLabel: SessionBadgeLabel;
  preferredTab: SessionPreferredTab | null;
} {
  return itemKey === "viewed_without_order"
    ? { badgeLabel: "Kaufinteresse", preferredTab: "deal" }
    : { badgeLabel: "Abschluss", preferredTab: "deal" };
}

export function getSystemGapSessionMeta(itemKey: SystemGapKey): {
  badgeLabel: SessionBadgeLabel;
  preferredTab: SessionPreferredTab | null;
} {
  switch (itemKey) {
    case "email_drift":
      return { badgeLabel: "Reparaturen", preferredTab: "contact" };
    case "blocked_followups":
      return { badgeLabel: "Reparaturen", preferredTab: "history" };
    case "trello_context_thin":
      return { badgeLabel: "Arbeitsbereich", preferredTab: "trello" };
    case "viewed_without_order":
      return { badgeLabel: "Kaufinteresse", preferredTab: "sales" };
    case "order_open_ops":
      return { badgeLabel: "Abschluss", preferredTab: "history" };
    case "callback_no_phone":
      return { badgeLabel: "Rückrufe", preferredTab: "contact" };
    case "outbound_only_followup":
      return { badgeLabel: "Erinnerungen", preferredTab: "history" };
  }
}

export function getOpsFeedSessionMeta(context: OpsFeedSessionContext): {
  badgeLabel: SessionBadgeLabel;
  preferredTab: SessionPreferredTab | null;
} {
  if (context.hasSpecialCase) {
    return { badgeLabel: "Problemfälle", preferredTab: "contact" };
  }
  if (context.isHandover) {
    return { badgeLabel: "Übergaben", preferredTab: "contact" };
  }
  if (context.hasRepairGap) {
    return { badgeLabel: "Reparaturen", preferredTab: "contact" };
  }
  if (context.direction === "inbound") {
    return { badgeLabel: "Antworten", preferredTab: "communication" };
  }
  if (context.hasActiveFlow) {
    return { badgeLabel: "Abläufe", preferredTab: null };
  }
  if (context.hasCluster) {
    return { badgeLabel: "Kontaktdossier", preferredTab: "contact" };
  }
  if (context.hasSalesRecovery) {
    return { badgeLabel: "Kaufinteresse", preferredTab: "deal" };
  }
  if (context.hasCommercial) {
    return { badgeLabel: "Abschluss", preferredTab: "deal" };
  }
  if (context.hasCallbackPressure) {
    return { badgeLabel: "Rückrufe", preferredTab: "communication" };
  }
  if (context.hasFollowupPressure) {
    return { badgeLabel: "Erinnerungen", preferredTab: "communication" };
  }
  return { badgeLabel: "Arbeitsbereich", preferredTab: null };
}

export function getRecordSessionMeta(context: RecordSessionContext): {
  badgeLabel: SessionBadgeLabel;
  preferredTab: SessionPreferredTab | null;
} {
  if (context.hasSpecialCase) {
    return { badgeLabel: "Problemfälle", preferredTab: "contact" };
  }
  if (context.isHandover) {
    return { badgeLabel: "Übergaben", preferredTab: "contact" };
  }
  if (context.repairGapKey) {
    return getSystemGapSessionMeta(context.repairGapKey);
  }
  if (context.hasInboundReply) {
    return { badgeLabel: "Antworten", preferredTab: "communication" };
  }
  if (context.hasActiveFlow) {
    return { badgeLabel: "Abläufe", preferredTab: null };
  }
  if (context.hasCluster) {
    return { badgeLabel: "Kontaktdossier", preferredTab: "contact" };
  }
  if (context.hasSalesRecovery) {
    return { badgeLabel: "Kaufinteresse", preferredTab: "deal" };
  }
  if (context.hasCommercial) {
    return { badgeLabel: "Abschluss", preferredTab: "deal" };
  }
  if (context.hasCallbackPressure) {
    return { badgeLabel: "Rückrufe", preferredTab: "communication" };
  }
  if (context.hasFollowupPressure) {
    return { badgeLabel: "Erinnerungen", preferredTab: "communication" };
  }
  return { badgeLabel: "Arbeitsbereich", preferredTab: null };
}

export function getSessionPrimaryActionLabel(badgeLabel?: SessionBadgeLabel): string {
  switch (badgeLabel) {
    case "Problemfälle":
      return "Nächsten Problemfall öffnen";
    case "Reparaturen":
      return "Nächste Reparatur öffnen";
    case "Antworten":
      return "Nächste Antwort öffnen";
    case "Rückrufe":
      return "Nächsten Rückruf öffnen";
    case "Erinnerungen":
      return "Nächste Erinnerung öffnen";
    case "Abschluss":
      return "Nächsten Abschlussfall öffnen";
    case "Kaufinteresse":
      return "Nächsten Fall mit Kaufinteresse öffnen";
    case "Übergaben":
      return "Nächste Übergabe öffnen";
    case "Mein Arbeitsbereich":
      return "Meinen nächsten Fall öffnen";
    case "Abläufe":
      return "Nächsten Ablaufschritt öffnen";
    case "Kontaktdossier":
      return "Nächstes Kontaktdossier öffnen";
    default:
      return "Nächsten Fall öffnen";
  }
}

export function getSessionContextLabel(badgeLabel?: SessionBadgeLabel): string {
  switch (badgeLabel) {
    case "Problemfälle":
      return "Problemfälle";
    case "Reparaturen":
      return "Reparaturen";
    case "Antworten":
      return "Antworten";
    case "Rückrufe":
      return "Rückrufe";
    case "Erinnerungen":
      return "Erinnerungen";
    case "Abschluss":
      return "Abschluss";
    case "Kaufinteresse":
      return "Kaufinteresse";
    case "Übergaben":
      return "Übergaben";
    case "Mein Arbeitsbereich":
      return "Mein Arbeitsbereich";
    case "Abläufe":
      return "Abläufe";
    case "Kontaktdossier":
      return "Kontaktdossier";
    default:
      return "Weiterarbeit";
  }
}

export function getSessionPreferredTab(badgeLabel?: SessionBadgeLabel): SessionPreferredTab | null {
  switch (badgeLabel) {
    case "Problemfälle":
      return "contact";
    case "Reparaturen":
      return "contact";
    case "Antworten":
      return "communication";
    case "Rückrufe":
      return "communication";
    case "Erinnerungen":
      return "communication";
    case "Abschluss":
      return "deal";
    case "Kaufinteresse":
      return "deal";
    case "Übergaben":
      return "contact";
    case "Mein Arbeitsbereich":
      return null;
    case "Abläufe":
      return null;
    case "Kontaktdossier":
      return "contact";
    default:
      return null;
  }
}

export function getFocusSessionLabel(label: string, badgeLabel?: SessionBadgeLabel): string {
  const contextLabel = getSessionContextLabel(badgeLabel);
  const isWatchlistLabel = label === "Merkliste" || label === "Watchlist";
  const isPersonalQueueLabel = label.startsWith("Mein Arbeitsbereich •") || label.startsWith("Meine Queue •");
  const normalizedLabel = isWatchlistLabel
    ? "Merkliste"
    : isPersonalQueueLabel
      ? label.replace("Meine Queue •", "Mein Arbeitsbereich •")
      : label;
  if (!badgeLabel || contextLabel === "Weiterarbeit" || label.includes(contextLabel)) {
    return normalizedLabel;
  }
  if (label === "Fallkontext") {
    return contextLabel;
  }
  if (isWatchlistLabel || label === "Zuletzt geöffnet" || label.startsWith("Suche •") || isPersonalQueueLabel) {
    return `${normalizedLabel} • ${contextLabel}`;
  }
  return label;
}
