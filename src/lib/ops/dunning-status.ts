export const DUNNING_CASE_STATE_LABELS = {
  action_required: "Aktion fällig",
  scheduled: "Termin geplant",
  final_wait: "Letzte Frist läuft",
  reply_received: "Antwort prüfen",
  paused: "Pausiert",
  court_review: "Gericht prüfen",
  data_issue: "Daten prüfen",
  closed: "Erledigt",
} as const;

export type DunningCaseState = keyof typeof DUNNING_CASE_STATE_LABELS;

export const DUNNING_COURT_EVENT_LABELS = {
  application_draft_created: "Mahnantrag erstellt",
  application_submitted: "An Amtsgericht gesendet",
  court_order_served: "Mahnbescheid zugestellt",
  objection_received: "Widerspruch eingegangen",
  enforcement_order_requested: "Vollstreckungsbescheid beantragt",
  enforcement_order_issued: "Vollstreckungsbescheid erlassen",
  closed: "Gerichtliches Mahnverfahren abgeschlossen",
} as const;

export type DunningCourtEventType = keyof typeof DUNNING_COURT_EVENT_LABELS;
