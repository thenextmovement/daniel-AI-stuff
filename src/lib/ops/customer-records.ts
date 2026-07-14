import { createHash } from "node:crypto";
import { buildCustomerName, isValidEmail, normalizeEmail } from "@/lib/quotes/customer";
import { attachmentName, isValidMockupAttachment } from "@/lib/quotes/mockups";
import { SupabaseRestError, supabaseRequest } from "@/lib/quotes/supabase-rest";
import {
  getTrelloBoardLists,
  getTrelloCard,
  moveTrelloCardToList,
  searchTrelloCards,
  updateTrelloCard,
  updateTrelloCustomField,
} from "@/lib/quotes/trello";
import type { TrelloAction, TrelloAttachment, TrelloEditableCustomField } from "@/lib/quotes/types";
import { QuoteValidationError } from "@/lib/quotes/validation";
import { getCustomerSegmentOption } from "@/lib/ops/customer-segments";

type MasterCustomerRow = {
  id: string;
  request_id: string;
  email: string;
  billing_email?: string | null;
  cc_emails?: string[] | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  company?: string | null;
  company_name?: string | null;
  name?: string | null;
  original_email?: string | null;
  original_phone?: string | null;
  updated_at?: string | null;
};

type FollowupQueueRow = {
  id: string;
  request_id?: string | null;
  customer_email?: string | null;
  customer_name?: string | null;
  customer_company?: string | null;
  followup_type?: string | null;
  followup_number?: number | null;
  email_subject?: string | null;
  reply_subject?: string | null;
  status?: string | null;
  scheduled_for?: string | null;
  sent_at?: string | null;
  reply_detected_at?: string | null;
  updated_at?: string | null;
  mockup_url?: string | null;
  mockup_url_2?: string | null;
  mockup_url_3?: string | null;
};

type LeadFollowupPlanRow = {
  id: string;
  request_id?: string | null;
  customer_email?: string | null;
  contactability_status?: string | null;
  call_after?: string | null;
  planning_reason?: string | null;
};

type FollowupBlacklistRow = {
  id: string;
  email?: string | null;
  domain?: string | null;
  reason?: string | null;
  added_by?: string | null;
  expires_at?: string | null;
};

type DocumentJourneyRow = {
  id: string;
  customer_id?: string | null;
  customer_email?: string | null;
  current_status?: string | null;
  document_name?: string | null;
  pandadoc_link?: string | null;
  total_value?: number | string | null;
  sent_at?: string | null;
  first_viewed_at?: string | null;
  completed_at?: string | null;
  reminder_1_sent?: string | null;
  reminder_2_sent?: string | null;
  reminder_3_sent?: string | null;
  reply_detected_at?: string | null;
  reply_classification?: string | null;
  updated_at?: string | null;
};

type WorkflowAuditRow = {
  id: string;
  document_id?: string | null;
  workflow_name?: string | null;
  action?: string | null;
  status?: string | null;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

type MasterRequestRow = {
  id: string;
  request_id: string;
  customer_id?: string | null;
  ac_deal_id?: number | null;
  ac_deal_stage?: string | null;
  trello_card_url?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  segment?: string | null;
  segment_status?: string | null;
  segment_confidence?: number | string | null;
  segment_source?: string | null;
  segment_classified_at?: string | null;
  segment_policy_version?: string | null;
  s_kategorie?: string | null;
  commercial_playbook?: Record<string, unknown> | null;
  estimated_value?: number | string | null;
  final_value?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  size?: string | null;
  color?: string[] | null;
  application?: string | null;
  delivery_time?: string | null;
  customer_type?: string | null;
  country?: string | null;
  form_id?: string | null;
  deal_status?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  landing_page_url?: string | null;
  referrer?: string | null;
};

type MasterQuoteRow = {
  id: string;
  request_id: string;
  pandadoc_status?: string | null;
  share_link?: string | null;
  edit_link?: string | null;
  total_value?: number | string | null;
  currency?: string | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  signed_at?: string | null;
  whatsapp_sent?: string | null;
  created_at?: string | null;
};

type MasterOrderRow = {
  id: string;
  customer_id?: string | null;
  request_id?: string | null;
  shopify_order_id?: string | null;
  shopify_order_number?: string | null;
  status?: string | null;
  fulfillment_status?: string | null;
  order_value?: number | string | null;
  currency?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  tracking_number?: string | null;
  carrier?: string | null;
  created_at?: string | null;
  shopify_created_at?: string | null;
  shipping_address?: Record<string, unknown> | null;
  billing_address?: Record<string, unknown> | null;
  source?: "master_orders" | "orders_by_email" | "crm_sales";
};

type OrdersByEmailRow = {
  email?: string | null;
  order_number?: string | null;
  total_price?: number | string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  tracking_number?: string | null;
  carrier?: string | null;
  created_at?: string | null;
};

type CrmSalesRow = {
  id: string;
  request_id?: string | null;
  shopify_order_id?: string | number | null;
  shopify_order_number?: string | number | null;
  shopify_order_name?: string | null;
  status?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_company?: string | null;
  customer_phone?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  tracking_company?: string | null;
  total_price?: number | string | null;
  currency?: string | null;
  note?: string | null;
  tags?: string | null;
  delivery_method?: string | null;
  delivery_min_days?: number | null;
  delivery_max_days?: number | null;
  estimated_delivery_date?: string | null;
  shopify_created_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  easybill_sync_status?: string | null;
  easybill_invoice_number?: string | null;
};

type CrmQuoteRow = {
  id: string;
  customer_id?: string | null;
  request_id?: string | null;
  quote_number?: string | null;
  status?: string | null;
  valid_until?: string | null;
  notes_internal?: string | null;
  notes_customer?: string | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  total_gross?: number | string | null;
  customer_live_total?: number | string | null;
  last_customer_event_type?: string | null;
  last_customer_event_at?: string | null;
  project_number?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  shopify_sync_status?: string | null;
  easybill_sync_status?: string | null;
  easybill_invoice_number?: string | null;
};

type CrmQuoteVersionRow = {
  id: string;
  quote_id?: string | null;
  version_number?: number | null;
  change_type?: string | null;
  description?: string | null;
  label?: string | null;
  is_locked?: boolean | null;
  created_at?: string | null;
  totals?: Record<string, unknown> | null;
};

type CrmQuoteVersionImageRow = {
  id: string;
  version_id?: string | null;
  item_index?: number | null;
  image_index?: number | null;
  original_url?: string | null;
  copied_url?: string | null;
  versioned_url?: string | null;
  copy_status?: string | null;
  created_at?: string | null;
};

type CallLogRow = {
  id: string;
  request_id?: string | null;
  called_at?: string | null;
  caller?: string | null;
  source?: string | null;
  outcome?: string | null;
  sentiment?: string | null;
  summary?: string | null;
  next_action_date?: string | null;
  confidence?: number | string | null;
  created_at?: string | null;
};

type VoiceAgentCallRow = {
  id: string;
  request_id?: string | null;
  created_at?: string | null;
  direction?: string | null;
  caller_phone?: string | null;
  caller_name?: string | null;
  duration_seconds?: number | null;
  recording_url?: string | null;
  summary?: string | null;
  detected_intent?: string | null;
  callback_needed?: boolean | null;
  escalated?: boolean | null;
  transfer_summary?: string | null;
  company_name?: string | null;
  human_transfer_completed?: boolean | null;
};

type EmailAgentLogRow = {
  id: string;
  from_email?: string | null;
  from_name?: string | null;
  subject?: string | null;
  body_preview?: string | null;
  category?: string | null;
  draft_created?: boolean | null;
  created_at?: string | null;
};

type MasterCommunicationRow = {
  id: string;
  type?: string | null;
  direction?: string | null;
  subject?: string | null;
  content?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type QuoteEmailLogRow = {
  id: number | string;
  recipient_email?: string | null;
  recipient_name?: string | null;
  subject?: string | null;
  status?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
  card_url?: string | null;
};

type InboxFollowupRow = {
  request_id?: string | null;
  scheduled_for?: string | null;
};

type InboxRequestRow = {
  request_id?: string | null;
  updated_at?: string | null;
};

type WorkboardCallbackRow = {
  request_id?: string | null;
  call_after?: string | null;
  contactability_status?: string | null;
};

const CUSTOMER_RECORDS_WORKFLOW_NAME = "customer_records_console";
const CUSTOMER_RECORDS_UPDATE_ACTION = "customer_record_update";
const CUSTOMER_RECORDS_CC_EMAILS_ACTION = "customer_record_cc_emails_updated";
const CUSTOMER_RECORDS_NOTE_ACTION = "customer_record_note";
const CUSTOMER_RECORDS_ROLLBACK_ACTION = "customer_record_rollback";
const CUSTOMER_RECORDS_FOLLOWUP_PAUSE_ACTION = "customer_followups_paused";
const CUSTOMER_RECORDS_FOLLOWUP_RESCHEDULE_ACTION = "customer_followups_rescheduled";
const CUSTOMER_RECORDS_CONTACT_BLOCK_ACTION = "customer_contact_blocked";
const CUSTOMER_RECORDS_TRELLO_FIELDS_ACTION = "customer_trello_fields_updated";
const CUSTOMER_RECORDS_TRELLO_CARD_ACTION = "customer_trello_card_updated";
const CUSTOMER_RECORDS_CALL_LOG_ACTION = "customer_call_logged";
const CUSTOMER_RECORDS_CALLBACK_SCHEDULED_ACTION = "customer_callback_scheduled";
const CUSTOMER_RECORDS_WORKBOARD_HANDLED_ACTION = "customer_workboard_handled";
const CUSTOMER_RECORDS_WORKBOARD_SNOOZED_ACTION = "customer_workboard_snoozed";
const CUSTOMER_RECORDS_CASE_OUTCOME_ACTION = "customer_case_outcome_applied";
const CUSTOMER_RECORDS_TEAM_STATE_ACTION = "customer_case_team_state";
const CUSTOMER_RECORDS_FLOW_STATE_ACTION = "customer_case_flow_state";
const CUSTOMER_RECORDS_DOWNSTREAM_SYNC_REPAIR_ACTION = "customer_record_downstream_sync_repaired";
const CUSTOMER_RECORDS_SALES_RECOVERY_ACTION = "customer_sales_recovery_started";
const CUSTOMER_RECORDS_SPECIAL_CASE_ACTION = "customer_special_case_reported";
const CUSTOMER_RECORDS_SPECIAL_CASE_RESOLVED_ACTION = "customer_special_case_resolved";
const CUSTOMER_RECORDS_SEGMENT_OVERRIDE_ACTION = "customer_request_segment_override";
const CUSTOMER_RECORDS_TASK_CREATED_ACTION = "customer_internal_task_created";
const CUSTOMER_RECORDS_TASK_UPDATED_ACTION = "customer_internal_task_updated";
const CUSTOMER_RECORDS_TASK_COMPLETED_ACTION = "customer_internal_task_completed";
const CUSTOMER_RECORDS_TASK_REOPENED_ACTION = "customer_internal_task_reopened";
const CUSTOMER_RECORDS_TASK_ACTIONS = new Set([
  CUSTOMER_RECORDS_TASK_CREATED_ACTION,
  CUSTOMER_RECORDS_TASK_UPDATED_ACTION,
  CUSTOMER_RECORDS_TASK_COMPLETED_ACTION,
  CUSTOMER_RECORDS_TASK_REOPENED_ACTION,
]);
const MASTER_CUSTOMER_SELECT =
  "id,request_id,email,billing_email,cc_emails,first_name,last_name,phone,company,company_name,name,original_email,original_phone,updated_at";
const MASTER_CUSTOMER_SELECT_LEGACY =
  "id,request_id,email,billing_email,first_name,last_name,phone,company,company_name,name,original_email,original_phone,updated_at";
const MAX_CUSTOMER_CC_EMAILS = 5;
const COMMUNICATION_AUDIT_ACTIONS = new Set([
  "customer_email_sent",
  "followup_email_sent",
  "customer_reply_detected",
]);

const TRELLO_BOARD_CONFIGS = [
  {
    id: "63d10c34105771f01ccf4296",
    key: "anfrage_management",
    name: "Anfragemanagement",
    url: "https://trello.com/b/YqBVAqrj/anfrage-management-neontrip",
    priority: 0,
  },
  {
    id: "62bae9b97705e7419ed64593",
    key: "quentin",
    name: "Quentin",
    url: "https://trello.com/b/9QNAfkv4/quentin-neon-signs",
    priority: 1,
  },
  {
    id: "6421a7000117c14498ccb6d0",
    key: "abdul",
    name: "Abdul",
    url: "https://trello.com/b/ioc6NLok/abdul-neontrip",
    priority: 2,
  },
] as const;

type TrelloBoardConfig = (typeof TRELLO_BOARD_CONFIGS)[number];

type EditableSnapshot = {
  email: string;
  billingEmail: string | null;
  ccEmails: string[];
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  company: string | null;
  displayName: string | null;
};

type CustomerContext = {
  master: MasterCustomerRow;
  request: MasterRequestRow | null;
  quote: MasterQuoteRow | null;
  order: MasterOrderRow | null;
  orderHistory: MasterOrderRow[];
  orderDiagnostic: CustomerOrderDiagnostic;
  crmSales: CrmSalesRow[];
  crmQuotes: CrmQuoteRow[];
  crmQuoteVersions: CrmQuoteVersionRow[];
  crmQuoteVersionImages: CrmQuoteVersionImageRow[];
  callLogs: CallLogRow[];
  voiceCalls: VoiceAgentCallRow[];
  followups: FollowupQueueRow[];
  plans: LeadFollowupPlanRow[];
  documents: DocumentJourneyRow[];
  communications: MasterCommunicationRow[];
  quoteEmails: QuoteEmailLogRow[];
  inboundEmails: EmailAgentLogRow[];
  audits: WorkflowAuditRow[];
  trello: CustomerTrelloContext | null;
  relatedCustomers: MasterCustomerRow[];
  relatedRequestRows: MasterRequestRow[];
  relatedQuoteRows: MasterQuoteRow[];
  relatedOrderRows: MasterOrderRow[];
  relatedFollowups: FollowupQueueRow[];
  relatedPlans: LeadFollowupPlanRow[];
  relatedAudits: WorkflowAuditRow[];
};

export type UpdateActor = {
  host?: string | null;
  mode?: "local_bypass" | "ops_session" | "automation";
  userAgent?: string | null;
  operatorName?: string | null;
};

export type CustomerAuditEntry = {
  id: string;
  createdAt: string | null;
  action: string;
  status: string;
  summary: string | null;
  actorLabel: string | null;
  changedFields: string[];
};

export type CustomerOpsNote = {
  id: string;
  note: string;
  authorLabel: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CustomerCommunicationEntry = {
  id: string;
  source: "quote_email_log" | "master_communications" | "followup_queue" | "document_journey" | "workflow_audit_log";
  title: string;
  preview: string | null;
  body: string | null;
  status: string | null;
  occurredAt: string | null;
  href: string | null;
  direction: string | null;
  messageId: string | null;
  conversationId: string | null;
  classification: string | null;
};

export type CustomerTimelineEntry = {
  id: string;
  source:
    | "quote_email_log"
    | "master_communications"
    | "followup_queue"
    | "document_journey"
    | "email_agent_log"
    | "master_quotes"
    | "master_orders"
    | "workflow_audit_log";
  title: string;
  description: string | null;
  status: string | null;
  occurredAt: string | null;
  href: string | null;
  direction: "inbound" | "outbound" | "internal" | "system";
  valueLabel: string | null;
  body: string | null;
};

export type CustomerRequestSummary = {
  title: string | null;
  description: string | null;
  status: string | null;
  acDealId: number | null;
  acDealStage: string | null;
  dealStatus: string | null;
  segment: string | null;
  segmentLabel?: string | null;
  segmentStatus?: string | null;
  segmentConfidence?: number | null;
  segmentSource?: string | null;
  segmentClassifiedAt?: string | null;
  segmentPolicyVersion?: string | null;
  sKategorie?: string | null;
  estimatedValue: number | null;
  finalValue: number | null;
  size: string | null;
  colors: string[];
  application: string | null;
  deliveryTime: string | null;
  customerType: string | null;
  country: string | null;
  formId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  landingPageUrl: string | null;
  referrer: string | null;
  trelloCardUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CustomerQuoteSummary = {
  status: string | null;
  totalValue: number | null;
  currency: string | null;
  shareLink: string | null;
  editLink: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  whatsappSentAt: string | null;
};

export type CustomerOrderSummary = {
  orderNumber: string | null;
  status: string | null;
  fulfillmentStatus: string | null;
  orderValue: number | null;
  currency: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  source: "master_orders" | "orders_by_email" | "crm_sales";
};

export type CustomerOrderHistoryEntry = {
  id: string;
  orderNumber: string | null;
  status: string | null;
  fulfillmentStatus: string | null;
  orderValue: number | null;
  currency: string | null;
  createdAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  source: "master_orders" | "orders_by_email" | "crm_sales";
};

export type CustomerOrderDiagnostic = {
  status: "linked" | "unlinked";
  summary: string;
  details: string[];
};

export type CustomerCrmSalesEntry = {
  id: string;
  orderNumber: string | null;
  status: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  totalPrice: number | null;
  currency: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  trackingCompany: string | null;
  estimatedDeliveryDate: string | null;
  deliveryMethod: string | null;
  deliveryWindowLabel: string | null;
  easybillSyncStatus: string | null;
  easybillInvoiceNumber: string | null;
  note: string | null;
  tags: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerCompany: string | null;
  createdAt: string | null;
};

export type CustomerCrmQuoteVersion = {
  id: string;
  versionNumber: number | null;
  changeType: string | null;
  label: string | null;
  description: string | null;
  isLocked: boolean;
  createdAt: string | null;
  totalGross: number | null;
};

export type CustomerCrmQuoteImage = {
  id: string;
  versionId: string | null;
  itemIndex: number | null;
  imageIndex: number | null;
  url: string | null;
  copyStatus: string | null;
};

export type CustomerCrmQuoteSummary = {
  id: string;
  quoteNumber: string | null;
  status: string | null;
  validUntil: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  totalGross: number | null;
  customerLiveTotal: number | null;
  lastCustomerEventType: string | null;
  lastCustomerEventAt: string | null;
  notesInternal: string | null;
  notesCustomer: string | null;
  projectNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  shopifySyncStatus: string | null;
  easybillSyncStatus: string | null;
  easybillInvoiceNumber: string | null;
  versions: CustomerCrmQuoteVersion[];
  latestVersionImages: CustomerCrmQuoteImage[];
};

export type CustomerFollowupMockupImage = {
  url: string;
  label: string;
  followupId: string;
  followupNumber: number | null;
  status: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
};

export type CustomerCallOpsSummary = {
  contactabilityStatus: string | null;
  nextCallbackAt: string | null;
  planningReason: string | null;
  liveCallLogCount: number;
  auditCallLogCount: number;
  liveVoiceCallCount: number;
  totalCallCount: number;
  latestLoggedCallAt: string | null;
  latestLoggedCallSummary: string | null;
  latestVoiceCallAt: string | null;
  latestVoiceCallSummary: string | null;
  recentCalls: Array<{
    id: string;
    source: "audit" | "call_log" | "voice_call";
    occurredAt: string | null;
    summary: string | null;
  }>;
};

export type CustomerSalesRecoverySummary = {
  status: "not_started" | "ready" | "active" | "resolved";
  startedAt: string | null;
  reason: string | null;
  actorLabel: string | null;
  viewedAt: string | null;
  nextCallbackAt: string | null;
  phoneAvailable: boolean;
  orderLinked: boolean;
};

export type CustomerSpecialCaseKind =
  | "gift"
  | "replacement"
  | "dimmer_defect"
  | "power_supply"
  | "open_question"
  | "other";

export type CustomerSpecialCaseSummary = {
  status: "none" | "open" | "resolved";
  kind: CustomerSpecialCaseKind | null;
  label: string | null;
  detail: string | null;
  ownerName: string | null;
  dueAt: string | null;
  urgent: boolean;
  reportedAt: string | null;
  reportedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

export type CustomerCaseCoordinationSummary = {
  mode: "unassigned" | "assigned" | "handover";
  ownerName: string | null;
  handoverNote: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type CustomerCaseFlowSummary = {
  status: "idle" | "active" | "completed";
  flowKey: string | null;
  flowLabel: string | null;
  currentStepKey: string | null;
  currentStepLabel: string | null;
  completedKeys: string[];
  completedCount: number;
  totalSteps: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type CustomerOpsStateSummary = {
  status: "active" | "won" | "lost" | "callback" | "vacation" | "do_not_contact";
  label: string;
  detail: string | null;
  updatedAt: string | null;
  nextResumeAt: string | null;
  isClosed: boolean;
};

export type CustomerOpsAuditLike = {
  action?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type CustomerRelatedRequest = {
  masterCustomerId: string;
  requestId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  requestStatus: string | null;
  dealStatus: string | null;
  acDealId: number | null;
  acDealStage: string | null;
  segment: string | null;
  quoteStatus: string | null;
  quoteTotalValue: number | null;
  quoteCurrency: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  opsStatus: CustomerOpsStateSummary["status"];
  opsLabel: string;
  pendingFollowups: number;
  nextFollowupAt: string | null;
  nextCallbackAt: string | null;
  lastTouchAt: string | null;
  lastTouchLabel: string | null;
  updatedAt: string | null;
};

export type CustomerTrelloBoardCard = {
  boardId: string;
  boardKey: string;
  boardName: string;
  boardUrl: string;
  found: boolean;
  cardId: string | null;
  cardName: string | null;
  cardUrl: string | null;
  cardDescription: string | null;
  createdAt: string | null;
  listId: string | null;
  listName: string | null;
  listOptions: Array<{
    listId: string;
    label: string;
  }>;
  attachmentCount: number;
  mockupCount: number;
  hasReferenceImage: boolean;
};

export type CustomerTrelloAsset = {
  attachmentId: string;
  cardId: string;
  cardName: string | null;
  cardUrl: string | null;
  boardName: string;
  boardKey: string;
  name: string;
  mimeType: string | null;
  kind: "reference" | "mockup";
  proxyUrl: string;
};

export type CustomerTrelloContext = {
  cards: CustomerTrelloBoardCard[];
  referenceImage: CustomerTrelloAsset | null;
  mockups: CustomerTrelloAsset[];
  videoLinks: Array<{
    url: string;
    label: string;
    source: "attachment" | "comment" | "description";
    boardName: string;
    cardUrl: string | null;
    createdAt: string | null;
  }>;
  editableCards: CustomerTrelloEditableCard[];
};

export type CustomerTrelloFieldOption = {
  id: string;
  label: string;
};

export type CustomerTrelloField = {
  fieldId: string;
  name: string;
  type: string;
  value: string | boolean | null;
  displayValue: string | null;
  options: CustomerTrelloFieldOption[];
};

export type CustomerTrelloEditableCard = {
  cardId: string;
  cardName: string | null;
  cardUrl: string | null;
  boardName: string;
  boardKey: string;
  createdAt: string | null;
  fields: CustomerTrelloField[];
};

export type CustomerSearchResult = {
  masterCustomerId: string;
  requestId: string;
  email: string;
  billingEmail: string | null;
  ccEmails: string[];
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  company: string | null;
  displayName: string | null;
  originalEmail: string | null;
  originalPhone: string | null;
  updatedAt: string | null;
  affectedRows: {
    followupQueue: number;
    pendingFollowups: number;
    nextPendingFollowupAt: string | null;
    leadFollowupPlans: number;
    documentJourney: number;
  };
  downstreamPreview: {
    followupEmails: string[];
    followupNames: string[];
    documentStatuses: string[];
  };
  request: CustomerRequestSummary | null;
  quote: CustomerQuoteSummary | null;
  order: CustomerOrderSummary | null;
  orderHistory: CustomerOrderHistoryEntry[];
  orderDiagnostic: CustomerOrderDiagnostic;
  crmSales: CustomerCrmSalesEntry[];
  crmQuote: CustomerCrmQuoteSummary | null;
  followupMockups: CustomerFollowupMockupImage[];
  callOps: CustomerCallOpsSummary;
  salesRecovery: CustomerSalesRecoverySummary;
  specialCase: CustomerSpecialCaseSummary;
  caseCoordination: CustomerCaseCoordinationSummary;
  caseFlow: CustomerCaseFlowSummary;
  opsState: CustomerOpsStateSummary;
  relatedRequests: CustomerRelatedRequest[];
  trello: CustomerTrelloContext | null;
  communications: CustomerCommunicationEntry[];
  timeline: CustomerTimelineEntry[];
  notes: CustomerOpsNote[];
  internalTasks: CustomerInternalTask[];
  auditTrail: CustomerAuditEntry[];
};

export type CustomerWorkboardSection = {
  key: "due_followups" | "callbacks" | "sales_recovery" | "recent_replies" | "contact_stops";
  title: string;
  subtitle: string;
  results: CustomerSearchResult[];
};

export type CustomerActionResult = {
  record: CustomerSearchResult;
  count: number;
};

export type CustomerCaseOutcomeInput = {
  outcome: "won" | "lost" | "callback" | "vacation" | "do_not_contact";
  resumeAt?: string | null;
  reason?: string | null;
};

export type CustomerWorkboardStateInput = {
  state: "handled" | "snoozed";
  snoozeUntil?: string | null;
  reason?: string | null;
};

export type CustomerTeamStateInput = {
  mode: "assign" | "handover" | "clear";
  ownerName?: string | null;
  handoverNote?: string | null;
};

export type CustomerCaseFlowStateInput = {
  state: "started" | "step_completed" | "reset";
  flowKey?: string | null;
  flowLabel?: string | null;
  stepKey?: string | null;
  stepLabel?: string | null;
  completedKeys?: string[];
  totalSteps?: number | null;
};

export type CustomerSpecialCaseInput = {
  kind: CustomerSpecialCaseKind;
  note?: string | null;
  ownerName?: string | null;
  dueAt?: string | null;
  urgent?: boolean;
};

export type CustomerInternalTaskCategory =
  | "customer_followup"
  | "problem_case"
  | "procurement"
  | "production"
  | "call"
  | "admin"
  | "other";

export type CustomerInternalTaskPriority = "low" | "normal" | "high" | "urgent";

export type CustomerInternalTaskStatus = "open" | "done";

export type CustomerInternalTaskInput = {
  title: string;
  description?: string | null;
  assigneeName?: string | null;
  dueAt?: string | null;
  category?: CustomerInternalTaskCategory | null;
  priority?: CustomerInternalTaskPriority | null;
  requestId?: string | null;
  clientActionId?: string | null;
  idempotencyKey?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
};

export type CustomerInternalTaskUpdateInput = Partial<CustomerInternalTaskInput> & {
  taskId: string;
};

export type CustomerInternalTask = {
  id: string;
  title: string;
  description: string | null;
  status: CustomerInternalTaskStatus;
  category: CustomerInternalTaskCategory;
  priority: CustomerInternalTaskPriority;
  assigneeName: string | null;
  dueAt: string | null;
  requestId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  createdAt: string | null;
  createdBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  completedAt: string | null;
  completedBy: string | null;
  latestNote: string | null;
  clientActionId: string | null;
  idempotencyKey: string | null;
  sourceType: string | null;
  sourceId: string | null;
  originLabel: string;
  overdue: boolean;
};

export type CustomerInternalTaskBoard = {
  tasks: CustomerInternalTask[];
  counts: {
    open: number;
    dueToday: number;
    overdue: number;
    urgent: number;
    done: number;
  };
};

export type CustomerCallLogInput = {
  reached: boolean;
  leftVoicemail: boolean;
  customerOnVacation: boolean;
  askedForCallback: boolean;
  noInterest: boolean;
  emailConfirmed: boolean;
  offerDiscussed: boolean;
  whatsappPreferred: boolean;
  deleteRequested: boolean;
  note: string | null;
};

export type CustomerTrelloFieldUpdateInput = {
  fieldId: string;
  value: string | boolean | null;
};

export type CustomerTrelloCardUpdateInput = {
  boardKey: string;
  cardId: string;
  name?: string;
  desc?: string;
  listId?: string | null;
};

export type CustomerUpdateFields = {
  email?: string;
  billingEmail?: string;
  ccEmails?: string[] | string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
};

export type CustomerPreviewFieldChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type CustomerPreviewTableImpact = {
  table: string;
  rows: number;
  fields: string[];
};

export type CustomerUpdatePreview = {
  requestId: string;
  displayName: string | null;
  changes: CustomerPreviewFieldChange[];
  impactedTables: CustomerPreviewTableImpact[];
  warnings: string[];
};

export type CustomerUpdatePlan = {
  next: EditableSnapshot;
  masterPatch: Record<string, string | string[] | null>;
  followupPatch: Record<string, string | null> | null;
  leadFollowupPatch: Record<string, string | null> | null;
  documentJourneyPatch: Record<string, string | null> | null;
};

type CustomerDownstreamRepairContext = Pick<CustomerContext, "master" | "followups" | "plans" | "documents">;

export type CustomerSearchMode = "request_id" | "email" | "name" | "phone" | "deal" | "trello";

function trimNullable(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function normalizeOptionalEmail(value: string | null | undefined) {
  const normalized = trimNullable(value);
  if (!normalized) return null;
  if (!isValidEmail(normalized)) {
    throw new QuoteValidationError("Gueltige E-Mail-Adresse erforderlich.");
  }
  return normalizeEmail(normalized);
}

function normalizeStoredEmail(value: string | null | undefined) {
  const normalized = trimNullable(value);
  return normalized && isValidEmail(normalized) ? normalizeEmail(normalized) : normalized;
}

function normalizeCcEmails(value: string[] | string | null | undefined) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[;,\n]/)
        .map((entry) => entry.trim());
  const normalized = rawValues
    .map((entry) => trimNullable(entry))
    .filter(Boolean)
    .map((entry) => {
      if (!isValidEmail(entry as string)) {
        throw new QuoteValidationError("Gueltige CC-E-Mail-Adresse erforderlich.");
      }
      return normalizeEmail(entry as string);
    });
  const unique = [...new Set(normalized)];
  if (unique.length > MAX_CUSTOMER_CC_EMAILS) {
    throw new QuoteValidationError(`Maximal ${MAX_CUSTOMER_CC_EMAILS} CC-E-Mail-Adressen speichern.`);
  }
  return unique;
}

function normalizeStoredCcEmails(value: string[] | null | undefined) {
  return normalizeCcEmails(Array.isArray(value) ? value : []);
}

function isMissingCcEmailsColumn(error: unknown) {
  if (!(error instanceof SupabaseRestError)) return false;
  const details = typeof error.details === "string" ? error.details : JSON.stringify(error.details || "");
  return details.includes("cc_emails") && (details.includes("column") || details.includes("schema cache") || details.includes("does not exist"));
}

function withoutCcEmailFilter(query: Record<string, string | number | boolean | null>) {
  const next = { ...query };
  if (typeof next.or === "string") {
    next.or = next.or.replace(/,?cc_emails\.cs\.\{[^}]*\}/g, "").replace(/\(,/, "(").replace(/,\)/, ")");
  }
  return next;
}

async function selectMasterCustomerRows(query: Record<string, string | number | boolean | null>) {
  try {
    return await supabaseRequest<MasterCustomerRow[]>("master_customers", undefined, {
      select: MASTER_CUSTOMER_SELECT,
      ...query,
    });
  } catch (error) {
    if (!isMissingCcEmailsColumn(error)) throw error;
    return supabaseRequest<MasterCustomerRow[]>("master_customers", undefined, {
      select: MASTER_CUSTOMER_SELECT_LEGACY,
      ...withoutCcEmailFilter(query),
    });
  }
}

function emailListEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function normalizePhoneSearch(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function normalizeRequestSearch(query: string) {
  const normalized = String(query || "").trim();
  if (!normalized) {
    throw new QuoteValidationError("Bitte Request-ID, E-Mail oder Namen eingeben.");
  }
  return normalized;
}

function escapeIlikeTerm(value: string) {
  return value.replace(/[%*,]/g, " ").replace(/\s+/g, " ").trim();
}

export function resolveCustomerSearchMode(query: string): CustomerSearchMode {
  const normalized = normalizeRequestSearch(query);
  const lower = normalized.toLowerCase();
  if (lower.startsWith("deal:") || lower.startsWith("ac:")) return "deal";
  if (lower.startsWith("trello:") || /trello\.com\/c\//i.test(normalized)) return "trello";
  if (normalized.includes("@")) return "email";
  if (/^\+?[\d\s()./-]{7,}$/.test(normalized) && /\d{6,}/.test(normalized.replace(/\D/g, ""))) {
    return "phone";
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    return "request_id";
  }
  return "name";
}

function companyValue(row: Pick<MasterCustomerRow, "company" | "company_name">) {
  return trimNullable(row.company) || trimNullable(row.company_name);
}

function toEditableSnapshot(row: MasterCustomerRow): EditableSnapshot {
  return {
    email: normalizeEmail(row.email),
    billingEmail: normalizeStoredEmail(row.billing_email),
    ccEmails: normalizeStoredCcEmails(row.cc_emails),
    firstName: trimNullable(row.first_name),
    lastName: trimNullable(row.last_name),
    phone: trimNullable(row.phone),
    company: companyValue(row),
    displayName: trimNullable(row.name) || buildCustomerName(row.first_name, row.last_name) || null,
  };
}

function uniqueValues(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function displayValue(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  const normalized = trimNullable(value);
  return normalized || null;
}

function numericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFutureIsoDate(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new QuoteValidationError("Bitte ein zukünftiges Datum angeben.");
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new QuoteValidationError("Ungültiges Datum für die Verschiebung.");
  }
  if (date.getTime() <= Date.now()) {
    throw new QuoteValidationError("Das neue Follow-up-Datum muss in der Zukunft liegen.");
  }
  return date.toISOString();
}

function normalizeTrelloFieldUpdate(field: CustomerTrelloField, value: string | boolean | null) {
  if (field.type === "checkbox") {
    return Boolean(value);
  }

  if (field.type === "list") {
    const normalized = trimNullable(typeof value === "string" ? value : null);
    if (!normalized) return null;
    if (!field.options.some((option) => option.id === normalized)) {
      throw new QuoteValidationError(`Ungültige Option für Trello-Feld ${field.name}.`);
    }
    return normalized;
  }

  if (field.type === "number") {
    const normalized = trimNullable(typeof value === "string" ? value : null);
    if (!normalized) return null;
    const parsed = Number(normalized.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      throw new QuoteValidationError(`Bitte eine gültige Zahl für Trello-Feld ${field.name} eingeben.`);
    }
    return String(parsed);
  }

  if (field.type === "date") {
    const normalized = trimNullable(typeof value === "string" ? value : null);
    if (!normalized) return null;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      throw new QuoteValidationError(`Bitte ein gültiges Datum für Trello-Feld ${field.name} eingeben.`);
    }
    return date.toISOString();
  }

  return trimNullable(typeof value === "string" ? value : null);
}

export function parseTrelloCardIdentifier(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const match = normalized.match(/trello\.com\/c\/([^/?#]+)/i);
  return match?.[1] || null;
}

function parseTrelloCardIdFromNotes(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const match = normalized.match(/Trello Card ID:\s*([0-9a-f]{24})/i);
  return match?.[1] || null;
}

function isReferenceImageAttachment(attachment: TrelloAttachment) {
  const normalized = attachmentName(attachment).toLowerCase();
  if (!normalized) return false;
  return /^image\.(png|jpe?g|webp|avif)$/i.test(normalized) || /^image[_-]?\d*\.(png|jpe?g|webp|avif)$/i.test(normalized);
}

export function selectReferenceTrelloAttachment(attachments: TrelloAttachment[]) {
  const sorted = [...attachments].sort((left, right) =>
    attachmentName(left).localeCompare(attachmentName(right), "de", { numeric: true }),
  );

  return (
    sorted.find((attachment) => /^image\.png$/i.test(attachmentName(attachment))) ||
    sorted.find((attachment) => isReferenceImageAttachment(attachment)) ||
    null
  );
}

export function listMockupTrelloAttachments(attachments: TrelloAttachment[]) {
  return [...attachments]
    .filter(isValidMockupAttachment)
    .sort((left, right) => attachmentName(left).localeCompare(attachmentName(right), "de", { numeric: true }));
}

function trelloAttachmentProxyUrl(cardId: string, attachmentId: string) {
  const params = new URLSearchParams({ cardId, attachmentId });
  return `/api/ops/customer-records/trello-attachments?${params.toString()}`;
}

type TrelloContextCardDetail = {
  board: TrelloBoardConfig;
  cardId: string;
  cardName: string | null;
  cardUrl: string | null;
  cardDescription: string | null;
  createdAt: string | null;
  listId: string | null;
  listName: string | null;
  listOptions: Array<{
    listId: string;
    label: string;
  }>;
  attachments: TrelloAttachment[];
  actions: TrelloAction[];
  editableFields: CustomerTrelloField[];
};

function createTrelloAsset(
  detail: TrelloContextCardDetail,
  attachment: TrelloAttachment,
  kind: "reference" | "mockup",
): CustomerTrelloAsset {
  return {
    attachmentId: attachment.id,
    cardId: detail.cardId,
    cardName: detail.cardName,
    cardUrl: detail.cardUrl,
    boardName: detail.board.name,
    boardKey: detail.board.key,
    name: attachmentName(attachment),
    mimeType: trimNullable(attachment.mimeType),
    kind,
    proxyUrl: trelloAttachmentProxyUrl(detail.cardId, attachment.id),
  };
}

function mapEditableTrelloField(field: TrelloEditableCustomField): CustomerTrelloField {
  return {
    fieldId: field.id,
    name: field.name,
    type: field.type,
    value: field.value,
    displayValue: field.displayValue,
    options: (field.options || []).map((option) => ({
      id: option.id,
      label: option.text,
    })),
  };
}

function uniqueVideoLinks<
  T extends {
    url: string;
  },
>(links: T[]) {
  const seen = new Set<string>();
  return links.filter((entry) => {
    const key = entry.url.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractUrls(input: string | null | undefined) {
  const matches = String(input || "").match(/https?:\/\/[^\s)<>\]]+/gi) || [];
  return matches.map((entry) => entry.replace(/[),.;]+$/, ""));
}

function isLikelyVideoUrl(value: string) {
  return /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(value) || /(?:video|ki-video|grok)/i.test(value);
}

function summarizeCommentLabel(text: string | null | undefined, createdAt: string | null | undefined) {
  const firstLine = String(text || "")
    .replace(/\*\*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) return firstLine.slice(0, 56);
  if (createdAt) {
    return `Kommentar-Link ${new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(
      new Date(createdAt),
    )}`;
  }
  return "Kommentar mit KI-Video";
}

function extractVideoLinks(detail: TrelloContextCardDetail) {
  const fromAttachments = (detail.attachments || [])
    .filter((attachment) => {
      const name = attachmentName(attachment);
      return Boolean(
        (attachment.mimeType && /^video\//i.test(attachment.mimeType)) ||
          (attachment.url && isLikelyVideoUrl(attachment.url)) ||
          isLikelyVideoUrl(name),
      );
    })
    .map((attachment) => ({
      url: String(attachment.url || ""),
      label: attachmentName(attachment) || "KI-Video",
      source: "attachment" as const,
      boardName: detail.board.name,
      cardUrl: detail.cardUrl,
      createdAt: null,
    }))
    .filter((entry) => entry.url);

  const fromDescription = extractUrls(detail.cardDescription)
    .filter(isLikelyVideoUrl)
    .map((url, index) => ({
      url,
      label: index === 0 ? "KI-Video Link" : `KI-Video Link ${index + 1}`,
      source: "description" as const,
      boardName: detail.board.name,
      cardUrl: detail.cardUrl,
      createdAt: null,
    }));

  const fromComments = (detail.actions || [])
    .flatMap((action) =>
      extractUrls(action.data?.text)
        .filter(isLikelyVideoUrl)
        .map((url, index) => ({
          url,
          label: summarizeCommentLabel(action.data?.text, action.date),
          source: "comment" as const,
          boardName: detail.board.name,
          cardUrl: detail.cardUrl,
          createdAt: action.date || null,
        })),
    );

  return uniqueVideoLinks([...fromAttachments, ...fromDescription, ...fromComments]).sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

async function fetchTrelloContext(
  requestId: string,
  trelloCardUrl: string | null | undefined,
  fallbackQueries: Array<string | null | undefined> = [],
  trelloCardIdHint?: string | null,
): Promise<CustomerTrelloContext | null> {
  const primaryCardIdentifier = parseTrelloCardIdentifier(trelloCardUrl);
  const byBoard = new Map<string, { id: string; name?: string; url?: string; idBoard?: string }>();
  const boardIds = TRELLO_BOARD_CONFIGS.map((board) => board.id);
  const searchQueries = uniqueValues([
    requestId,
    ...fallbackQueries.map((value) => trimNullable(value)).filter(Boolean),
  ]);

  for (const query of searchQueries) {
    try {
      const matches = await searchTrelloCards(query, boardIds);
      for (const match of matches) {
        if (!match.idBoard || byBoard.has(match.idBoard)) continue;
        byBoard.set(match.idBoard, match);
      }
      if (byBoard.size >= boardIds.length) break;
    } catch (error) {
      console.warn("customer records trello search failed", { requestId, query, error });
    }
  }

  const primaryCardLookupId = trimNullable(trelloCardIdHint) || primaryCardIdentifier;
  if (primaryCardLookupId) {
    try {
      const primaryCard = await getTrelloCard(primaryCardLookupId);
      if (primaryCard.idBoard && !byBoard.has(primaryCard.idBoard)) {
        byBoard.set(primaryCard.idBoard, {
          id: primaryCard.id,
          name: primaryCard.name,
          url: trimNullable(trelloCardUrl) || undefined,
          idBoard: primaryCard.idBoard,
        });
      }
    } catch (error) {
      console.warn("customer records trello primary lookup failed", { requestId, error });
    }
  }

  const details = (
    await Promise.all(
      TRELLO_BOARD_CONFIGS.map(async (board) => {
        const match = byBoard.get(board.id);
        if (!match) return null;
        try {
          const [detail, boardLists] = await Promise.all([getTrelloCard(match.id), getTrelloBoardLists(board.id)]);
          return {
            board,
            cardId: detail.id,
            cardName: trimNullable(detail.name),
            cardUrl: trimNullable(match.url),
            cardDescription: trimNullable(detail.desc),
            createdAt: detail.createdAt || null,
            listId: trimNullable(detail.idList),
            listName: trimNullable(boardLists.find((list) => list.id === detail.idList)?.name),
            listOptions: boardLists.map((list) => ({
              listId: list.id,
              label: trimNullable(list.name) || "Unbenannte Liste",
            })),
            attachments: detail.attachments || [],
            actions: detail.actions || [],
            editableFields: (detail.editableFields || []).map(mapEditableTrelloField),
          } satisfies TrelloContextCardDetail;
        } catch (error) {
          console.warn("customer records trello board lookup failed", { requestId, boardId: board.id, error });
          return {
            board,
            cardId: match.id,
            cardName: trimNullable(match.name),
            cardUrl: trimNullable(match.url),
            cardDescription: null,
            createdAt: null,
            listId: null,
            listName: null,
            listOptions: [],
            attachments: [],
            actions: [],
            editableFields: [],
          } satisfies TrelloContextCardDetail;
        }
      }),
    )
  ).filter(Boolean) as TrelloContextCardDetail[];

  if (!details.length) return null;

  const anfrageDetail = details.find((detail) => detail.board.key === "anfrage_management") || null;
  const referenceSource =
    (anfrageDetail && selectReferenceTrelloAttachment(anfrageDetail.attachments) ? anfrageDetail : null) ||
    details.find((detail) => Boolean(selectReferenceTrelloAttachment(detail.attachments))) ||
    null;
  const mockupSource =
    (anfrageDetail && listMockupTrelloAttachments(anfrageDetail.attachments).length > 0 ? anfrageDetail : null) ||
    details.find((detail) => listMockupTrelloAttachments(detail.attachments).length > 0) ||
    null;
  const referenceAttachment = referenceSource ? selectReferenceTrelloAttachment(referenceSource.attachments) : null;
  const videoSource = anfrageDetail || details[0];
  const videoLinks = videoSource ? extractVideoLinks(videoSource) : [];

  return {
    cards: TRELLO_BOARD_CONFIGS.map((board) => {
      const detail = details.find((entry) => entry.board.id === board.id);
      const mockups = detail ? listMockupTrelloAttachments(detail.attachments) : [];
      return {
        boardId: board.id,
        boardKey: board.key,
        boardName: board.name,
        boardUrl: board.url,
        found: Boolean(detail),
        cardId: detail?.cardId || null,
        cardName: detail?.cardName || null,
        cardUrl: detail?.cardUrl || null,
        cardDescription: detail?.cardDescription || null,
        createdAt: detail?.createdAt || null,
        listId: detail?.listId || null,
        listName: detail?.listName || null,
        listOptions: detail?.listOptions || [],
        attachmentCount: detail?.attachments.length || 0,
        mockupCount: mockups.length,
        hasReferenceImage: detail ? Boolean(selectReferenceTrelloAttachment(detail.attachments)) : false,
      };
    }),
    referenceImage: referenceSource && referenceAttachment ? createTrelloAsset(referenceSource, referenceAttachment, "reference") : null,
    mockups: mockupSource
      ? listMockupTrelloAttachments(mockupSource.attachments).map((attachment) =>
          createTrelloAsset(mockupSource, attachment, "mockup"),
        )
      : [],
    videoLinks,
    editableCards: details
      .filter((detail) => detail.editableFields.length > 0)
      .sort((left, right) => left.board.priority - right.board.priority)
      .map((detail) => ({
        cardId: detail.cardId,
        cardName: detail.cardName,
        cardUrl: detail.cardUrl,
        boardName: detail.board.name,
        boardKey: detail.board.key,
        createdAt: detail.createdAt,
        fields: detail.editableFields,
      })),
  };
}

function changeLabel(field: string) {
  switch (field) {
    case "email":
      return "E-Mail";
    case "billingEmail":
      return "Billing E-Mail";
    case "ccEmails":
      return "CC-E-Mails";
    case "firstName":
      return "Vorname";
    case "lastName":
      return "Nachname";
    case "phone":
      return "Telefon";
    case "company":
      return "Firma";
    case "displayName":
      return "Kontaktname";
    default:
      return field;
  }
}

function createPreviewChanges(current: EditableSnapshot, next: EditableSnapshot): CustomerPreviewFieldChange[] {
  const fields: Array<keyof EditableSnapshot> = [
    "email",
    "billingEmail",
    "ccEmails",
    "firstName",
    "lastName",
    "phone",
    "company",
    "displayName",
  ];

  return fields
    .filter((field) => current[field] !== next[field])
    .map((field) => ({
      field,
      label: changeLabel(field),
      before: displayValue(current[field]),
      after: displayValue(next[field]),
    }));
}

function createImpactedTables(
  context: Pick<CustomerContext, "followups" | "plans" | "documents">,
  plan: CustomerUpdatePlan,
): CustomerPreviewTableImpact[] {
  const impacts: CustomerPreviewTableImpact[] = [];

  impacts.push({
    table: "master_customers",
    rows: Object.keys(plan.masterPatch).length ? 1 : 0,
    fields: Object.keys(plan.masterPatch),
  });

  if (plan.followupPatch) {
    impacts.push({
      table: "followup_queue",
      rows: context.followups.length,
      fields: Object.keys(plan.followupPatch),
    });
  }

  if (plan.leadFollowupPatch) {
    impacts.push({
      table: "lead_followup_plans",
      rows: context.plans.length,
      fields: Object.keys(plan.leadFollowupPatch),
    });
  }

  if (plan.documentJourneyPatch) {
    impacts.push({
      table: "document_journey",
      rows: context.documents.length,
      fields: Object.keys(plan.documentJourneyPatch),
    });
  }

  return impacts.filter((entry) => entry.rows > 0 || entry.fields.length > 0);
}

function createPreviewWarnings(
  context: Pick<CustomerContext, "followups" | "documents">,
  plan: CustomerUpdatePlan,
) {
  const warnings: string[] = [];

  const pendingFollowups = context.followups.filter((row) => row.status === "pending");
  if (pendingFollowups.length) {
    warnings.push(
      `${pendingFollowups.length} offener Follow-up${pendingFollowups.length > 1 ? "s werden" : " wird"} mit den neuen Kontaktdaten weitergeführt.`,
    );
  }

  if (plan.documentJourneyPatch && context.documents.length) {
    warnings.push(
      `${context.documents.length} Dokumentenprozess${context.documents.length > 1 ? "e" : ""} erhält die neue E-Mail-Adresse.`,
    );
  }

  if (plan.followupPatch && !context.followups.length) {
    warnings.push("Es gibt aktuell keine Follow-up-Queue-Einträge zu diesem Datensatz.");
  }

  return warnings;
}

function createAuditSummary(changes: CustomerPreviewFieldChange[]) {
  return changes.map((change) => change.label).join(", ");
}

function actorLabel(actor?: UpdateActor) {
  if (!actor) return null;
  const operatorName = trimNullable(actor.operatorName);
  if (operatorName) {
    if (actor.mode === "local_bypass") return actor.host ? `${operatorName} • lokal via ${actor.host}` : operatorName;
    if (actor.mode === "ops_session") return actor.host ? `${operatorName} • ops-session via ${actor.host}` : operatorName;
    if (actor.mode === "automation") return actor.host ? `${operatorName} • automation via ${actor.host}` : `${operatorName} • automation`;
    return operatorName;
  }
  if (actor.mode === "local_bypass") return actor.host ? `lokal via ${actor.host}` : "lokal";
  if (actor.mode === "ops_session") return actor.host ? `ops-session via ${actor.host}` : "ops-session";
  if (actor.mode === "automation") return actor.host ? `automation via ${actor.host}` : "automation";
  return null;
}

function mapAuditEntry(row: WorkflowAuditRow): CustomerAuditEntry {
  const metadata = row.metadata || {};
  const changedFields = Array.isArray(metadata.changed_fields)
    ? metadata.changed_fields.map((field) => String(field))
    : [];

  return {
    id: row.id,
    createdAt: row.created_at || null,
    action: String(row.action || ""),
    status: String(row.status || ""),
    summary: typeof metadata.summary === "string" ? metadata.summary : row.error_message || null,
    actorLabel:
      typeof metadata.actor_label === "string"
        ? metadata.actor_label
        : typeof metadata.actor === "object" && metadata.actor && "label" in metadata.actor
          ? String((metadata.actor as { label?: string }).label || "")
          : null,
    changedFields,
  };
}

function auditCcEmails(row: WorkflowAuditRow) {
  const metadata = row.metadata || {};
  const after = typeof metadata.after === "object" && metadata.after ? (metadata.after as Record<string, unknown>) : null;
  const raw = Array.isArray(after?.ccEmails)
    ? after?.ccEmails
    : Array.isArray(metadata.cc_emails)
      ? metadata.cc_emails
      : null;
  return raw ? normalizeCcEmails(raw.map((entry) => String(entry || ""))) : null;
}

function applyAuditCcEmails(master: MasterCustomerRow, audits: WorkflowAuditRow[]) {
  const latestCcAudit = audits
    .filter((row) => row.action === CUSTOMER_RECORDS_UPDATE_ACTION || row.action === CUSTOMER_RECORDS_CC_EMAILS_ACTION)
    .map((row) => ({ row, ccEmails: auditCcEmails(row) }))
    .filter((entry): entry is { row: WorkflowAuditRow; ccEmails: string[] } => Boolean(entry.ccEmails))
    .sort((left, right) => new Date(right.row.created_at || 0).getTime() - new Date(left.row.created_at || 0).getTime())[0] || null;
  return latestCcAudit ? { ...master, cc_emails: latestCcAudit.ccEmails } : master;
}

function isEditableSnapshot(value: unknown): value is EditableSnapshot {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return typeof input.email === "string";
}

function snapshotEquals(left: EditableSnapshot, right: EditableSnapshot) {
  return (
    left.email === right.email &&
    left.billingEmail === right.billingEmail &&
    emailListEqual(left.ccEmails, right.ccEmails) &&
    left.firstName === right.firstName &&
    left.lastName === right.lastName &&
    left.phone === right.phone &&
    left.company === right.company &&
    left.displayName === right.displayName
  );
}

function mapNoteEntry(row: WorkflowAuditRow): CustomerOpsNote {
  const metadata = row.metadata || {};
  return {
    id: row.id,
    note: typeof metadata.note_text === "string" ? metadata.note_text : row.error_message || "",
    authorLabel:
      typeof metadata.actor_label === "string"
        ? metadata.actor_label
        : typeof metadata.actor === "object" && metadata.actor && "label" in metadata.actor
          ? String((metadata.actor as { label?: string }).label || "")
          : null,
    createdAt: row.created_at || null,
    updatedAt: row.created_at || null,
  };
}

function auditText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function auditNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildOrFilter(clauses: string[]) {
  const normalized = clauses.filter(Boolean);
  return normalized.length ? `(${normalized.join(",")})` : "";
}

function communicationAuditHref(metadata: Record<string, unknown>) {
  return (
    auditText(metadata, "pandadoc_link") ||
    auditText(metadata, "share_link") ||
    auditText(metadata, "card_url") ||
    auditText(metadata, "trello_card_url")
  );
}

function communicationAuditPreview(metadata: Record<string, unknown>) {
  return (
    auditText(metadata, "subject") ||
    auditText(metadata, "customer_email") ||
    auditText(metadata, "reply_preview") ||
    auditText(metadata, "reason")
  );
}

function communicationAuditDescription(metadata: Record<string, unknown>) {
  const parts = [
    auditText(metadata, "customer_email"),
    auditText(metadata, "subject"),
    auditText(metadata, "classification"),
    auditText(metadata, "message_id") ? `Message ${auditText(metadata, "message_id")}` : null,
    auditText(metadata, "conversation_id") ? `Conversation ${auditText(metadata, "conversation_id")}` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" • ") : null;
}

function communicationAuditBody(metadata: Record<string, unknown>) {
  return (
    auditText(metadata, "reply_preview") ||
    auditText(metadata, "summary") ||
    auditText(metadata, "reason") ||
    communicationAuditDescription(metadata)
  );
}

function summarizeCallAudit(metadata: Record<string, unknown>) {
  const flagLabels = new Map([
    ["erreicht", "Erreicht"],
    ["voicemail", "Voicemail"],
    ["urlaub", "Im Urlaub"],
    ["rückruf", "Rückruf gewünscht"],
    ["kein_interesse", "Kein Interesse"],
    ["email_bestätigt", "E-Mail bestätigt"],
    ["angebot_besprochen", "Angebot besprochen"],
    ["whatsapp_bevorzugt", "WhatsApp bevorzugt"],
    ["datenlöschung", "Datenlöschung angefragt"],
  ]);
  const flags = Array.isArray(metadata.call_flags)
    ? metadata.call_flags.map((value) => flagLabels.get(String(value)) || String(value))
    : [];
  const note = auditText(metadata, "note");
  const summary = [
    flags.length ? `Status: ${flags.join(", ")}` : null,
    note,
  ].filter(Boolean);
  return summary.length ? summary.join(" • ") : null;
}

function dateTimeMs(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function pendingCallbackAfterCall(callbackAt: string | null | undefined, latestCallAtMs: number | null) {
  if (!callbackAt) return null;
  const callbackAtMs = dateTimeMs(callbackAt);
  if (callbackAtMs === null) return callbackAt;
  if (latestCallAtMs !== null && latestCallAtMs >= callbackAtMs) return null;
  return callbackAt;
}

function communicationAuditTitle(row: WorkflowAuditRow, metadata: Record<string, unknown>) {
  const subtype = auditText(metadata, "subtype");
  switch (row.action) {
    case "customer_email_sent":
      return subtype === "quote_update" ? "Angebotsmail versendet" : "Kundenmail versendet";
    case "followup_email_sent": {
      const followupNumber = auditNumber(metadata, "followup_number");
      return followupNumber ? `Follow-up ${followupNumber} versendet` : "Follow-up versendet";
    }
    case "customer_reply_detected":
      return "Kundenantwort erkannt";
    default:
      return auditText(metadata, "summary") || "Kommunikationsereignis";
  }
}

function mapCommunicationAuditEntry(row: WorkflowAuditRow): CustomerCommunicationEntry | null {
  if (!row.action || !COMMUNICATION_AUDIT_ACTIONS.has(row.action)) return null;
  const metadata = row.metadata || {};

  return {
    id: `audit-comm-${row.id}`,
    source: "workflow_audit_log",
    title: communicationAuditTitle(row, metadata),
    preview: communicationAuditPreview(metadata),
    body: communicationAuditBody(metadata),
    status: trimNullable(row.status) || auditText(metadata, "classification"),
    occurredAt: row.created_at || null,
    href: communicationAuditHref(metadata),
    direction: auditText(metadata, "direction"),
    messageId: auditText(metadata, "message_id"),
    conversationId: auditText(metadata, "conversation_id"),
    classification: auditText(metadata, "classification"),
  };
}

function mapCommunicationAuditTimelineEntry(row: WorkflowAuditRow): CustomerTimelineEntry | null {
  if (!row.action || !COMMUNICATION_AUDIT_ACTIONS.has(row.action)) return null;
  const metadata = row.metadata || {};

  return {
    id: `audit-timeline-${row.id}`,
    source: "workflow_audit_log",
    title: communicationAuditTitle(row, metadata),
    description: communicationAuditDescription(metadata),
    status: trimNullable(row.status) || auditText(metadata, "classification"),
    occurredAt: row.created_at || null,
    href: communicationAuditHref(metadata),
    direction:
      auditText(metadata, "direction") === "inbound"
        ? "inbound"
        : auditText(metadata, "direction") === "outbound"
          ? "outbound"
          : "system",
    valueLabel:
      auditNumber(metadata, "total_value") !== null
        ? `${auditNumber(metadata, "total_value")} ${auditText(metadata, "currency") || "EUR"}`
        : null,
    body: communicationAuditBody(metadata),
  };
}

function mapOrderHistoryEntry(row: MasterOrderRow): CustomerOrderHistoryEntry {
  return {
    id: row.id,
    orderNumber: trimNullable(row.shopify_order_number),
    status: trimNullable(row.status),
    fulfillmentStatus: trimNullable(row.fulfillment_status),
    orderValue: numericValue(row.order_value),
    currency: trimNullable(row.currency),
    createdAt: row.shopify_created_at || row.created_at || null,
    shippedAt: row.shipped_at || null,
    deliveredAt: row.delivered_at || null,
    source: row.source || "master_orders",
  };
}

function emailCandidates(master: MasterCustomerRow) {
  return uniqueValues([master.email, master.billing_email, master.original_email, ...(master.cc_emails || [])]).map((email) => normalizeEmail(email));
}

function mapOrdersByEmailRow(row: OrdersByEmailRow, index: number): MasterOrderRow {
  return {
    id: `email-order-${trimNullable(row.email) || "unknown"}-${trimNullable(row.order_number) || index}`,
    customer_id: null,
    request_id: null,
    shopify_order_id: null,
    shopify_order_number: trimNullable(row.order_number),
    status: trimNullable(row.financial_status),
    fulfillment_status: trimNullable(row.fulfillment_status),
    order_value: numericValue(row.total_price),
    currency: "EUR",
    shipped_at: null,
    delivered_at: null,
    tracking_number: trimNullable(row.tracking_number),
    carrier: trimNullable(row.carrier),
    created_at: row.created_at || null,
    shopify_created_at: row.created_at || null,
    source: "orders_by_email",
  };
}

function mapCrmSalesRow(row: CrmSalesRow, index: number): MasterOrderRow {
  return {
    id: `crm-sale-${row.id || index}`,
    customer_id: null,
    request_id: trimNullable(row.request_id),
    shopify_order_id: row.shopify_order_id === null || row.shopify_order_id === undefined ? null : String(row.shopify_order_id),
    shopify_order_number:
      trimNullable(row.shopify_order_name) ||
      (row.shopify_order_number === null || row.shopify_order_number === undefined ? null : String(row.shopify_order_number)),
    status: trimNullable(row.financial_status) || trimNullable(row.status),
    fulfillment_status: trimNullable(row.fulfillment_status),
    order_value: numericValue(row.total_price),
    currency: trimNullable(row.currency) || "EUR",
    shipped_at: null,
    delivered_at: trimNullable(row.estimated_delivery_date),
    tracking_number: trimNullable(row.tracking_number),
    carrier: trimNullable(row.tracking_company),
    created_at: row.created_at || null,
    shopify_created_at: row.shopify_created_at || row.created_at || null,
    source: "crm_sales",
  };
}

function crmDeliveryWindowLabel(row: CrmSalesRow) {
  const min = row.delivery_min_days;
  const max = row.delivery_max_days;
  if (Number.isFinite(min) && Number.isFinite(max)) return `${min}-${max} Tage`;
  if (Number.isFinite(min)) return `ab ${min} Tage`;
  if (Number.isFinite(max)) return `bis ${max} Tage`;
  return null;
}

function mapCrmSalesEntry(row: CrmSalesRow): CustomerCrmSalesEntry {
  return {
    id: row.id,
    orderNumber:
      trimNullable(row.shopify_order_name) ||
      (row.shopify_order_number === null || row.shopify_order_number === undefined ? null : String(row.shopify_order_number)),
    status: trimNullable(row.status),
    financialStatus: trimNullable(row.financial_status),
    fulfillmentStatus: trimNullable(row.fulfillment_status),
    totalPrice: numericValue(row.total_price),
    currency: trimNullable(row.currency) || "EUR",
    trackingNumber: trimNullable(row.tracking_number),
    trackingUrl: trimNullable(row.tracking_url),
    trackingCompany: trimNullable(row.tracking_company),
    estimatedDeliveryDate: trimNullable(row.estimated_delivery_date),
    deliveryMethod: trimNullable(row.delivery_method),
    deliveryWindowLabel: crmDeliveryWindowLabel(row),
    easybillSyncStatus: trimNullable(row.easybill_sync_status),
    easybillInvoiceNumber: trimNullable(row.easybill_invoice_number),
    note: trimNullable(row.note),
    tags: trimNullable(row.tags),
    customerPhone: trimNullable(row.customer_phone),
    customerEmail: trimNullable(row.customer_email),
    customerCompany: trimNullable(row.customer_company),
    createdAt: row.shopify_created_at || row.created_at || null,
  };
}

function crmQuoteTotalFromTotals(totals: Record<string, unknown> | null | undefined) {
  if (!totals || typeof totals !== "object") return null;
  const candidate = (totals.total_gross ?? totals.totalGross ?? totals.total ?? null) as number | string | null;
  return numericValue(candidate);
}

function preferredCrmQuoteImageUrl(row: CrmQuoteVersionImageRow) {
  return trimNullable(row.versioned_url) || trimNullable(row.copied_url) || trimNullable(row.original_url);
}

function mapCrmQuoteVersion(row: CrmQuoteVersionRow): CustomerCrmQuoteVersion {
  return {
    id: row.id,
    versionNumber: row.version_number ?? null,
    changeType: trimNullable(row.change_type),
    label: trimNullable(row.label),
    description: trimNullable(row.description),
    isLocked: Boolean(row.is_locked),
    createdAt: row.created_at || null,
    totalGross: crmQuoteTotalFromTotals(row.totals),
  };
}

function mapCrmQuoteImage(row: CrmQuoteVersionImageRow): CustomerCrmQuoteImage {
  return {
    id: row.id,
    versionId: trimNullable(row.version_id),
    itemIndex: row.item_index ?? null,
    imageIndex: row.image_index ?? null,
    url: preferredCrmQuoteImageUrl(row),
    copyStatus: trimNullable(row.copy_status),
  };
}

function mapCrmQuoteSummary(
  row: CrmQuoteRow,
  versions: CrmQuoteVersionRow[],
  versionImages: CrmQuoteVersionImageRow[],
): CustomerCrmQuoteSummary {
  const mappedVersions = versions
    .map(mapCrmQuoteVersion)
    .sort((left, right) => {
      const leftVersion = left.versionNumber ?? 0;
      const rightVersion = right.versionNumber ?? 0;
      if (leftVersion !== rightVersion) return rightVersion - leftVersion;
      const leftTime = new Date(left.createdAt || 0).getTime();
      const rightTime = new Date(right.createdAt || 0).getTime();
      return rightTime - leftTime;
    });
  const latestVersionId = mappedVersions[0]?.id || null;
  const latestVersionImages = versionImages
    .filter((image) => trimNullable(image.version_id) === latestVersionId)
    .sort((left, right) => {
      const leftItem = left.item_index ?? 0;
      const rightItem = right.item_index ?? 0;
      if (leftItem !== rightItem) return leftItem - rightItem;
      return (left.image_index ?? 0) - (right.image_index ?? 0);
    })
    .map(mapCrmQuoteImage);

  return {
    id: row.id,
    quoteNumber: trimNullable(row.quote_number),
    status: trimNullable(row.status),
    validUntil: row.valid_until || null,
    sentAt: row.sent_at || null,
    viewedAt: row.viewed_at || null,
    acceptedAt: row.accepted_at || null,
    rejectedAt: row.rejected_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    totalGross: numericValue(row.total_gross),
    customerLiveTotal: numericValue(row.customer_live_total),
    lastCustomerEventType: trimNullable(row.last_customer_event_type),
    lastCustomerEventAt: row.last_customer_event_at || null,
    notesInternal: trimNullable(row.notes_internal),
    notesCustomer: trimNullable(row.notes_customer),
    projectNumber: trimNullable(row.project_number),
    contactEmail: trimNullable(row.contact_email),
    contactPhone: trimNullable(row.contact_phone),
    shopifySyncStatus: trimNullable(row.shopify_sync_status),
    easybillSyncStatus: trimNullable(row.easybill_sync_status),
    easybillInvoiceNumber: trimNullable(row.easybill_invoice_number),
    versions: mappedVersions,
    latestVersionImages,
  };
}

function filenameFromUrl(value: string) {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    return value.split(/[/?#]/)[0] || "";
  }
}

function followupMockupLabel(url: string, index: number) {
  const filename = filenameFromUrl(url);
  const match =
    filename.match(/\bmoc\s*ab[\s_-]*(0?[123])(?:\D|$)/i) ||
    filename.match(/\bmockup[\s_-]*(0?[123])(?:\D|$)/i);
  if (match?.[1]) return `Mockup ${Number(match[1])}`;
  return `Mockup ${index}`;
}

function mapFollowupMockups(followups: FollowupQueueRow[]): CustomerFollowupMockupImage[] {
  const images: CustomerFollowupMockupImage[] = [];
  const seen = new Set<string>();
  const sortedFollowups = [...followups].sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.sent_at || left.scheduled_for || 0).getTime();
    const rightTime = new Date(right.updated_at || right.sent_at || right.scheduled_for || 0).getTime();
    return rightTime - leftTime;
  });

  for (const followup of sortedFollowups) {
    const urls = [followup.mockup_url, followup.mockup_url_2, followup.mockup_url_3];
    for (const [index, value] of urls.entries()) {
      const url = trimNullable(value);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      images.push({
        url,
        label: followupMockupLabel(url, index + 1),
        followupId: followup.id,
        followupNumber: followup.followup_number ?? null,
        status: trimNullable(followup.status),
        scheduledFor: followup.scheduled_for || null,
        sentAt: followup.sent_at || null,
      });
    }
  }

  return images.slice(0, 8);
}

function mapRelatedRequest(
  row: MasterCustomerRow,
  request: MasterRequestRow | null,
  quote: MasterQuoteRow | null,
  order: MasterOrderRow | null,
  opsState: CustomerOpsStateSummary,
  pendingFollowups: FollowupQueueRow[],
  plans: LeadFollowupPlanRow[],
  lastTouchAt: string | null,
  lastTouchLabel: string | null,
): CustomerRelatedRequest {
  const snapshot = toEditableSnapshot(row);
  return {
    masterCustomerId: row.id,
    requestId: row.request_id,
    displayName: snapshot.displayName,
    email: snapshot.email,
    phone: snapshot.phone,
    company: snapshot.company,
    requestStatus: trimNullable(request?.status),
    dealStatus: trimNullable(request?.deal_status),
    acDealId: request?.ac_deal_id ?? null,
    acDealStage: trimNullable(request?.ac_deal_stage),
    segment: trimNullable(request?.segment),
    quoteStatus: trimNullable(quote?.pandadoc_status),
    quoteTotalValue: numericValue(quote?.total_value),
    quoteCurrency: trimNullable(quote?.currency),
    orderNumber: trimNullable(order?.shopify_order_number),
    orderStatus: trimNullable(order?.status),
    opsStatus: opsState.status,
    opsLabel: opsState.label,
    pendingFollowups: pendingFollowups.filter((entry) => entry.status === "pending").length,
    nextFollowupAt:
      [...pendingFollowups]
        .filter((entry) => entry.status === "pending")
        .sort((left, right) => new Date(left.scheduled_for || 0).getTime() - new Date(right.scheduled_for || 0).getTime())[0]
        ?.scheduled_for || null,
    nextCallbackAt:
      [...plans]
        .filter((entry) => Boolean(entry.call_after))
        .sort((left, right) => new Date(left.call_after || 0).getTime() - new Date(right.call_after || 0).getTime())[0]
        ?.call_after || null,
    lastTouchAt,
    lastTouchLabel,
    updatedAt: row.updated_at || null,
  };
}

function buildCallOpsSummary(context: Pick<CustomerContext, "plans" | "audits" | "callLogs" | "voiceCalls">): CustomerCallOpsSummary {
  const latestPlan = [...context.plans]
    .sort((left, right) => {
      const leftTime = new Date(left.call_after || 0).getTime();
      const rightTime = new Date(right.call_after || 0).getTime();
      return rightTime - leftTime;
    })[0] || null;
  const latestCallAudit = context.audits.find((row) => row.action === CUSTOMER_RECORDS_CALL_LOG_ACTION) || null;
  const latestCallbackAudit = context.audits.find((row) => row.action === CUSTOMER_RECORDS_CALLBACK_SCHEDULED_ACTION) || null;
  const latestLiveCall = [...context.callLogs]
    .sort((left, right) => {
      const leftTime = new Date(left.called_at || left.created_at || 0).getTime();
      const rightTime = new Date(right.called_at || right.created_at || 0).getTime();
      return rightTime - leftTime;
    })[0] || null;
  const latestVoiceCall = [...context.voiceCalls]
    .sort((left, right) => {
      const leftTime = new Date(left.created_at || 0).getTime();
      const rightTime = new Date(right.created_at || 0).getTime();
      return rightTime - leftTime;
    })[0] || null;
  const callAudits = context.audits.filter((row) => row.action === CUSTOMER_RECORDS_CALL_LOG_ACTION);
  const latestCallMetadata = latestCallAudit?.metadata || {};
  const latestCallAtMs = Math.max(
    dateTimeMs(latestCallAudit?.created_at) ?? 0,
    dateTimeMs(latestLiveCall?.called_at || latestLiveCall?.created_at) ?? 0,
    dateTimeMs(latestVoiceCall?.created_at) ?? 0,
  ) || null;
  const nextCallbackAt = pendingCallbackAfterCall(
    trimNullable(latestPlan?.call_after) ||
      auditText(latestCallbackAudit?.metadata || {}, "resume_at") ||
      trimNullable(latestLiveCall?.next_action_date),
    latestCallAtMs,
  );
  const recentCalls = [
    ...context.callLogs.map((row) => ({
      id: `call-log-${row.id}`,
      source: "call_log" as const,
      occurredAt: row.called_at || row.created_at || null,
      summary:
        trimNullable(row.summary) ||
        trimNullable(row.outcome) ||
        (trimNullable(row.next_action_date) ? `Nächster Schritt ${trimNullable(row.next_action_date)}` : null),
    })),
    ...callAudits.map((row) => ({
      id: `audit-call-${row.id}`,
      source: "audit" as const,
      occurredAt: row.created_at || null,
      summary: summarizeCallAudit(row.metadata || {}),
    })),
    ...context.voiceCalls.map((row) => ({
      id: `voice-call-${row.id}`,
      source: "voice_call" as const,
      occurredAt: row.created_at || null,
      summary:
        trimNullable(row.summary) ||
        trimNullable(row.detected_intent) ||
        trimNullable(row.transfer_summary) ||
        null,
    })),
  ]
    .sort((left, right) => {
      const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
      const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;
      return rightTime - leftTime;
    })
    .slice(0, 8);

  return {
    contactabilityStatus: trimNullable(latestPlan?.contactability_status),
    nextCallbackAt,
    planningReason:
      trimNullable(latestPlan?.planning_reason) ||
      auditText(latestCallbackAudit?.metadata || {}, "reason"),
    liveCallLogCount: context.callLogs.length,
    auditCallLogCount: callAudits.length,
    liveVoiceCallCount: context.voiceCalls.length,
    totalCallCount: context.callLogs.length + callAudits.length + context.voiceCalls.length,
    latestLoggedCallAt: latestLiveCall?.called_at || latestLiveCall?.created_at || latestCallAudit?.created_at || null,
    latestLoggedCallSummary:
      trimNullable(latestLiveCall?.summary) ||
      summarizeCallAudit(latestCallMetadata) ||
      null,
    latestVoiceCallAt: latestVoiceCall?.created_at || null,
    latestVoiceCallSummary:
      trimNullable(latestVoiceCall?.summary) ||
      trimNullable(latestVoiceCall?.detected_intent) ||
      trimNullable(latestVoiceCall?.transfer_summary) ||
      null,
    recentCalls,
  };
}

export function buildSalesRecoverySummary(
  context: Pick<CustomerContext, "audits" | "quote" | "order" | "orderDiagnostic" | "master">,
  callOps: Pick<CustomerCallOpsSummary, "nextCallbackAt">,
): CustomerSalesRecoverySummary {
  const latestRecoveryAudit = context.audits.find((row) => row.action === CUSTOMER_RECORDS_SALES_RECOVERY_ACTION) || null;
  const metadata = latestRecoveryAudit?.metadata || {};
  const viewedAt = context.quote?.viewed_at || null;
  const orderLinked = Boolean(context.order) || context.orderDiagnostic.status !== "unlinked";
  const phoneAvailable = Boolean(trimNullable(context.master.phone));

  if (latestRecoveryAudit && orderLinked) {
    return {
      status: "resolved",
      startedAt: latestRecoveryAudit.created_at || null,
      reason: auditText(metadata, "reason"),
      actorLabel: auditText(metadata, "actor_label"),
      viewedAt,
      nextCallbackAt: callOps.nextCallbackAt,
      phoneAvailable,
      orderLinked,
    };
  }

  if (latestRecoveryAudit) {
    return {
      status: "active",
      startedAt: latestRecoveryAudit.created_at || null,
      reason: auditText(metadata, "reason"),
      actorLabel: auditText(metadata, "actor_label"),
      viewedAt,
      nextCallbackAt: callOps.nextCallbackAt,
      phoneAvailable,
      orderLinked,
    };
  }

  if (viewedAt && !orderLinked) {
    return {
      status: "ready",
      startedAt: null,
      reason: null,
      actorLabel: null,
      viewedAt,
      nextCallbackAt: callOps.nextCallbackAt,
      phoneAvailable,
      orderLinked,
    };
  }

  return {
    status: "not_started",
    startedAt: null,
    reason: null,
    actorLabel: null,
    viewedAt,
    nextCallbackAt: callOps.nextCallbackAt,
    phoneAvailable,
    orderLinked,
  };
}

function normalizeSpecialCaseKind(value: string | null | undefined): CustomerSpecialCaseKind | null {
  switch (value) {
    case "gift":
    case "replacement":
    case "dimmer_defect":
    case "power_supply":
    case "open_question":
    case "other":
      return value;
    default:
      return null;
  }
}

function specialCaseKindLabel(kind: CustomerSpecialCaseKind | null) {
  switch (kind) {
    case "gift":
      return "Geschenk / Kulanz";
    case "replacement":
      return "Ersatz / Nachlieferung";
    case "dimmer_defect":
      return "Dimmer defekt";
    case "power_supply":
      return "Anderes Netzteil";
    case "open_question":
      return "Offene Rückfrage";
    case "other":
      return "Sonderfall";
    default:
      return null;
  }
}

function auditBoolean(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  if (typeof value === "number") return value !== 0;
  return false;
}

export function buildSpecialCaseSummary(context: Pick<CustomerContext, "audits">): CustomerSpecialCaseSummary {
  const reports = [...context.audits]
    .filter((row) => row.action === CUSTOMER_RECORDS_SPECIAL_CASE_ACTION)
    .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
  const resolutions = [...context.audits]
    .filter((row) => row.action === CUSTOMER_RECORDS_SPECIAL_CASE_RESOLVED_ACTION)
    .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
  const latestReport = reports[0] || null;
  const latestResolution = resolutions[0] || null;

  if (!latestReport) {
    return {
      status: "none",
      kind: null,
      label: null,
      detail: null,
      ownerName: null,
      dueAt: null,
      urgent: false,
      reportedAt: null,
      reportedBy: null,
      resolvedAt: null,
      resolvedBy: null,
    };
  }

  const reportMetadata = latestReport.metadata || {};
  const kind = normalizeSpecialCaseKind(auditText(reportMetadata, "special_case_kind"));
  const label = specialCaseKindLabel(kind);
  const reportDetail = auditText(reportMetadata, "special_case_note");
  const ownerName = auditText(reportMetadata, "special_case_owner_name");
  const dueAt = auditText(reportMetadata, "special_case_due_at");
  const urgent = auditBoolean(reportMetadata, "special_case_urgent");
  const reportedBy =
    auditText(reportMetadata, "operator_name") ||
    auditText(reportMetadata, "actor_label") ||
    (typeof reportMetadata.actor === "object" && reportMetadata.actor && "label" in reportMetadata.actor
      ? String((reportMetadata.actor as { label?: string }).label || "")
      : null);

  const reportTimestamp = new Date(latestReport.created_at || 0).getTime();
  const resolutionTimestamp = latestResolution ? new Date(latestResolution.created_at || 0).getTime() : 0;
  const isResolved = Boolean(latestResolution && resolutionTimestamp >= reportTimestamp);
  const resolutionMetadata = latestResolution?.metadata || {};
  const resolvedBy =
    auditText(resolutionMetadata, "operator_name") ||
    auditText(resolutionMetadata, "actor_label") ||
    (typeof resolutionMetadata.actor === "object" && resolutionMetadata.actor && "label" in resolutionMetadata.actor
      ? String((resolutionMetadata.actor as { label?: string }).label || "")
      : null);

  return {
    status: isResolved ? "resolved" : "open",
    kind,
    label,
    detail: reportDetail,
    ownerName,
    dueAt,
    urgent,
    reportedAt: latestReport.created_at || null,
    reportedBy: reportedBy || null,
    resolvedAt: isResolved ? latestResolution?.created_at || null : null,
    resolvedBy: isResolved ? resolvedBy || null : null,
  };
}

function normalizeTaskCategory(value: string | null | undefined): CustomerInternalTaskCategory {
  switch (value) {
    case "customer_followup":
    case "problem_case":
    case "procurement":
    case "production":
    case "call":
    case "admin":
    case "other":
      return value;
    default:
      return "other";
  }
}

function normalizeTaskPriority(value: string | null | undefined): CustomerInternalTaskPriority {
  switch (value) {
    case "low":
    case "normal":
    case "high":
    case "urgent":
      return value;
    default:
      return "normal";
  }
}

function taskActorLabel(metadata: Record<string, unknown>) {
  return (
    auditText(metadata, "operator_name") ||
    auditText(metadata, "actor_label") ||
    (typeof metadata.actor === "object" && metadata.actor && "label" in metadata.actor
      ? String((metadata.actor as { label?: string }).label || "")
      : null)
  );
}

function taskOriginLabel(task: Pick<CustomerInternalTask, "category" | "requestId" | "customerName">) {
  const prefix = task.requestId
    ? task.customerName
      ? `Kunde: ${task.customerName}`
      : `Request: ${task.requestId}`
    : "Intern";
  switch (task.category) {
    case "customer_followup":
      return `${prefix} / Follow-up`;
    case "problem_case":
      return `${prefix} / Problemfall`;
    case "procurement":
      return `${prefix} / Nachbestellung`;
    case "production":
      return `${prefix} / Produktion`;
    case "call":
      return `${prefix} / Call`;
    case "admin":
      return "Intern / Admin";
    default:
      return prefix;
  }
}

function isTaskOverdue(task: Pick<CustomerInternalTask, "status" | "dueAt">) {
  if (task.status !== "open" || !task.dueAt) return false;
  const due = new Date(task.dueAt).getTime();
  return Number.isFinite(due) && due < Date.now();
}

export function buildCustomerInternalTaskBoardFromAudits(
  audits: WorkflowAuditRow[],
  options?: {
    requestId?: string | null;
    assigneeName?: string | null;
    includeDone?: boolean;
  },
): CustomerInternalTaskBoard {
  const byId = new Map<string, CustomerInternalTask>();
  const ordered = [...audits]
    .filter((row) => CUSTOMER_RECORDS_TASK_ACTIONS.has(String(row.action || "")))
    .sort((left, right) => new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime());

  for (const row of ordered) {
    const metadata = row.metadata || {};
    const taskId = auditText(metadata, "task_id");
    if (!taskId) continue;
    const existing = byId.get(taskId) || null;
    const action = String(row.action || "");
    const patch = {
      title: auditText(metadata, "task_title"),
      description: auditText(metadata, "task_description"),
      category: normalizeTaskCategory(auditText(metadata, "task_category")),
      priority: normalizeTaskPriority(auditText(metadata, "task_priority")),
      assigneeName: auditText(metadata, "task_assignee_name"),
      dueAt: auditText(metadata, "task_due_at"),
      requestId: auditText(metadata, "task_request_id") || auditText(metadata, "request_id") || null,
      customerName: auditText(metadata, "task_customer_name"),
      customerEmail: auditText(metadata, "task_customer_email"),
      latestNote: auditText(metadata, "task_note") || auditText(metadata, "task_completion_note"),
      clientActionId: auditText(metadata, "task_client_action_id"),
      idempotencyKey: auditText(metadata, "task_idempotency_key"),
      sourceType: auditText(metadata, "task_source_type"),
      sourceId: auditText(metadata, "task_source_id"),
      actor: taskActorLabel(metadata),
    };

    if (!existing) {
      byId.set(taskId, {
        id: taskId,
        title: patch.title || "Interne Aufgabe",
        description: patch.description,
        status: action === CUSTOMER_RECORDS_TASK_COMPLETED_ACTION ? "done" : "open",
        category: patch.category,
        priority: patch.priority,
        assigneeName: patch.assigneeName,
        dueAt: patch.dueAt,
        requestId: patch.requestId,
        customerName: patch.customerName,
        customerEmail: patch.customerEmail,
        createdAt: row.created_at || null,
        createdBy: patch.actor,
        updatedAt: row.created_at || null,
        updatedBy: patch.actor,
        completedAt: action === CUSTOMER_RECORDS_TASK_COMPLETED_ACTION ? row.created_at || null : null,
        completedBy: action === CUSTOMER_RECORDS_TASK_COMPLETED_ACTION ? patch.actor : null,
        latestNote: patch.latestNote,
        clientActionId: patch.clientActionId,
        idempotencyKey: patch.idempotencyKey,
        sourceType: patch.sourceType,
        sourceId: patch.sourceId,
        originLabel: "Intern",
        overdue: false,
      });
    } else {
      byId.set(taskId, {
        ...existing,
        title: patch.title || existing.title,
        description: patch.description ?? existing.description,
        category: patch.category || existing.category,
        priority: patch.priority || existing.priority,
        assigneeName: patch.assigneeName ?? existing.assigneeName,
        dueAt: patch.dueAt ?? existing.dueAt,
        requestId: patch.requestId ?? existing.requestId,
        customerName: patch.customerName ?? existing.customerName,
        customerEmail: patch.customerEmail ?? existing.customerEmail,
        status:
          action === CUSTOMER_RECORDS_TASK_COMPLETED_ACTION
            ? "done"
            : action === CUSTOMER_RECORDS_TASK_REOPENED_ACTION
              ? "open"
              : existing.status,
        updatedAt: row.created_at || existing.updatedAt,
        updatedBy: patch.actor || existing.updatedBy,
        completedAt:
          action === CUSTOMER_RECORDS_TASK_COMPLETED_ACTION
            ? row.created_at || existing.completedAt
            : action === CUSTOMER_RECORDS_TASK_REOPENED_ACTION
              ? null
              : existing.completedAt,
        completedBy:
          action === CUSTOMER_RECORDS_TASK_COMPLETED_ACTION
            ? patch.actor || existing.completedBy
            : action === CUSTOMER_RECORDS_TASK_REOPENED_ACTION
              ? null
              : existing.completedBy,
        latestNote: patch.latestNote ?? existing.latestNote,
        clientActionId: patch.clientActionId ?? existing.clientActionId,
        idempotencyKey: patch.idempotencyKey ?? existing.idempotencyKey,
        sourceType: patch.sourceType ?? existing.sourceType,
        sourceId: patch.sourceId ?? existing.sourceId,
      });
    }
  }

  let tasks = [...byId.values()].map((task) => ({
    ...task,
    originLabel: taskOriginLabel(task),
    overdue: isTaskOverdue(task),
  }));

  const requestId = trimNullable(options?.requestId);
  const assigneeName = trimNullable(options?.assigneeName)?.toLowerCase();
  if (requestId) {
    tasks = tasks.filter((task) => task.requestId === requestId);
  }
  if (assigneeName) {
    tasks = tasks.filter((task) => (task.assigneeName || "").trim().toLowerCase() === assigneeName);
  }
  if (!options?.includeDone) {
    tasks = tasks.filter((task) => task.status === "open");
  }

  tasks.sort((left, right) => {
    if (left.status !== right.status) return left.status === "open" ? -1 : 1;
    if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
    const priorityRank: Record<CustomerInternalTaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    if (priorityRank[left.priority] !== priorityRank[right.priority]) return priorityRank[left.priority] - priorityRank[right.priority];
    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
  });

  const today = new Date().toISOString().slice(0, 10);
  return {
    tasks,
    counts: {
      open: tasks.filter((task) => task.status === "open").length,
      dueToday: tasks.filter((task) => task.status === "open" && task.dueAt?.slice(0, 10) === today).length,
      overdue: tasks.filter((task) => task.overdue).length,
      urgent: tasks.filter((task) => task.status === "open" && task.priority === "urgent").length,
      done: tasks.filter((task) => task.status === "done").length,
    },
  };
}

function buildCaseCoordinationSummary(context: Pick<CustomerContext, "audits">): CustomerCaseCoordinationSummary {
  const latest = context.audits.find((row) => row.action === CUSTOMER_RECORDS_TEAM_STATE_ACTION) || null;
  if (!latest) {
    return {
      mode: "unassigned",
      ownerName: null,
      handoverNote: null,
      updatedAt: null,
      updatedBy: null,
    };
  }

  const metadata = latest.metadata || {};
  const mode = auditText(metadata, "team_mode");
  const ownerName = auditText(metadata, "owner_name");
  const handoverNote = auditText(metadata, "handover_note");
  const updatedBy =
    auditText(metadata, "operator_name") ||
    auditText(metadata, "actor_label") ||
    (typeof metadata.actor === "object" && metadata.actor && "label" in metadata.actor
      ? String((metadata.actor as { label?: string }).label || "")
      : null);

  return {
    mode: mode === "handover" ? "handover" : mode === "assign" ? "assigned" : "unassigned",
    ownerName,
    handoverNote,
    updatedAt: latest.created_at || null,
    updatedBy: updatedBy || null,
  };
}

export function buildCaseFlowSummary(context: Pick<CustomerContext, "audits">): CustomerCaseFlowSummary {
  const latest = context.audits.find((row) => row.action === CUSTOMER_RECORDS_FLOW_STATE_ACTION) || null;
  if (!latest) {
    return {
      status: "idle",
      flowKey: null,
      flowLabel: null,
      currentStepKey: null,
      currentStepLabel: null,
      completedKeys: [],
      completedCount: 0,
      totalSteps: null,
      updatedAt: null,
      updatedBy: null,
    };
  }

  const metadata = latest.metadata || {};
  const flowState = auditText(metadata, "flow_state");
  const completedKeys = Array.isArray(metadata.completed_keys)
    ? metadata.completed_keys.map((value) => String(value)).filter(Boolean)
    : [];
  const updatedBy =
    auditText(metadata, "operator_name") ||
    auditText(metadata, "actor_label") ||
    (typeof metadata.actor === "object" && metadata.actor && "label" in metadata.actor
      ? String((metadata.actor as { label?: string }).label || "")
      : null);

  return {
    status: flowState === "completed" ? "completed" : "active",
    flowKey: auditText(metadata, "flow_key"),
    flowLabel: auditText(metadata, "flow_label"),
    currentStepKey: auditText(metadata, "step_key"),
    currentStepLabel: auditText(metadata, "step_label"),
    completedKeys,
    completedCount: completedKeys.length,
    totalSteps: auditNumber(metadata, "total_steps"),
    updatedAt: latest.created_at || null,
    updatedBy: updatedBy || null,
  };
}

export function deriveCustomerOpsState(
  audits: CustomerOpsAuditLike[],
  callOps: Pick<CustomerCallOpsSummary, "nextCallbackAt" | "planningReason" | "contactabilityStatus">,
): CustomerOpsStateSummary {
  const latestOutcome = [...audits]
    .filter((row) => row.action === CUSTOMER_RECORDS_CASE_OUTCOME_ACTION)
    .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())[0] || null;

  if (latestOutcome) {
    const metadata = latestOutcome.metadata || {};
    const outcome = auditText(metadata, "outcome");
    const reason = auditText(metadata, "reason");
    const resumeAt = auditText(metadata, "resume_at");

    if (outcome === "won") {
      return {
        status: "won",
        label: "Gewonnen",
        detail: reason || "Operativ als gewonnen abgeschlossen.",
        updatedAt: latestOutcome.created_at || null,
        nextResumeAt: null,
        isClosed: true,
      };
    }

    if (outcome === "lost") {
      return {
        status: "lost",
        label: "Verloren",
        detail: reason || "Operativ als verloren abgeschlossen.",
        updatedAt: latestOutcome.created_at || null,
        nextResumeAt: null,
        isClosed: true,
      };
    }

    if (outcome === "callback") {
      return {
        status: "callback",
        label: "Rückruf",
        detail: reason || "Rückruf-Fall aktiv.",
        updatedAt: latestOutcome.created_at || null,
        nextResumeAt: resumeAt,
        isClosed: false,
      };
    }

    if (outcome === "vacation") {
      return {
        status: "vacation",
        label: "Urlaub",
        detail: reason || "Bis nach Urlaub zurückgestellt.",
        updatedAt: latestOutcome.created_at || null,
        nextResumeAt: resumeAt,
        isClosed: false,
      };
    }

    if (outcome === "do_not_contact") {
      return {
        status: "do_not_contact",
        label: "Kontaktstopp",
        detail: reason || "Kein weiterer Kontakt gewünscht.",
        updatedAt: latestOutcome.created_at || null,
        nextResumeAt: null,
        isClosed: true,
      };
    }
  }

  if (callOps.contactabilityStatus === "blocked") {
    return {
      status: "do_not_contact",
      label: "Kontaktstopp",
      detail: "Kontakt aktuell blockiert.",
      updatedAt: null,
      nextResumeAt: null,
      isClosed: true,
    };
  }

  if (callOps.nextCallbackAt) {
    return {
      status: "callback",
      label: "Rückruf",
      detail: callOps.planningReason || "Rückruf geplant.",
      updatedAt: null,
      nextResumeAt: callOps.nextCallbackAt,
      isClosed: false,
    };
  }

  return {
    status: "active",
    label: "Aktiv",
    detail: "Kein Abschluss- oder Kontaktstoppstatus gesetzt.",
    updatedAt: null,
    nextResumeAt: null,
    isClosed: false,
  };
}

function buildOpsStateSummary(
  context: Pick<CustomerContext, "audits">,
  callOps: Pick<CustomerCallOpsSummary, "nextCallbackAt" | "planningReason" | "contactabilityStatus">,
): CustomerOpsStateSummary {
  return deriveCustomerOpsState(context.audits, callOps);
}

function createOrderDiagnostic(
  master: MasterCustomerRow,
  request: MasterRequestRow | null,
  directOrders: MasterOrderRow[],
  emailOrders: OrdersByEmailRow[],
  crmSalesRows: CrmSalesRow[],
  mergedOrders: MasterOrderRow[],
): CustomerOrderDiagnostic {
  const details = [
    `request_id: ${master.request_id}`,
    `customer_id: ${master.id}`,
    `master_orders per request/customer: ${directOrders.length}`,
    `v_orders_by_email per bekannte E-Mail: ${emailOrders.length}`,
    `crm_sales per request/E-Mail: ${crmSalesRows.length}`,
  ];

  if (mergedOrders.length) {
    return {
      status: "linked",
      summary: `Bestellung sichtbar (${
        mergedOrders[0]?.source === "orders_by_email"
          ? "per E-Mail-Fallback"
          : mergedOrders[0]?.source === "crm_sales"
            ? "über CRM-Sales"
            : "direkt verknüpft"
      })`,
      details,
    };
  }

  const quoteState = request?.status ? `Request-Status: ${request.status}` : "Request-Status unbekannt";
  return {
    status: "unlinked",
    summary: "Kein Shopify-Auftrag in den aktuell angebundenen Orderquellen gefunden",
    details: [...details, quoteState, "Wenn heute gekauft wurde, fehlt wahrscheinlich noch Sync oder Referenzierung."],
  };
}

function mapCommunicationFeed(context: CustomerContext): CustomerCommunicationEntry[] {
  const entries: CustomerCommunicationEntry[] = [];

  for (const row of context.quoteEmails) {
    entries.push({
      id: `quote-email-${row.id}`,
      source: "quote_email_log",
      title: row.subject || "Angebots-E-Mail",
      preview: trimNullable(row.recipient_email) || null,
      body: trimNullable(row.recipient_name)
        ? `Empfänger: ${trimNullable(row.recipient_name)} <${trimNullable(row.recipient_email) || ""}>`
        : trimNullable(row.recipient_email)
          ? `Empfänger: ${trimNullable(row.recipient_email)}`
          : null,
      status: trimNullable(row.status),
      occurredAt: row.sent_at || row.created_at || null,
      href: trimNullable(row.card_url) || context.request?.trello_card_url || null,
      direction: "outbound",
      messageId: null,
      conversationId: null,
      classification: null,
    });
  }

  for (const row of context.communications) {
    entries.push({
      id: `master-communication-${row.id}`,
      source: "master_communications",
      title: trimNullable(row.subject) || trimNullable(row.type) || "Kommunikation",
      preview: trimNullable(row.content)?.slice(0, 180) || null,
      body: trimNullable(row.content),
      status: trimNullable(row.status),
      occurredAt: row.created_at || null,
      href: null,
      direction: trimNullable(row.direction),
      messageId: null,
      conversationId: null,
      classification: null,
    });
  }

  for (const row of context.followups) {
    entries.push({
      id: `followup-${row.id}`,
      source: "followup_queue",
      title: `Follow-up ${row.followup_number || ""} ${row.status === "sent" ? "gesendet" : row.status === "pending" ? "geplant" : "Status"}`.trim(),
      preview: trimNullable(row.email_subject) || trimNullable(row.customer_email) || null,
      body: trimNullable(row.email_subject)
        ? `Betreff: ${trimNullable(row.email_subject)}`
        : trimNullable(row.customer_email)
          ? `Empfänger: ${trimNullable(row.customer_email)}`
          : null,
      status: trimNullable(row.status),
      occurredAt: row.sent_at || row.scheduled_for || null,
      href: null,
      direction: "outbound",
      messageId: null,
      conversationId: null,
      classification: null,
    });
  }

  for (const row of context.documents) {
    entries.push({
      id: `document-${row.id}`,
      source: "document_journey",
      title: trimNullable(row.document_name) || "Dokumentenprozess",
      preview: trimNullable(row.customer_email) || trimNullable(row.current_status) || null,
      body: trimNullable(row.customer_email)
        ? `Dokument für ${trimNullable(row.customer_email)}`
        : trimNullable(row.current_status),
      status: trimNullable(row.current_status),
      occurredAt: row.completed_at || row.first_viewed_at || row.sent_at || row.updated_at || null,
      href: trimNullable(row.pandadoc_link),
      direction: "outbound",
      messageId: null,
      conversationId: null,
      classification: trimNullable(row.reply_classification),
    });
  }

  for (const row of context.inboundEmails) {
    entries.push({
      id: `inbound-email-${row.id}`,
      source: "workflow_audit_log",
      title: trimNullable(row.subject) || "Eingehende Kundenmail",
      preview: trimNullable(row.body_preview) || trimNullable(row.from_email) || null,
      body: trimNullable(row.body_preview) || trimNullable(row.from_email) || null,
      status: trimNullable(row.category),
      occurredAt: row.created_at || null,
      href: null,
      direction: "inbound",
      messageId: null,
      conversationId: null,
      classification: trimNullable(row.category),
    });
  }

  for (const row of context.audits) {
    const entry = mapCommunicationAuditEntry(row);
    if (entry) entries.push(entry);
  }

  return entries
    .sort((left, right) => {
      const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
      const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;
      return rightTime - leftTime;
    })
    .slice(0, 10);
}

function mapTimeline(context: CustomerContext): CustomerTimelineEntry[] {
  const entries: CustomerTimelineEntry[] = [];

  if (context.quote?.sent_at) {
    entries.push({
      id: `quote-sent-${context.quote.id}`,
      source: "master_quotes",
      title: "Angebot versendet",
      description: context.quote.edit_link ? "Interner PandaDoc-Entwurf zum aktuellen Angebot verfügbar." : "Angebot wurde versendet.",
      status: trimNullable(context.quote.pandadoc_status),
      occurredAt: context.quote.sent_at,
      href: trimNullable(context.quote.edit_link) || trimNullable(context.quote.share_link),
      direction: "outbound",
      valueLabel: numericValue(context.quote.total_value) !== null ? `${numericValue(context.quote.total_value)} ${trimNullable(context.quote.currency) || "EUR"}` : null,
      body: null,
    });
  }
  if (context.quote?.viewed_at) {
    entries.push({
      id: `quote-viewed-${context.quote.id}`,
      source: "master_quotes",
      title: "Angebot angesehen",
      description: "Der Kunde hat das aktuelle Angebot geöffnet.",
      status: trimNullable(context.quote.pandadoc_status),
      occurredAt: context.quote.viewed_at,
      href: trimNullable(context.quote.edit_link) || trimNullable(context.quote.share_link),
      direction: "system",
      valueLabel: null,
      body: null,
    });
  }
  if (context.quote?.signed_at) {
    entries.push({
      id: `quote-signed-${context.quote.id}`,
      source: "master_quotes",
      title: "Angebot signiert",
      description: "Das aktuelle Dokument wurde erfolgreich abgeschlossen.",
      status: trimNullable(context.quote.pandadoc_status),
      occurredAt: context.quote.signed_at,
      href: trimNullable(context.quote.edit_link) || trimNullable(context.quote.share_link),
      direction: "system",
      valueLabel: numericValue(context.quote.total_value) !== null ? `${numericValue(context.quote.total_value)} ${trimNullable(context.quote.currency) || "EUR"}` : null,
      body: null,
    });
  }
  if (context.quote?.whatsapp_sent) {
    entries.push({
      id: `quote-whatsapp-${context.quote.id}`,
      source: "master_quotes",
      title: "WhatsApp gesendet",
      description: "Zum aktuellen Angebot wurde zusätzlich eine WhatsApp versendet.",
      status: null,
      occurredAt: context.quote.whatsapp_sent,
      href: trimNullable(context.quote.edit_link) || trimNullable(context.quote.share_link),
      direction: "outbound",
      valueLabel: null,
      body: null,
    });
  }

  for (const row of context.quoteEmails) {
    entries.push({
      id: `quote-email-${row.id}`,
      source: "quote_email_log",
      title: row.subject || "Angebots-E-Mail versendet",
      description: trimNullable(row.recipient_email) ? `Empfänger: ${trimNullable(row.recipient_email)}` : null,
      status: trimNullable(row.status),
      occurredAt: row.sent_at || row.created_at || null,
      href: trimNullable(row.card_url) || context.request?.trello_card_url || null,
      direction: "outbound",
      valueLabel: null,
      body: trimNullable(row.recipient_name)
        ? `Empfänger: ${trimNullable(row.recipient_name)} <${trimNullable(row.recipient_email) || ""}>`
        : trimNullable(row.recipient_email),
    });
  }

  for (const row of context.communications) {
    entries.push({
      id: `master-communication-${row.id}`,
      source: "master_communications",
      title: trimNullable(row.subject) || trimNullable(row.type) || "Kommunikation",
      description: trimNullable(row.content)?.slice(0, 180) || null,
      status: trimNullable(row.status),
      occurredAt: row.created_at || null,
      href: null,
      direction: trimNullable(row.direction) === "inbound" ? "inbound" : trimNullable(row.direction) === "outbound" ? "outbound" : "internal",
      valueLabel: null,
      body: trimNullable(row.content),
    });
  }

  for (const row of context.followups) {
    const baseLabel = row.followup_number ? `Follow-up ${row.followup_number}` : trimNullable(row.followup_type) || "Follow-up";
    if (row.sent_at) {
      entries.push({
        id: `followup-sent-${row.id}`,
        source: "followup_queue",
        title: `${baseLabel} gesendet`,
        description: trimNullable(row.email_subject) || trimNullable(row.customer_email) || null,
        status: trimNullable(row.status),
        occurredAt: row.sent_at,
        href: null,
        direction: "outbound",
        valueLabel: null,
        body: trimNullable(row.email_subject)
          ? `Betreff: ${trimNullable(row.email_subject)}`
          : trimNullable(row.customer_email)
            ? `Empfänger: ${trimNullable(row.customer_email)}`
            : null,
      });
    } else if (row.scheduled_for) {
      entries.push({
        id: `followup-scheduled-${row.id}`,
        source: "followup_queue",
        title: `${baseLabel} geplant`,
        description: trimNullable(row.email_subject) || trimNullable(row.customer_email) || null,
        status: trimNullable(row.status),
        occurredAt: row.scheduled_for,
        href: null,
        direction: "system",
        valueLabel: null,
        body: null,
      });
    }
    if (row.reply_detected_at) {
      entries.push({
        id: `followup-reply-${row.id}`,
        source: "followup_queue",
        title: `${baseLabel} beantwortet`,
        description: trimNullable(row.reply_subject) || "Es wurde eine Antwort auf den Follow-up erkannt.",
        status: "reply_detected",
        occurredAt: row.reply_detected_at,
        href: null,
        direction: "inbound",
        valueLabel: null,
        body: trimNullable(row.reply_subject) || null,
      });
    }
  }

  for (const row of context.documents) {
    const docTitle = trimNullable(row.document_name) || "Dokument";
    if (row.sent_at) {
      entries.push({
        id: `document-sent-${row.id}`,
        source: "document_journey",
        title: `${docTitle} versendet`,
        description: trimNullable(row.customer_email) || null,
        status: trimNullable(row.current_status),
        occurredAt: row.sent_at,
        href: trimNullable(row.pandadoc_link),
        direction: "outbound",
        valueLabel: numericValue(row.total_value) !== null ? `${numericValue(row.total_value)} EUR` : null,
        body: trimNullable(row.customer_email) || null,
      });
    }
    if (row.first_viewed_at) {
      entries.push({
        id: `document-viewed-${row.id}`,
        source: "document_journey",
        title: `${docTitle} angesehen`,
        description: "Der Kunde hat das Dokument geöffnet.",
        status: trimNullable(row.current_status),
        occurredAt: row.first_viewed_at,
        href: trimNullable(row.pandadoc_link),
        direction: "system",
        valueLabel: null,
        body: null,
      });
    }
    if (row.reminder_1_sent) {
      entries.push({
        id: `document-reminder1-${row.id}`,
        source: "document_journey",
        title: `${docTitle} Reminder 1 gesendet`,
        description: null,
        status: trimNullable(row.current_status),
        occurredAt: row.reminder_1_sent,
        href: trimNullable(row.pandadoc_link),
        direction: "outbound",
        valueLabel: null,
        body: null,
      });
    }
    if (row.reminder_2_sent) {
      entries.push({
        id: `document-reminder2-${row.id}`,
        source: "document_journey",
        title: `${docTitle} Reminder 2 gesendet`,
        description: null,
        status: trimNullable(row.current_status),
        occurredAt: row.reminder_2_sent,
        href: trimNullable(row.pandadoc_link),
        direction: "outbound",
        valueLabel: null,
        body: null,
      });
    }
    if (row.reminder_3_sent) {
      entries.push({
        id: `document-reminder3-${row.id}`,
        source: "document_journey",
        title: `${docTitle} Reminder 3 gesendet`,
        description: null,
        status: trimNullable(row.current_status),
        occurredAt: row.reminder_3_sent,
        href: trimNullable(row.pandadoc_link),
        direction: "outbound",
        valueLabel: null,
        body: null,
      });
    }
    if (row.reply_detected_at) {
      entries.push({
        id: `document-reply-${row.id}`,
        source: "document_journey",
        title: `${docTitle} beantwortet`,
        description: trimNullable(row.reply_classification) || "Es wurde eine Antwort im Dokumentenprozess erkannt.",
        status: "reply_detected",
        occurredAt: row.reply_detected_at,
        href: trimNullable(row.pandadoc_link),
        direction: "inbound",
        valueLabel: null,
        body: trimNullable(row.reply_classification) || null,
      });
    }
    if (row.completed_at) {
      entries.push({
        id: `document-completed-${row.id}`,
        source: "document_journey",
        title: `${docTitle} abgeschlossen`,
        description: "Der Dokumentenprozess wurde erfolgreich abgeschlossen.",
        status: trimNullable(row.current_status),
        occurredAt: row.completed_at,
        href: trimNullable(row.pandadoc_link),
        direction: "system",
        valueLabel: numericValue(row.total_value) !== null ? `${numericValue(row.total_value)} EUR` : null,
        body: null,
      });
    }
  }

  for (const row of context.inboundEmails) {
    entries.push({
      id: `email-agent-${row.id}`,
      source: "email_agent_log",
      title: trimNullable(row.subject) || "Eingehende Kunden-E-Mail",
      description: trimNullable(row.body_preview) || trimNullable(row.from_email) || null,
      status: trimNullable(row.category),
      occurredAt: row.created_at || null,
      href: null,
      direction: "inbound",
      valueLabel: row.draft_created ? "Draft erstellt" : null,
      body: trimNullable(row.body_preview) || trimNullable(row.from_email) || null,
    });
  }

  for (const row of context.orderHistory) {
    entries.push({
      id: `order-created-${row.id}`,
      source: "master_orders",
      title: `Bestellung ${trimNullable(row.shopify_order_number) || ""} angelegt`.trim(),
      description: trimNullable(row.status) || "Bestellhistorie",
      status: trimNullable(row.fulfillment_status) || trimNullable(row.status),
      occurredAt: row.created_at || null,
      href: null,
      direction: "system",
      valueLabel: numericValue(row.order_value) !== null ? `${numericValue(row.order_value)} ${trimNullable(row.currency) || "EUR"}` : null,
      body: null,
    });
    if (row.shipped_at) {
      entries.push({
        id: `order-shipped-${row.id}`,
        source: "master_orders",
        title: `Bestellung ${trimNullable(row.shopify_order_number) || ""} versendet`.trim(),
        description: trimNullable(row.carrier) || trimNullable(row.tracking_number) || null,
        status: trimNullable(row.fulfillment_status) || trimNullable(row.status),
        occurredAt: row.shipped_at,
        href: null,
        direction: "system",
        valueLabel: null,
        body: null,
      });
    }
    if (row.delivered_at) {
      entries.push({
        id: `order-delivered-${row.id}`,
        source: "master_orders",
        title: `Bestellung ${trimNullable(row.shopify_order_number) || ""} zugestellt`.trim(),
        description: trimNullable(row.carrier) || null,
        status: trimNullable(row.fulfillment_status) || trimNullable(row.status),
        occurredAt: row.delivered_at,
        href: null,
        direction: "system",
        valueLabel: null,
        body: null,
      });
    }
  }

  for (const row of context.audits.filter((entry) => entry.action === CUSTOMER_RECORDS_NOTE_ACTION)) {
    const metadata = row.metadata || {};
    entries.push({
      id: `audit-note-${row.id}`,
      source: "workflow_audit_log",
      title: "Interne Notiz",
      description: typeof metadata.note_text === "string" ? metadata.note_text : null,
      status: null,
      occurredAt: row.created_at || null,
      href: null,
      direction: "internal",
      valueLabel: typeof metadata.actor_label === "string" ? metadata.actor_label : null,
      body: typeof metadata.note_text === "string" ? metadata.note_text : null,
    });
  }

  for (const row of context.audits.filter(
    (entry) =>
      entry.action === CUSTOMER_RECORDS_ROLLBACK_ACTION ||
      entry.action === CUSTOMER_RECORDS_FOLLOWUP_PAUSE_ACTION ||
      entry.action === CUSTOMER_RECORDS_FOLLOWUP_RESCHEDULE_ACTION ||
      entry.action === CUSTOMER_RECORDS_CONTACT_BLOCK_ACTION ||
      entry.action === CUSTOMER_RECORDS_TRELLO_FIELDS_ACTION ||
      entry.action === CUSTOMER_RECORDS_TRELLO_CARD_ACTION ||
      entry.action === CUSTOMER_RECORDS_CALL_LOG_ACTION ||
      entry.action === CUSTOMER_RECORDS_CALLBACK_SCHEDULED_ACTION ||
      entry.action === CUSTOMER_RECORDS_WORKBOARD_HANDLED_ACTION ||
      entry.action === CUSTOMER_RECORDS_WORKBOARD_SNOOZED_ACTION ||
      entry.action === CUSTOMER_RECORDS_CASE_OUTCOME_ACTION ||
      entry.action === CUSTOMER_RECORDS_TEAM_STATE_ACTION ||
      entry.action === CUSTOMER_RECORDS_FLOW_STATE_ACTION ||
      entry.action === CUSTOMER_RECORDS_DOWNSTREAM_SYNC_REPAIR_ACTION ||
      entry.action === CUSTOMER_RECORDS_SALES_RECOVERY_ACTION ||
      entry.action === CUSTOMER_RECORDS_SPECIAL_CASE_ACTION ||
      entry.action === CUSTOMER_RECORDS_SPECIAL_CASE_RESOLVED_ACTION ||
      entry.action === CUSTOMER_RECORDS_SEGMENT_OVERRIDE_ACTION,
  )) {
    const metadata = row.metadata || {};
    entries.push({
      id: `audit-action-${row.id}`,
      source: "workflow_audit_log",
      title:
        entryTitleFromAuditAction(row.action) ||
        (typeof metadata.summary === "string" ? metadata.summary : "Interner Vorgang"),
      description:
        row.action === CUSTOMER_RECORDS_CALL_LOG_ACTION
          ? summarizeCallAudit(metadata)
          : typeof metadata.reason === "string"
            ? metadata.reason
            : typeof metadata.summary === "string"
              ? metadata.summary
              : null,
      status: trimNullable(row.status),
      occurredAt: row.created_at || null,
      href: null,
      direction: "internal",
      valueLabel:
        typeof metadata.actor_label === "string"
          ? metadata.actor_label
          : typeof metadata.affected_followups === "number"
            ? `${metadata.affected_followups} Follow-ups`
            : null,
      body:
        row.action === CUSTOMER_RECORDS_CALL_LOG_ACTION
          ? summarizeCallAudit(metadata)
          : typeof metadata.reason === "string"
            ? metadata.reason
            : typeof metadata.summary === "string"
              ? metadata.summary
              : null,
    });
  }

  for (const row of context.audits) {
    const entry = mapCommunicationAuditTimelineEntry(row);
    if (entry) entries.push(entry);
  }

  return entries
    .sort((left, right) => {
      const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : 0;
      const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : 0;
      return rightTime - leftTime;
    })
    .slice(0, 24);
}

function entryTitleFromAuditAction(action: string | null | undefined) {
  switch (action) {
    case CUSTOMER_RECORDS_ROLLBACK_ACTION:
      return "Änderung zurückgerollt";
    case CUSTOMER_RECORDS_FOLLOWUP_PAUSE_ACTION:
      return "Offene Follow-ups pausiert";
    case CUSTOMER_RECORDS_FOLLOWUP_RESCHEDULE_ACTION:
      return "Follow-ups verschoben";
    case CUSTOMER_RECORDS_CONTACT_BLOCK_ACTION:
      return "Kontaktstopp gesetzt";
    case CUSTOMER_RECORDS_TRELLO_FIELDS_ACTION:
      return "Trello-Felder aktualisiert";
    case CUSTOMER_RECORDS_TRELLO_CARD_ACTION:
      return "Trello-Karte aktualisiert";
    case CUSTOMER_RECORDS_CALL_LOG_ACTION:
      return "Anruf protokolliert";
    case CUSTOMER_RECORDS_CALLBACK_SCHEDULED_ACTION:
      return "Rückruf terminiert";
    case CUSTOMER_RECORDS_WORKBOARD_HANDLED_ACTION:
      return "Workboard-Fall erledigt";
    case CUSTOMER_RECORDS_WORKBOARD_SNOOZED_ACTION:
      return "Workboard-Fall zurückgestellt";
    case CUSTOMER_RECORDS_CASE_OUTCOME_ACTION:
      return "Fallausgang gesetzt";
    case CUSTOMER_RECORDS_TEAM_STATE_ACTION:
      return "Team-Status aktualisiert";
    case CUSTOMER_RECORDS_FLOW_STATE_ACTION:
      return "Case Flow aktualisiert";
    case CUSTOMER_RECORDS_DOWNSTREAM_SYNC_REPAIR_ACTION:
      return "Downstream-Sync repariert";
    case CUSTOMER_RECORDS_SALES_RECOVERY_ACTION:
      return "Sales-Recovery gestartet";
    case CUSTOMER_RECORDS_SPECIAL_CASE_ACTION:
      return "Problemfall gemeldet";
    case CUSTOMER_RECORDS_SPECIAL_CASE_RESOLVED_ACTION:
      return "Problemfall erledigt";
    case CUSTOMER_RECORDS_SEGMENT_OVERRIDE_ACTION:
      return "Segment bestätigt";
    default:
      return null;
  }
}

async function fetchDownstreamRows(
  master: MasterCustomerRow,
  options: { includeTrello?: boolean } = {},
) {
  const { includeTrello = true } = options;
  const emails = emailCandidates(master);
  const emailOr = buildOrFilter(emails.map((email) => `recipient_email.eq.${encodeURIComponent(email)}`));
  const inboundEmailOr = buildOrFilter(emails.map((email) => `from_email.eq.${encodeURIComponent(email)}`));
  const ordersByEmailOr = buildOrFilter(emails.map((email) => `email.eq.${encodeURIComponent(email)}`));
  const phone = trimNullable(master.phone);
  const crmSalesOr = buildOrFilter([
    `request_id.eq.${master.request_id}`,
    ...emails.map((email) => `customer_email.eq.${encodeURIComponent(email)}`),
  ]);
  const crmQuotesOr = buildOrFilter([
    `request_id.eq.${master.request_id}`,
    `customer_id.eq.${master.id}`,
    ...emails.map((email) => `contact_email.eq.${encodeURIComponent(email)}`),
    ...(phone ? [`contact_phone.eq.${encodeURIComponent(phone)}`] : []),
  ]);
  const voiceCallsOr = buildOrFilter([
    `request_id.eq.${master.request_id}`,
    ...(phone ? [`caller_phone.eq.${encodeURIComponent(phone)}`] : []),
  ]);
  const relatedCustomersOr = buildOrFilter([
    ...emails.map((email) => `email.eq.${encodeURIComponent(email)}`),
    ...emails.map((email) => `billing_email.eq.${encodeURIComponent(email)}`),
    ...emails.map((email) => `original_email.eq.${encodeURIComponent(email)}`),
    ...emails.map((email) => `cc_emails.cs.{${encodeURIComponent(email)}}`),
    ...(phone ? [`phone.eq.${encodeURIComponent(phone)}`, `original_phone.eq.${encodeURIComponent(phone)}`] : []),
  ]);
  const [requestRows, quoteRows, orderRows, emailOrderRows, crmSalesRows, crmQuotes, callLogs, voiceCalls, followups, plans, documents, communications, quoteEmails, inboundEmails, audits] = await Promise.all([
    supabaseRequest<MasterRequestRow[]>("master_requests", undefined, {
      select: "id,request_id,customer_id,ac_deal_id,ac_deal_stage,trello_card_url,title,description,status,segment,segment_status,segment_confidence,segment_source,segment_classified_at,segment_policy_version,s_kategorie,estimated_value,final_value,created_at,updated_at,size,color,application,delivery_time,customer_type,country,form_id,deal_status,utm_source,utm_medium,utm_campaign,utm_term,utm_content,landing_page_url,referrer",
      request_id: `eq.${master.request_id}`,
      order: "updated_at.desc",
      limit: 1,
    }),
    supabaseRequest<MasterQuoteRow[]>("master_quotes", undefined, {
      select: "id,request_id,pandadoc_status,share_link,edit_link,total_value,currency,sent_at,viewed_at,signed_at,whatsapp_sent,created_at",
      request_id: `eq.${master.request_id}`,
      order: "created_at.desc",
      limit: 1,
    }),
    supabaseRequest<MasterOrderRow[]>("master_orders", undefined, {
      select:
        "id,customer_id,request_id,shopify_order_id,shopify_order_number,status,fulfillment_status,order_value,currency,shipped_at,delivered_at,tracking_number,carrier,created_at,shopify_created_at,shipping_address,billing_address",
      or: buildOrFilter([`customer_id.eq.${master.id}`, `request_id.eq.${master.request_id}`]),
      order: "created_at.desc",
      limit: 5,
    }),
    supabaseRequest<OrdersByEmailRow[]>("v_orders_by_email", undefined, {
      select: "email,order_number,total_price,financial_status,fulfillment_status,tracking_number,carrier,created_at",
      ...(ordersByEmailOr ? { or: ordersByEmailOr } : {}),
      order: "created_at.desc",
      limit: 5,
    }),
    supabaseRequest<CrmSalesRow[]>("crm_sales", undefined, {
      select:
        "id,request_id,shopify_order_id,shopify_order_number,shopify_order_name,status,financial_status,fulfillment_status,customer_name,customer_email,customer_company,customer_phone,tracking_number,tracking_url,tracking_company,total_price,currency,note,tags,delivery_method,delivery_min_days,delivery_max_days,estimated_delivery_date,shopify_created_at,created_at,updated_at,easybill_sync_status,easybill_invoice_number",
      ...(crmSalesOr ? { or: crmSalesOr } : {}),
      order: "created_at.desc",
      limit: 8,
    }),
    supabaseRequest<CrmQuoteRow[]>("crm_quotes", undefined, {
      select:
        "id,customer_id,request_id,quote_number,status,valid_until,notes_internal,notes_customer,sent_at,viewed_at,accepted_at,rejected_at,created_at,updated_at,total_gross,customer_live_total,last_customer_event_type,last_customer_event_at,project_number,contact_email,contact_phone,shopify_sync_status,easybill_sync_status,easybill_invoice_number",
      ...(crmQuotesOr ? { or: crmQuotesOr } : {}),
      order: "created_at.desc",
      limit: 5,
    }),
    supabaseRequest<CallLogRow[]>("call_logs", undefined, {
      select: "id,request_id,called_at,caller,source,outcome,sentiment,summary,next_action_date,confidence,created_at",
      request_id: `eq.${master.request_id}`,
      order: "called_at.desc",
      limit: 8,
    }),
    supabaseRequest<VoiceAgentCallRow[]>("voice_agent_calls", undefined, {
      select:
        "id,request_id,created_at,direction,caller_phone,caller_name,duration_seconds,recording_url,summary,detected_intent,callback_needed,escalated,transfer_summary,company_name,human_transfer_completed",
      ...(voiceCallsOr ? { or: voiceCallsOr } : {}),
      order: "created_at.desc",
      limit: 8,
    }),
    supabaseRequest<FollowupQueueRow[]>("followup_queue", undefined, {
      select:
        "id,request_id,customer_email,customer_name,customer_company,followup_type,followup_number,email_subject,reply_subject,status,scheduled_for,sent_at,reply_detected_at,updated_at,mockup_url,mockup_url_2,mockup_url_3",
      request_id: `eq.${master.request_id}`,
      order: "scheduled_for.asc",
    }),
    supabaseRequest<LeadFollowupPlanRow[]>("lead_followup_plans", undefined, {
      select: "id,request_id,customer_email,contactability_status,call_after,planning_reason",
      request_id: `eq.${master.request_id}`,
      order: "created_at.desc",
    }),
    supabaseRequest<DocumentJourneyRow[]>("document_journey", undefined, {
      select: "id,customer_id,customer_email,current_status,document_name,pandadoc_link,total_value,sent_at,first_viewed_at,completed_at,reminder_1_sent,reminder_2_sent,reminder_3_sent,reply_detected_at,reply_classification,updated_at",
      or: `(customer_id.eq.${master.id},customer_email.eq.${encodeURIComponent(master.email)})`,
      order: "updated_at.desc",
    }),
    supabaseRequest<MasterCommunicationRow[]>("master_communications", undefined, {
      select: "id,type,direction,subject,content,status,created_at",
      or: `(request_id.eq.${master.request_id},customer_id.eq.${master.id})`,
      order: "created_at.desc",
      limit: 6,
    }),
    supabaseRequest<QuoteEmailLogRow[]>("quote_email_log", undefined, {
      select: "id,recipient_email,recipient_name,subject,status,sent_at,created_at,card_url",
      ...(emailOr ? { or: emailOr } : {}),
      order: "created_at.desc",
      limit: 6,
    }),
    supabaseRequest<EmailAgentLogRow[]>("email_agent_log", undefined, {
      select: "id,from_email,from_name,subject,body_preview,category,draft_created,created_at",
      ...(inboundEmailOr ? { or: inboundEmailOr } : {}),
      order: "created_at.desc",
      limit: 8,
    }),
    supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, {
      select: "id,document_id,workflow_name,action,status,error_message,metadata,created_at",
      document_id: `eq.${master.request_id}`,
      order: "created_at.desc",
      limit: 40,
    }),
  ]);

  const request = requestRows[0] || null;
  const relatedCustomers =
    relatedCustomersOr
      ? (
          await selectMasterCustomerRows({
            or: relatedCustomersOr,
            order: "updated_at.desc",
            limit: 12,
          })
        ).filter((row) => row.id !== master.id)
      : [];
  const relatedRequestIds = uniqueValues(relatedCustomers.map((row) => row.request_id).filter(Boolean));
  const [relatedRequestRows, relatedQuoteRows, relatedOrderRows, relatedFollowups, relatedPlans, relatedAudits] = relatedRequestIds.length
    ? await Promise.all([
        supabaseRequest<MasterRequestRow[]>("master_requests", undefined, {
          select:
            "id,request_id,customer_id,ac_deal_id,ac_deal_stage,trello_card_url,title,description,status,segment,segment_status,segment_confidence,segment_source,segment_classified_at,segment_policy_version,s_kategorie,estimated_value,final_value,created_at,updated_at,size,color,application,delivery_time,customer_type,country,form_id,deal_status,utm_source,utm_medium,utm_campaign,utm_term,utm_content,landing_page_url,referrer",
          request_id: `in.(${relatedRequestIds.join(",")})`,
          order: "updated_at.desc",
          limit: relatedRequestIds.length,
        }),
        supabaseRequest<MasterQuoteRow[]>("master_quotes", undefined, {
          select: "id,request_id,pandadoc_status,share_link,edit_link,total_value,currency,sent_at,viewed_at,signed_at,whatsapp_sent,created_at",
          request_id: `in.(${relatedRequestIds.join(",")})`,
          order: "created_at.desc",
          limit: Math.max(relatedRequestIds.length * 2, 10),
        }),
        supabaseRequest<MasterOrderRow[]>("master_orders", undefined, {
          select:
            "id,customer_id,request_id,shopify_order_id,shopify_order_number,status,fulfillment_status,order_value,currency,shipped_at,delivered_at,tracking_number,carrier,created_at,shopify_created_at,shipping_address,billing_address",
          request_id: `in.(${relatedRequestIds.join(",")})`,
          order: "created_at.desc",
          limit: Math.max(relatedRequestIds.length * 2, 10),
        }),
        supabaseRequest<FollowupQueueRow[]>("followup_queue", undefined, {
          select:
            "id,request_id,customer_email,customer_name,customer_company,followup_type,followup_number,email_subject,reply_subject,status,scheduled_for,sent_at,reply_detected_at,updated_at,mockup_url,mockup_url_2,mockup_url_3",
          request_id: `in.(${relatedRequestIds.join(",")})`,
          order: "scheduled_for.asc",
          limit: Math.max(relatedRequestIds.length * 6, 20),
        }),
        supabaseRequest<LeadFollowupPlanRow[]>("lead_followup_plans", undefined, {
          select: "id,request_id,customer_email,contactability_status,call_after,planning_reason",
          request_id: `in.(${relatedRequestIds.join(",")})`,
          order: "call_after.asc",
          limit: Math.max(relatedRequestIds.length * 3, 10),
        }),
        supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, {
          select: "id,document_id,workflow_name,action,status,error_message,metadata,created_at",
          document_id: `in.(${relatedRequestIds.join(",")})`,
          order: "created_at.desc",
          limit: Math.max(relatedRequestIds.length * 12, 40),
        }),
      ])
    : [[], [], [], [], [], []];
  const quoteIds = uniqueValues((crmQuotes || []).map((row) => row.id));
  const crmQuoteVersions = quoteIds.length
    ? await supabaseRequest<CrmQuoteVersionRow[]>("crm_quote_versions", undefined, {
        select: "id,quote_id,version_number,change_type,description,label,is_locked,created_at,totals",
        quote_id: `in.(${quoteIds.join(",")})`,
        order: "created_at.desc",
        limit: 40,
      })
    : [];
  const versionIds = uniqueValues(crmQuoteVersions.map((row) => row.id));
  const crmQuoteVersionImages = versionIds.length
    ? await supabaseRequest<CrmQuoteVersionImageRow[]>("crm_quote_version_images", undefined, {
        select: "id,version_id,item_index,image_index,original_url,copied_url,versioned_url,copy_status,created_at",
        version_id: `in.(${versionIds.join(",")})`,
        order: "created_at.desc",
        limit: 80,
      })
    : [];
  const trelloCardIdHint = parseTrelloCardIdFromNotes(crmQuotes[0]?.notes_internal);
  let trello: CustomerTrelloContext | null = null;
  if (includeTrello) {
    try {
      trello = await fetchTrelloContext(master.request_id, request?.trello_card_url, [
        request?.title,
        master.name,
        [master.first_name, master.last_name].filter(Boolean).join(" "),
      ], trelloCardIdHint);
    } catch (error) {
      console.warn("customer records trello context unavailable", { requestId: master.request_id, error });
    }
  }

  const fallbackEmailOrders = (emailOrderRows || []).map(mapOrdersByEmailRow).filter((row) => {
    const orderNumber = trimNullable(row.shopify_order_number);
    if (!orderNumber) return true;
    return !orderRows.some((existing) => trimNullable(existing.shopify_order_number) === orderNumber);
  });
  const crmFallbackOrders = (crmSalesRows || []).map(mapCrmSalesRow).filter((row) => {
    const orderNumber = trimNullable(row.shopify_order_number);
    if (!orderNumber) return true;
    return ![...orderRows, ...fallbackEmailOrders].some((existing) => trimNullable(existing.shopify_order_number) === orderNumber);
  });
  const mergedOrders = [...orderRows, ...fallbackEmailOrders, ...crmFallbackOrders].sort((left, right) => {
    const leftTime = new Date(left.shopify_created_at || left.created_at || 0).getTime();
    const rightTime = new Date(right.shopify_created_at || right.created_at || 0).getTime();
    return rightTime - leftTime;
  });
  const orderDiagnostic = createOrderDiagnostic(master, request, orderRows, emailOrderRows || [], crmSalesRows || [], mergedOrders);

  return {
    request,
    quote: quoteRows[0] || null,
    order:
      mergedOrders.find((row) => trimNullable(row.request_id) === master.request_id) ||
      mergedOrders[0] ||
      null,
    orderHistory: mergedOrders,
    orderDiagnostic,
    crmSales: crmSalesRows || [],
    crmQuotes: crmQuotes || [],
    crmQuoteVersions,
    crmQuoteVersionImages,
    callLogs: callLogs || [],
    voiceCalls: voiceCalls || [],
    followups,
    plans,
    documents,
    communications,
    quoteEmails,
    inboundEmails,
    audits,
    trello,
    relatedCustomers,
    relatedRequestRows,
    relatedQuoteRows,
    relatedOrderRows,
    relatedFollowups,
    relatedPlans,
    relatedAudits,
  };
}

async function fetchCustomerContextByRequestId(requestId: string): Promise<CustomerContext> {
  const rows = await selectMasterCustomerRows({
    request_id: `eq.${requestId}`,
    order: "updated_at.desc",
    limit: 1,
  });

  const master = rows[0];
  if (!master) {
    throw new QuoteValidationError("Kein Datensatz zu dieser Request-ID gefunden.", [], 404);
  }

  const downstream = await fetchDownstreamRows(master);
  return { master: applyAuditCcEmails(master, downstream.audits), ...downstream };
}

function mapSearchResult(context: CustomerContext): CustomerSearchResult {
  const snapshot = toEditableSnapshot(context.master);
  const pendingFollowups = context.followups.filter((row) => row.status === "pending");
  const latestCrmQuote = context.crmQuotes[0] || null;
  const latestCrmQuoteVersions = latestCrmQuote
    ? context.crmQuoteVersions.filter((row) => trimNullable(row.quote_id) === latestCrmQuote.id)
    : [];
  const latestCrmQuoteVersionIds = new Set(latestCrmQuoteVersions.map((row) => row.id));
  const latestCrmQuoteImages = context.crmQuoteVersionImages.filter((row) =>
    trimNullable(row.version_id) ? latestCrmQuoteVersionIds.has(trimNullable(row.version_id) as string) : false,
  );
  const callOps = buildCallOpsSummary(context);
  const salesRecovery = buildSalesRecoverySummary(context, callOps);
  const specialCase = buildSpecialCaseSummary(context);
  const caseCoordination = buildCaseCoordinationSummary(context);
  const caseFlow = buildCaseFlowSummary(context);

  return {
    masterCustomerId: context.master.id,
    requestId: context.master.request_id,
    email: snapshot.email,
    billingEmail: snapshot.billingEmail,
    ccEmails: snapshot.ccEmails,
    firstName: snapshot.firstName,
    lastName: snapshot.lastName,
    phone: snapshot.phone,
    company: snapshot.company,
    displayName: snapshot.displayName,
    originalEmail: trimNullable(context.master.original_email),
    originalPhone: trimNullable(context.master.original_phone),
    updatedAt: context.master.updated_at || null,
    affectedRows: {
      followupQueue: context.followups.length,
      pendingFollowups: pendingFollowups.length,
      nextPendingFollowupAt: pendingFollowups[0]?.scheduled_for || null,
      leadFollowupPlans: context.plans.length,
      documentJourney: context.documents.length,
    },
    downstreamPreview: {
      followupEmails: uniqueValues(context.followups.map((row) => row.customer_email)),
      followupNames: uniqueValues(context.followups.map((row) => row.customer_name)),
      documentStatuses: uniqueValues(context.documents.map((row) => row.current_status)),
    },
    request: context.request
      ? {
          title: trimNullable(context.request.title),
          description: trimNullable(context.request.description),
          status: trimNullable(context.request.status),
          acDealId: context.request.ac_deal_id ?? null,
          acDealStage: trimNullable(context.request.ac_deal_stage),
          dealStatus: trimNullable(context.request.deal_status),
          segment: trimNullable(context.request.segment),
          segmentLabel: getCustomerSegmentOption(context.request.segment)?.label || null,
          segmentStatus: trimNullable(context.request.segment_status),
          segmentConfidence: numericValue(context.request.segment_confidence),
          segmentSource: trimNullable(context.request.segment_source),
          segmentClassifiedAt: context.request.segment_classified_at || null,
          segmentPolicyVersion: trimNullable(context.request.segment_policy_version),
          sKategorie: trimNullable(context.request.s_kategorie),
          estimatedValue: numericValue(context.request.estimated_value),
          finalValue: numericValue(context.request.final_value),
          size: trimNullable(context.request.size),
          colors: Array.isArray(context.request.color) ? context.request.color.map((value) => String(value).trim()).filter(Boolean) : [],
          application: trimNullable(context.request.application),
          deliveryTime: trimNullable(context.request.delivery_time),
          customerType: trimNullable(context.request.customer_type),
          country: trimNullable(context.request.country),
          formId: trimNullable(context.request.form_id),
          utmSource: trimNullable(context.request.utm_source),
          utmMedium: trimNullable(context.request.utm_medium),
          utmCampaign: trimNullable(context.request.utm_campaign),
          utmTerm: trimNullable(context.request.utm_term),
          utmContent: trimNullable(context.request.utm_content),
          landingPageUrl: trimNullable(context.request.landing_page_url),
          referrer: trimNullable(context.request.referrer),
          trelloCardUrl: trimNullable(context.request.trello_card_url),
          createdAt: context.request.created_at || null,
          updatedAt: context.request.updated_at || null,
        }
      : null,
    quote: context.quote
      ? {
          status: trimNullable(context.quote.pandadoc_status),
          totalValue: numericValue(context.quote.total_value),
          currency: trimNullable(context.quote.currency),
          shareLink: trimNullable(context.quote.share_link),
          editLink: trimNullable(context.quote.edit_link),
          sentAt: context.quote.sent_at || null,
          viewedAt: context.quote.viewed_at || null,
          signedAt: context.quote.signed_at || null,
          whatsappSentAt: context.quote.whatsapp_sent || null,
        }
      : null,
    order: context.order
      ? {
          orderNumber: trimNullable(context.order.shopify_order_number),
          status: trimNullable(context.order.status),
          fulfillmentStatus: trimNullable(context.order.fulfillment_status),
          orderValue: numericValue(context.order.order_value),
          currency: trimNullable(context.order.currency),
          shippedAt: context.order.shipped_at || null,
          deliveredAt: context.order.delivered_at || null,
          trackingNumber: trimNullable(context.order.tracking_number),
          carrier: trimNullable(context.order.carrier),
          source: context.order.source || "master_orders",
        }
      : null,
    orderHistory: context.orderHistory.map(mapOrderHistoryEntry),
    orderDiagnostic: context.orderDiagnostic,
    crmSales: context.crmSales.map(mapCrmSalesEntry),
    crmQuote: latestCrmQuote ? mapCrmQuoteSummary(latestCrmQuote, latestCrmQuoteVersions, latestCrmQuoteImages) : null,
    followupMockups: mapFollowupMockups(context.followups),
    callOps,
    salesRecovery,
    specialCase,
    caseCoordination,
    caseFlow,
    opsState: buildOpsStateSummary(context, callOps),
    relatedRequests: context.relatedCustomers.map((row) => {
      const relatedRequest = context.relatedRequestRows.find((entry) => entry.request_id === row.request_id) || null;
      const relatedQuote = context.relatedQuoteRows.find((entry) => entry.request_id === row.request_id) || null;
      const relatedOrder = context.relatedOrderRows.find((entry) => trimNullable(entry.request_id) === row.request_id) || null;
      const relatedFollowups = context.relatedFollowups.filter((entry) => trimNullable((entry as { request_id?: string | null }).request_id) === row.request_id);
      const relatedPlans = context.relatedPlans.filter((entry) => trimNullable(entry.request_id) === row.request_id);
      const relatedAudits = context.relatedAudits.filter((entry) => trimNullable(entry.document_id) === row.request_id);
      const relatedCallOps = buildCallOpsSummary({
        plans: relatedPlans,
        audits: relatedAudits,
        callLogs: [],
        voiceCalls: [],
      });
      const relatedOpsState = buildOpsStateSummary(
        {
          audits: relatedAudits,
        } as Pick<CustomerContext, "audits">,
        relatedCallOps,
      );
      const latestCommunicationAudit = relatedAudits
        .filter((entry) => Boolean(entry.action) && COMMUNICATION_AUDIT_ACTIONS.has(String(entry.action)))
        .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())[0] || null;
      const latestCallAudit = relatedAudits
        .filter((entry) => entry.action === CUSTOMER_RECORDS_CALL_LOG_ACTION)
        .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())[0] || null;
      const latestOutcomeAudit = relatedAudits
        .filter((entry) => entry.action === CUSTOMER_RECORDS_CASE_OUTCOME_ACTION)
        .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())[0] || null;
      const lastTouchCandidates = [
        latestCommunicationAudit
          ? {
              at: latestCommunicationAudit.created_at || null,
              label: communicationAuditTitle(latestCommunicationAudit, latestCommunicationAudit.metadata || {}),
            }
          : null,
        latestCallAudit
          ? {
              at: latestCallAudit.created_at || null,
              label: "Call protokolliert",
            }
          : null,
        latestOutcomeAudit
          ? {
              at: latestOutcomeAudit.created_at || null,
              label: "Fallstatus gesetzt",
            }
          : null,
        relatedQuote?.viewed_at
          ? {
              at: relatedQuote.viewed_at,
              label: "Angebot angesehen",
            }
          : null,
      ]
        .filter(Boolean)
        .sort((left, right) => new Date((right as { at: string | null }).at || 0).getTime() - new Date((left as { at: string | null }).at || 0).getTime()) as Array<{
        at: string | null;
        label: string | null;
      }>;

      return mapRelatedRequest(
        row,
        relatedRequest,
        relatedQuote,
        relatedOrder,
        relatedOpsState,
        relatedFollowups,
        relatedPlans,
        lastTouchCandidates[0]?.at || null,
        lastTouchCandidates[0]?.label || null,
      );
    }),
    trello: context.trello,
    communications: mapCommunicationFeed(context),
    timeline: mapTimeline(context),
    notes: context.audits.filter((row) => row.action === CUSTOMER_RECORDS_NOTE_ACTION).map(mapNoteEntry),
    internalTasks: buildCustomerInternalTaskBoardFromAudits(context.audits, {
      requestId: context.master.request_id,
      includeDone: true,
    }).tasks,
    auditTrail: context.audits.filter((row) => row.action === CUSTOMER_RECORDS_UPDATE_ACTION).map(mapAuditEntry),
  };
}

export function buildCustomerUpdatePlan(current: EditableSnapshot, updates: CustomerUpdateFields): CustomerUpdatePlan {
  const next = {
    email:
      updates.email === undefined
        ? current.email
        : normalizeOptionalEmail(updates.email) || current.email,
    billingEmail:
      updates.billingEmail === undefined ? current.billingEmail : normalizeOptionalEmail(updates.billingEmail),
    ccEmails: updates.ccEmails === undefined ? current.ccEmails : normalizeCcEmails(updates.ccEmails),
    firstName: updates.firstName === undefined ? current.firstName : trimNullable(updates.firstName),
    lastName: updates.lastName === undefined ? current.lastName : trimNullable(updates.lastName),
    phone: updates.phone === undefined ? current.phone : trimNullable(updates.phone),
    company: updates.company === undefined ? current.company : trimNullable(updates.company),
    displayName: current.displayName,
  };

  if (
    updates.email !== undefined &&
    updates.billingEmail === undefined &&
    current.billingEmail &&
    normalizeEmail(current.billingEmail) === normalizeEmail(current.email)
  ) {
    next.billingEmail = next.email;
  }

  next.displayName = buildCustomerName(next.firstName, next.lastName) || null;

  const masterPatch: Record<string, string | string[] | null> = {};
  if (next.email !== current.email) masterPatch.email = next.email;
  if (next.billingEmail !== current.billingEmail) masterPatch.billing_email = next.billingEmail;
  if (!emailListEqual(next.ccEmails, current.ccEmails)) masterPatch.cc_emails = next.ccEmails;
  if (next.firstName !== current.firstName) masterPatch.first_name = next.firstName;
  if (next.lastName !== current.lastName) masterPatch.last_name = next.lastName;
  if (next.phone !== current.phone) masterPatch.phone = next.phone;
  if (next.company !== current.company) {
    masterPatch.company = next.company;
    masterPatch.company_name = next.company;
  }
  if (next.displayName !== current.displayName) masterPatch.name = next.displayName;

  if (!Object.keys(masterPatch).length) {
    throw new QuoteValidationError("Keine Aenderung erkannt.");
  }

  const followupPatch =
    next.email !== current.email ||
    next.displayName !== current.displayName ||
    next.company !== current.company
      ? {
          ...(next.email !== current.email ? { customer_email: next.email } : {}),
          ...(next.displayName !== current.displayName ? { customer_name: next.displayName } : {}),
          ...(next.company !== current.company ? { customer_company: next.company } : {}),
        }
      : null;

  return {
    next,
    masterPatch,
    followupPatch: followupPatch && Object.keys(followupPatch).length ? followupPatch : null,
    leadFollowupPatch: next.email !== current.email ? { customer_email: next.email } : null,
    documentJourneyPatch: next.email !== current.email ? { customer_email: next.email } : null,
  };
}

export function buildCustomerDownstreamRepairPlan(
  context: CustomerDownstreamRepairContext,
): CustomerUpdatePlan {
  const current = toEditableSnapshot(context.master);
  const expectedEmail = current.email;
  const expectedName = current.displayName;
  const expectedCompany = current.company;

  const followupPatch =
    context.followups.some((row) => normalizeStoredEmail(row.customer_email) !== expectedEmail) ||
    context.followups.some((row) => trimNullable(row.customer_name) !== expectedName) ||
    context.followups.some((row) => trimNullable(row.customer_company) !== expectedCompany)
      ? {
          customer_email: expectedEmail,
          customer_name: expectedName,
          customer_company: expectedCompany,
        }
      : null;

  const leadFollowupPatch = context.plans.some((row) => normalizeStoredEmail(row.customer_email) !== expectedEmail)
    ? { customer_email: expectedEmail }
    : null;

  const documentJourneyPatch = context.documents.some(
    (row) => normalizeStoredEmail(row.customer_email) !== expectedEmail,
  )
    ? { customer_email: expectedEmail }
    : null;

  if (!followupPatch && !leadFollowupPatch && !documentJourneyPatch) {
    throw new QuoteValidationError("Keine Downstream-Abweichung erkannt.");
  }

  return {
    next: current,
    masterPatch: {},
    followupPatch,
    leadFollowupPatch,
    documentJourneyPatch,
  };
}

export function buildCustomerUpdatePreview(
  context: Pick<CustomerContext, "master" | "followups" | "plans" | "documents">,
  updates: CustomerUpdateFields,
): CustomerUpdatePreview {
  const current = toEditableSnapshot(context.master);
  const plan = buildCustomerUpdatePlan(current, updates);
  const changes = createPreviewChanges(current, plan.next);
  const impactedTables = createImpactedTables(context, plan);
  const warnings = createPreviewWarnings(context, plan);

  return {
    requestId: context.master.request_id,
    displayName: plan.next.displayName,
    changes,
    impactedTables,
    warnings,
  };
}

async function patchById<T extends Record<string, unknown>>(
  table: string,
  id: string,
  patch: Record<string, string | string[] | number | boolean | null>,
) {
  if (!Object.keys(patch).length) return null;
  const rows = await supabaseRequest<T[]>(
    table,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
      headers: { Prefer: "return=representation" },
    },
    {
      id: `eq.${id}`,
    },
  );
  return rows[0] || null;
}

async function deleteById(table: string, id: string) {
  await supabaseRequest(
    table,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    },
    {
      id: `eq.${id}`,
    },
  );
}

async function insertWorkflowAuditLog(input: {
  requestId: string;
  action?: string;
  status?: string;
  summary?: string;
  changedFields?: string[];
  actor?: UpdateActor;
  before?: EditableSnapshot;
  after?: EditableSnapshot;
  affectedRows?: {
    masterCustomers: number;
    followupQueue: number;
    leadFollowupPlans: number;
    documentJourney: number;
  };
  extraMetadata?: Record<string, unknown>;
}) {
  await supabaseRequest("workflow_audit_log", {
    method: "POST",
    body: JSON.stringify({
      document_id: input.requestId,
      workflow_name: CUSTOMER_RECORDS_WORKFLOW_NAME,
      action: input.action || CUSTOMER_RECORDS_UPDATE_ACTION,
      status: input.status || "success",
      metadata: {
        request_id: input.requestId,
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.changedFields ? { changed_fields: input.changedFields } : {}),
        actor_label: actorLabel(input.actor),
        actor: input.actor || null,
        ...(input.before ? { before: input.before } : {}),
        ...(input.after ? { after: input.after } : {}),
        ...(input.affectedRows ? { affected_rows: input.affectedRows } : {}),
        ...(input.extraMetadata || {}),
      },
    }),
    headers: { Prefer: "return=minimal" },
  });
}

async function rollbackChanges(steps: Array<() => Promise<unknown>>) {
  const failures: string[] = [];
  for (const step of [...steps].reverse()) {
    try {
      await step();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "rollback_failed");
    }
  }
  return failures;
}

async function applyCustomerMutation(
  context: CustomerContext,
  current: EditableSnapshot,
  plan: CustomerUpdatePlan,
  actor: UpdateActor | undefined,
  audit: {
    action: string;
    summary: string;
    changedFields: string[];
    extraMetadata?: Record<string, unknown>;
  },
) {
  const rollbackSteps: Array<() => Promise<unknown>> = [];

  const changedTables = {
    masterCustomers: Object.keys(plan.masterPatch).length ? 1 : 0,
    followupQueue: plan.followupPatch ? context.followups.length : 0,
    leadFollowupPlans: plan.leadFollowupPatch ? context.plans.length : 0,
    documentJourney: plan.documentJourneyPatch ? context.documents.length : 0,
  };

  try {
    if (Object.keys(plan.masterPatch).length) {
      const previousMaster = {
        email: context.master.email,
        billing_email: context.master.billing_email || null,
        cc_emails: normalizeStoredCcEmails(context.master.cc_emails),
        first_name: context.master.first_name || null,
        last_name: context.master.last_name || null,
        phone: context.master.phone || null,
        company: context.master.company || null,
        company_name: context.master.company_name || null,
        name: context.master.name || null,
      };
      try {
        await patchById("master_customers", context.master.id, plan.masterPatch);
        rollbackSteps.push(() => patchById("master_customers", context.master.id, previousMaster));
      } catch (error) {
        if (!("cc_emails" in plan.masterPatch) || !isMissingCcEmailsColumn(error)) throw error;
        const { cc_emails: _ccEmails, ...legacyMasterPatch } = plan.masterPatch;
        const { cc_emails: _previousCcEmails, ...legacyPreviousMaster } = previousMaster;
        if (Object.keys(legacyMasterPatch).length) {
          await patchById("master_customers", context.master.id, legacyMasterPatch);
          rollbackSteps.push(() => patchById("master_customers", context.master.id, legacyPreviousMaster));
        }
      }
    }

    if (plan.followupPatch) {
      for (const row of context.followups) {
        const previousFollowup = {
          customer_email: row.customer_email || null,
          customer_name: row.customer_name || null,
          customer_company: row.customer_company || null,
        };
        await patchById("followup_queue", row.id, plan.followupPatch);
        rollbackSteps.push(() => patchById("followup_queue", row.id, previousFollowup));
      }
    }

    if (plan.leadFollowupPatch) {
      for (const row of context.plans) {
        const previousPlan = { customer_email: row.customer_email || null };
        await patchById("lead_followup_plans", row.id, plan.leadFollowupPatch);
        rollbackSteps.push(() => patchById("lead_followup_plans", row.id, previousPlan));
      }
    }

    if (plan.documentJourneyPatch) {
      for (const row of context.documents) {
        const previousDocument = { customer_email: row.customer_email || null };
        await patchById("document_journey", row.id, plan.documentJourneyPatch);
        rollbackSteps.push(() => patchById("document_journey", row.id, previousDocument));
      }
    }

    await insertWorkflowAuditLog({
      requestId: context.master.request_id,
      action: audit.action,
      summary: audit.summary,
      changedFields: audit.changedFields,
      actor,
      before: current,
      after: plan.next,
      affectedRows: changedTables,
      extraMetadata: audit.extraMetadata,
    });
  } catch (error) {
    const rollbackFailures = await rollbackChanges(rollbackSteps);
    if (rollbackFailures.length) {
      console.error("customer record rollback failed", { requestId: context.master.request_id, rollbackFailures });
      throw new SupabaseRestError(
        "Kundendaten konnten nicht sauber aktualisiert werden. Rollback teilweise fehlgeschlagen.",
        500,
        rollbackFailures,
      );
    }

    throw error;
  }

  return changedTables;
}

export async function searchCustomerRecords(query: string) {
  const normalized = normalizeRequestSearch(query);
  const searchMode = resolveCustomerSearchMode(normalized);
  const normalizedEmail = normalizeEmail(normalized);
  const fuzzyName = `*${escapeIlikeTerm(normalized)}*`;
  const normalizedPhone = normalizePhoneSearch(normalized);
  const fuzzyPhone = `*${escapeIlikeTerm(normalized)}*`;
  const fuzzyPhoneDigits = `*${normalizedPhone}*`;
  const trimmedDealId = normalized.replace(/^(deal:|ac:)/i, "").trim();
  const trelloIdentifier = parseTrelloCardIdentifier(normalized) || normalized.replace(/^trello:/i, "").trim();

  let rows: MasterCustomerRow[] = [];

  if (searchMode === "deal" || searchMode === "trello") {
    const requestRows = await supabaseRequest<Array<{ request_id: string }>>("master_requests", undefined, {
      select: "request_id",
      ...(searchMode === "deal"
        ? { ac_deal_id: `eq.${trimmedDealId}` }
        : {
            or: `(trello_card_id.eq.${trelloIdentifier},trello_card_url.ilike.*${escapeIlikeTerm(trelloIdentifier)}*)`,
          }),
      order: "updated_at.desc",
      limit: 10,
    });
    const requestIds = uniqueValues(requestRows.map((row) => row.request_id));
    rows = requestIds.length
      ? await selectMasterCustomerRows({
          request_id: `in.(${requestIds.join(",")})`,
          order: "updated_at.desc",
          limit: 10,
        })
      : [];
  } else {
    rows = await selectMasterCustomerRows({
      ...(searchMode === "email"
        ? {
            or: `(email.eq.${normalizedEmail},billing_email.eq.${normalizedEmail},original_email.eq.${normalizedEmail},cc_emails.cs.{${encodeURIComponent(normalizedEmail)}})`,
          }
        : searchMode === "request_id"
          ? { request_id: `eq.${normalized}` }
          : searchMode === "phone"
            ? {
                or: `(phone.ilike.${fuzzyPhone},original_phone.ilike.${fuzzyPhone},phone.ilike.${fuzzyPhoneDigits},original_phone.ilike.${fuzzyPhoneDigits})`,
              }
            : {
                or: `(name.ilike.${fuzzyName},first_name.ilike.${fuzzyName},last_name.ilike.${fuzzyName},company.ilike.${fuzzyName},company_name.ilike.${fuzzyName})`,
              }),
      order: "updated_at.desc",
      limit: 10,
    });
  }

  const contexts = await Promise.all(
    rows.map(async (row) => {
      const downstream = await fetchDownstreamRows(row, { includeTrello: true });
      return { master: applyAuditCcEmails(row, downstream.audits), ...downstream };
    }),
  );

  return contexts.map(mapSearchResult);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index]!, index);
      }
    }),
  );

  return results;
}

export async function listCustomerRecordsByRequestIds(
  requestIds: string[],
  options?: { includeTrello?: boolean },
): Promise<CustomerSearchResult[]> {
  const normalizedRequestIds = uniqueValues(requestIds.map((requestId) => normalizeRequestSearch(requestId)));
  if (!normalizedRequestIds.length) return [];

  const rows = await selectMasterCustomerRows({
    request_id: `in.(${normalizedRequestIds.join(",")})`,
    order: "updated_at.desc",
    limit: Math.max(normalizedRequestIds.length, 1),
  });

  const contexts = await mapWithConcurrency(
    rows,
    4,
    async (row) => {
      const downstream = await fetchDownstreamRows(row, { includeTrello: options?.includeTrello ?? false });
      return { master: applyAuditCcEmails(row, downstream.audits), ...downstream };
    },
  );

  const recordByRequestId = new Map(
    contexts.map((context) => {
      const record = mapSearchResult(context);
      return [record.requestId, record] as const;
    }),
  );

  return normalizedRequestIds
    .map((requestId) => recordByRequestId.get(requestId))
    .filter((record): record is CustomerSearchResult => Boolean(record));
}

export async function getCustomerRecordByRequestId(
  requestId: string,
  options?: { includeTrello?: boolean },
): Promise<CustomerSearchResult> {
  const [record] = await listCustomerRecordsByRequestIds([requestId], options);
  if (!record) {
    throw new QuoteValidationError("Kein Fall für diese Request-ID gefunden.");
  }
  return record;
}

export async function listCustomerRecordsInbox(limit = 6) {
  const [pendingRows, recentRequestRows] = await Promise.all([
    supabaseRequest<InboxFollowupRow[]>("followup_queue", undefined, {
      select: "request_id,scheduled_for",
      status: "eq.pending",
      order: "scheduled_for.asc",
      limit: Math.max(limit * 2, 8),
    }),
    supabaseRequest<InboxRequestRow[]>("master_requests", undefined, {
      select: "request_id,updated_at",
      order: "updated_at.desc",
      limit: Math.max(limit * 2, 8),
    }),
  ]);

  const requestIds = uniqueValues([
    ...pendingRows.map((row) => row.request_id),
    ...recentRequestRows.map((row) => row.request_id),
  ]).slice(0, Math.max(limit * 2, 10));

  if (!requestIds.length) return [];

  const rows = await selectMasterCustomerRows({
    request_id: `in.(${requestIds.join(",")})`,
    order: "updated_at.desc",
    limit: Math.max(limit * 2, 10),
  });

  const contexts = await Promise.all(
    rows.map(async (row) => {
      const downstream = await fetchDownstreamRows(row, { includeTrello: false });
      return { master: applyAuditCcEmails(row, downstream.audits), ...downstream };
    }),
  );

  return contexts
    .map(mapSearchResult)
    .sort((left, right) => {
      const leftPending = left.affectedRows.pendingFollowups > 0 ? 1 : 0;
      const rightPending = right.affectedRows.pendingFollowups > 0 ? 1 : 0;
      if (leftPending !== rightPending) return rightPending - leftPending;
      const leftTime = new Date(left.affectedRows.nextPendingFollowupAt || left.request?.updatedAt || left.updatedAt || 0).getTime();
      const rightTime = new Date(right.affectedRows.nextPendingFollowupAt || right.request?.updatedAt || right.updatedAt || 0).getTime();
      return leftPending ? leftTime - rightTime : rightTime - leftTime;
    })
    .slice(0, limit);
}

export async function listCustomerRecordsWorkboard(limitPerSection = 4): Promise<CustomerWorkboardSection[]> {
  const [pendingRows, callbackRows, replyAuditRows, contactStopRows, salesRecoveryRows, workboardStateRows] = await Promise.all([
    supabaseRequest<InboxFollowupRow[]>("followup_queue", undefined, {
      select: "request_id,scheduled_for",
      status: "eq.pending",
      order: "scheduled_for.asc",
      limit: Math.max(limitPerSection * 3, 8),
    }),
    supabaseRequest<WorkboardCallbackRow[]>("lead_followup_plans", undefined, {
      select: "request_id,call_after,contactability_status",
      call_after: "not.is.null",
      order: "call_after.asc",
      limit: Math.max(limitPerSection * 3, 8),
    }),
    supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, {
      select: "id,document_id,action,status,metadata,created_at",
      action: "eq.customer_reply_detected",
      order: "created_at.desc",
      limit: Math.max(limitPerSection * 3, 8),
    }),
    supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, {
      select: "id,document_id,action,status,metadata,created_at",
      workflow_name: `eq.${CUSTOMER_RECORDS_WORKFLOW_NAME}`,
      action: `eq.${CUSTOMER_RECORDS_CONTACT_BLOCK_ACTION}`,
      order: "created_at.desc",
      limit: Math.max(limitPerSection * 3, 8),
    }),
    supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, {
      select: "id,document_id,action,status,metadata,created_at",
      workflow_name: `eq.${CUSTOMER_RECORDS_WORKFLOW_NAME}`,
      action: `eq.${CUSTOMER_RECORDS_SALES_RECOVERY_ACTION}`,
      order: "created_at.desc",
      limit: Math.max(limitPerSection * 4, 12),
    }),
    supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, {
      select: "id,document_id,action,status,metadata,created_at",
      workflow_name: `eq.${CUSTOMER_RECORDS_WORKFLOW_NAME}`,
      or: `(action.eq.${CUSTOMER_RECORDS_WORKBOARD_HANDLED_ACTION},action.eq.${CUSTOMER_RECORDS_WORKBOARD_SNOOZED_ACTION})`,
      order: "created_at.desc",
      limit: 120,
    }),
  ]);

  const pendingRequestIds = uniqueValues(pendingRows.map((row) => row.request_id));
  const salesRecoveryRequestIds = uniqueValues(
    salesRecoveryRows.map((row) => auditText(row.metadata || {}, "request_id") || row.document_id),
  );
  const callbackRequestIds = uniqueValues(
    callbackRows
      .filter((row) => row.contactability_status !== "do_not_contact")
      .filter((row): row is WorkboardCallbackRow & { request_id: string } => Boolean(row.request_id))
      .filter((row) => !salesRecoveryRequestIds.includes(row.request_id))
      .map((row) => row.request_id),
  );
  const replyRequestIds = uniqueValues(
    replyAuditRows.map((row) => auditText(row.metadata || {}, "request_id") || row.document_id),
  );
  const contactStopRequestIds = uniqueValues(
    contactStopRows.map((row) => auditText(row.metadata || {}, "request_id") || row.document_id),
  );

  const allRequestIds = uniqueValues([
    ...pendingRequestIds,
    ...callbackRequestIds,
    ...salesRecoveryRequestIds,
    ...replyRequestIds,
    ...contactStopRequestIds,
  ]);

  if (!allRequestIds.length) {
    return [
      {
        key: "due_followups",
        title: "Fällige Follow-ups",
        subtitle: "Offene Versandfälle, die als Nächstes operativ fällig sind.",
        results: [],
      },
      {
        key: "callbacks",
        title: "Rückrufe",
        subtitle: "Kontakte mit gesetztem Rückruf- oder Call-Termin.",
        results: [],
      },
      {
        key: "sales_recovery",
        title: "Sales-Recovery",
        subtitle: "Angebot gesehen, aber noch kein Auftrag: kaufnahe Fälle mit aktivem Recovery-Fokus.",
        results: [],
      },
      {
        key: "recent_replies",
        title: "Frische Antworten",
        subtitle: "Neu erkannte Kundenreaktionen, die Aufmerksamkeit brauchen.",
        results: [],
      },
      {
        key: "contact_stops",
        title: "Kontaktstopps",
        subtitle: "Kürzlich gesetzte Do-not-contact-Fälle für Kontrolle und Nachverfolgung.",
        results: [],
      },
    ];
  }

  const rows = await selectMasterCustomerRows({
    request_id: `in.(${allRequestIds.join(",")})`,
    order: "updated_at.desc",
    limit: Math.max(allRequestIds.length, 12),
  });

  const contexts = await Promise.all(
    rows.map(async (row) => {
      const downstream = await fetchDownstreamRows(row, { includeTrello: false });
      return { master: applyAuditCcEmails(row, downstream.audits), ...downstream };
    }),
  );

  const recordByRequestId = new Map(
    contexts.map((context) => {
      const record = mapSearchResult(context);
      return [record.requestId, record] as const;
    }),
  );

  const stateByRequestId = new Map<string, WorkflowAuditRow>();
  for (const row of workboardStateRows) {
    const requestId = auditText(row.metadata || {}, "request_id") || row.document_id;
    if (!requestId || stateByRequestId.has(requestId)) continue;
    stateByRequestId.set(requestId, row);
  }

  function isSuppressed(record: CustomerSearchResult) {
    const state = stateByRequestId.get(record.requestId);
    if (!state) return false;
    const stateAt = new Date(state.created_at || 0).getTime();
    const latestActivity = new Date(
      record.timeline[0]?.occurredAt ||
      record.affectedRows.nextPendingFollowupAt ||
      record.request?.updatedAt ||
      record.updatedAt ||
      0,
    ).getTime();
    if (latestActivity > stateAt) return false;
    if (state.action === CUSTOMER_RECORDS_WORKBOARD_HANDLED_ACTION) return true;
    if (state.action === CUSTOMER_RECORDS_WORKBOARD_SNOOZED_ACTION) {
      const snoozeUntil = auditText(state.metadata || {}, "snooze_until");
      if (!snoozeUntil) return true;
      return new Date(snoozeUntil).getTime() > Date.now();
    }
    return false;
  }

  function orderedSection(
    requestIds: string[],
    limit: number,
    predicate?: (record: CustomerSearchResult) => boolean,
    options?: { includeSuppressed?: boolean },
  ) {
    return uniqueValues(requestIds)
      .map((requestId) => recordByRequestId.get(requestId))
      .filter((record): record is CustomerSearchResult => Boolean(record))
      .filter((record) => (options?.includeSuppressed ? true : !isSuppressed(record)))
      .filter((record) => (predicate ? predicate(record) : true))
      .slice(0, limit) as CustomerSearchResult[];
  }

  return [
    {
      key: "due_followups",
      title: "Fällige Follow-ups",
      subtitle: "Offene Versandfälle, die als Nächstes operativ fällig sind.",
      results: orderedSection(pendingRequestIds, limitPerSection),
    },
    {
      key: "callbacks",
      title: "Rückrufe",
      subtitle: "Kontakte mit gesetztem Rückruf- oder Call-Termin.",
      results: orderedSection(callbackRequestIds, limitPerSection),
    },
    {
      key: "sales_recovery",
      title: "Sales-Recovery",
      subtitle: "Angebot wurde angesehen, aber ein Auftrag ist noch nicht sauber verknüpft.",
      results: orderedSection(
        salesRecoveryRequestIds,
        limitPerSection,
        (record) => Boolean(record.quote?.viewedAt) && !record.order && record.orderDiagnostic.status === "unlinked",
        { includeSuppressed: true },
      ),
    },
    {
      key: "recent_replies",
      title: "Frische Antworten",
      subtitle: "Neu erkannte Kundenreaktionen, die Aufmerksamkeit brauchen.",
      results: orderedSection(replyRequestIds, limitPerSection),
    },
    {
      key: "contact_stops",
      title: "Kontaktstopps",
      subtitle: "Kürzlich gesetzte Do-not-contact-Fälle für Kontrolle und Nachverfolgung.",
      results: orderedSection(contactStopRequestIds, limitPerSection),
    },
  ];
}

export async function previewCustomerRecordUpdate(requestId: string, updates: CustomerUpdateFields) {
  const context = await fetchCustomerContextByRequestId(normalizeRequestSearch(requestId));
  return buildCustomerUpdatePreview(context, updates);
}

export async function updateCustomerRecord(requestId: string, updates: CustomerUpdateFields, actor?: UpdateActor) {
  const context = await fetchCustomerContextByRequestId(normalizeRequestSearch(requestId));
  const current = toEditableSnapshot(context.master);
  const plan = buildCustomerUpdatePlan(current, updates);
  const preview = buildCustomerUpdatePreview(context, updates);
  const changedTables = await applyCustomerMutation(context, current, plan, actor, {
    action: CUSTOMER_RECORDS_UPDATE_ACTION,
    summary: createAuditSummary(preview.changes),
    changedFields: preview.changes.map((change) => change.field),
  });

  const updated = mapSearchResult(await fetchCustomerContextByRequestId(requestId));
  return {
    record: updated,
    changedTables,
  };
}

export async function repairCustomerDownstreamSync(
  requestId: string,
  actor?: UpdateActor,
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const current = toEditableSnapshot(context.master);
  const plan = buildCustomerDownstreamRepairPlan(context);
  const impactedTables = createImpactedTables(context, plan);
  const changedFields = impactedTables.flatMap((entry) => entry.fields.map((field) => `${entry.table}.${field}`));
  const summary = impactedTables.length
    ? `Downstream-Sync repariert: ${impactedTables.map((entry) => entry.table).join(", ")}`
    : "Downstream-Sync repariert";

  const changedTables = await applyCustomerMutation(context, current, plan, actor, {
    action: CUSTOMER_RECORDS_DOWNSTREAM_SYNC_REPAIR_ACTION,
    summary,
    changedFields,
    extraMetadata: {
      repair_scope: "downstream_sync",
      impacted_tables: impactedTables.map((entry) => ({
        table: entry.table,
        rows: entry.rows,
        fields: entry.fields,
      })),
    },
  });

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: changedTables.followupQueue + changedTables.leadFollowupPlans + changedTables.documentJourney,
  };
}

export async function setCustomerRequestSegment(
  requestId: string,
  segment: string,
  actor?: UpdateActor,
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const option = getCustomerSegmentOption(segment);
  if (!option) {
    throw new QuoteValidationError("Unbekanntes Segment.");
  }

  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  if (!context.request) {
    throw new QuoteValidationError("Zu dieser Anfrage wurde kein master_requests-Datensatz gefunden.");
  }

  const now = new Date().toISOString();
  const previous = {
    segment: context.request.segment || null,
    s_kategorie: context.request.s_kategorie || null,
    segment_status: context.request.segment_status || null,
    segment_confidence: context.request.segment_confidence ?? null,
    segment_source: context.request.segment_source || null,
    segment_classified_at: context.request.segment_classified_at || null,
    segment_policy_version: context.request.segment_policy_version || null,
  };
  const next = {
    segment: option.segment,
    s_kategorie: option.defaultSKategorie,
    segment_status: "accepted",
    segment_confidence: 1,
    segment_source: "manual_ops_portal",
    segment_classified_at: now,
    segment_policy_version: "manual_override_v1_20260521",
  };

  await patchById("master_requests", context.request.id, next);

  try {
    await insertWorkflowAuditLog({
      requestId: normalizedRequestId,
      action: CUSTOMER_RECORDS_SEGMENT_OVERRIDE_ACTION,
      summary: `Segment manuell bestätigt: ${option.label}`,
      changedFields: [
        "master_requests.segment",
        "master_requests.s_kategorie",
        "master_requests.segment_status",
        "master_requests.segment_source",
      ],
      actor,
      extraMetadata: {
        previous_segment: previous,
        next_segment: {
          ...next,
          label: option.label,
        },
      },
    });
  } catch (error) {
    await patchById("master_requests", context.request.id, previous);
    throw error;
  }

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: 1,
  };
}

function normalizeTaskTitle(value: string | null | undefined) {
  const title = trimNullable(value);
  if (!title) {
    throw new QuoteValidationError("Bitte einen Aufgabentitel angeben.");
  }
  if (title.length > 180) {
    throw new QuoteValidationError("Aufgabentitel darf maximal 180 Zeichen lang sein.");
  }
  return title;
}

function normalizeTaskDueAt(value: string | null | undefined) {
  const dueAt = trimNullable(value);
  if (!dueAt) return null;
  const parsed = new Date(dueAt).getTime();
  if (!Number.isFinite(parsed)) {
    throw new QuoteValidationError("Bitte ein gültiges Fälligkeitsdatum angeben.");
  }
  return dueAt.length === 10 ? `${dueAt}T09:00:00.000Z` : new Date(dueAt).toISOString();
}

function taskAuditDocumentId(taskId: string, requestId: string | null) {
  return requestId || `internal-task:${taskId}`;
}

function normalizeTaskIdentityPart(value: string | null | undefined, maxLength = 180) {
  const normalized = trimNullable(value);
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeTaskSourceType(value: string | null | undefined) {
  const normalized = normalizeTaskIdentityPart(value, 80)?.toLowerCase().replace(/[^a-z0-9:_-]+/g, "_");
  return normalized || null;
}

export function buildCustomerInternalTaskIdentity(input: Pick<
  CustomerInternalTaskInput,
  "clientActionId" | "idempotencyKey" | "sourceType" | "sourceId"
>) {
  const clientActionId = normalizeTaskIdentityPart(input.clientActionId);
  const explicitKey = normalizeTaskIdentityPart(input.idempotencyKey) || clientActionId;
  const sourceType = normalizeTaskSourceType(input.sourceType);
  const sourceId = normalizeTaskIdentityPart(input.sourceId, 240);
  const idempotencyKey = explicitKey
    ? `client:${explicitKey}`
    : sourceType && sourceId
      ? `source:${sourceType}:${sourceId}`
      : null;

  return {
    clientActionId,
    idempotencyKey,
    sourceType,
    sourceId,
    taskId: idempotencyKey
      ? `task_${createHash("sha256").update(`neontrip:internal-task:${idempotencyKey}`).digest("hex").slice(0, 32)}`
      : null,
  };
}

function buildTaskAuditMetadata(input: {
  taskId: string;
  title: string;
  description?: string | null;
  category: CustomerInternalTaskCategory;
  priority: CustomerInternalTaskPriority;
  assigneeName?: string | null;
  dueAt?: string | null;
  requestId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  note?: string | null;
  clientActionId?: string | null;
  idempotencyKey?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  actor?: UpdateActor;
}) {
  return {
    task_id: input.taskId,
    task_title: input.title,
    task_description: trimNullable(input.description),
    task_category: input.category,
    task_priority: input.priority,
    task_assignee_name: trimNullable(input.assigneeName),
    task_due_at: input.dueAt || null,
    task_request_id: trimNullable(input.requestId),
    task_customer_name: trimNullable(input.customerName),
    task_customer_email: trimNullable(input.customerEmail),
    task_note: trimNullable(input.note),
    task_client_action_id: trimNullable(input.clientActionId),
    task_idempotency_key: trimNullable(input.idempotencyKey),
    task_source_type: trimNullable(input.sourceType),
    task_source_id: trimNullable(input.sourceId),
    operator_name: trimNullable(input.actor?.operatorName),
    actor_label: actorLabel(input.actor),
  };
}

async function insertTaskAuditLog(input: {
  documentId: string;
  action: string;
  status?: string;
  summary: string;
  metadata: Record<string, unknown>;
  actor?: UpdateActor;
}) {
  await supabaseRequest("workflow_audit_log", {
    method: "POST",
    body: JSON.stringify({
      document_id: input.documentId,
      workflow_name: CUSTOMER_RECORDS_WORKFLOW_NAME,
      action: input.action,
      status: input.status || "success",
      metadata: {
        request_id: input.documentId.startsWith("internal-task:") ? null : input.documentId,
        summary: input.summary,
        actor_label: actorLabel(input.actor),
        actor: input.actor || null,
        ...input.metadata,
      },
    }),
    headers: { Prefer: "return=minimal" },
  });
}

async function fetchInternalTaskAuditRows(options: {
  limit?: number;
  requestId?: string | null;
  taskId?: string | null;
} = {}) {
  const requestId = trimNullable(options.requestId);
  const taskId = trimNullable(options.taskId);
  const query: Record<string, string | number> = {
    select: "id,document_id,workflow_name,action,status,error_message,metadata,created_at",
    workflow_name: `eq.${CUSTOMER_RECORDS_WORKFLOW_NAME}`,
    action: `in.(${[
      CUSTOMER_RECORDS_TASK_CREATED_ACTION,
      CUSTOMER_RECORDS_TASK_UPDATED_ACTION,
      CUSTOMER_RECORDS_TASK_COMPLETED_ACTION,
      CUSTOMER_RECORDS_TASK_REOPENED_ACTION,
    ].join(",")})`,
    order: "created_at.desc",
    limit: options.limit || (requestId || taskId ? 5000 : 1000),
  };

  if (requestId) {
    const encodedRequestId = encodeURIComponent(requestId);
    query.or = `(${[
      `document_id.eq.${encodedRequestId}`,
      `metadata->>task_request_id.eq.${encodedRequestId}`,
      `metadata->>request_id.eq.${encodedRequestId}`,
    ].join(",")})`;
  }
  if (taskId) {
    query["metadata->>task_id"] = `eq.${encodeURIComponent(taskId)}`;
  }

  return supabaseRequest<WorkflowAuditRow[]>("workflow_audit_log", undefined, query);
}

export async function listCustomerInternalTasks(options?: {
  requestId?: string | null;
  assigneeName?: string | null;
  includeDone?: boolean;
  limit?: number;
}): Promise<CustomerInternalTaskBoard> {
  let rows: WorkflowAuditRow[];
  try {
    rows = await fetchInternalTaskAuditRows({
      requestId: options?.requestId,
      limit: options?.limit,
    });
  } catch (error) {
    if (!options?.requestId || !(error instanceof SupabaseRestError)) throw error;
    rows = await fetchInternalTaskAuditRows({ limit: options?.limit || 5000 });
  }
  return buildCustomerInternalTaskBoardFromAudits(rows, options);
}

async function getCustomerTaskContext(requestId: string | null) {
  if (!requestId) return null;
  const context = await fetchCustomerContextByRequestId(normalizeRequestSearch(requestId));
  return {
    requestId: context.master.request_id,
    customerName: toEditableSnapshot(context.master).displayName,
    customerEmail: normalizeEmail(context.master.email),
  };
}

function findInternalTask(board: CustomerInternalTaskBoard, taskId: string) {
  const task = board.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new QuoteValidationError("Aufgabe wurde nicht gefunden.", [], 404);
  }
  return task;
}

async function getCustomerInternalTaskById(taskId: string) {
  try {
    return findInternalTask(
      buildCustomerInternalTaskBoardFromAudits(await fetchInternalTaskAuditRows({ taskId, limit: 500 }), { includeDone: true }),
      taskId,
    );
  } catch (error) {
    if (!(error instanceof SupabaseRestError)) throw error;
    return findInternalTask(
      buildCustomerInternalTaskBoardFromAudits(await fetchInternalTaskAuditRows({ limit: 5000 }), { includeDone: true }),
      taskId,
    );
  }
}

async function findExistingCustomerInternalTaskById(taskId: string) {
  try {
    return await getCustomerInternalTaskById(taskId);
  } catch (error) {
    if (error instanceof QuoteValidationError && error.status === 404) return null;
    throw error;
  }
}

export async function createCustomerInternalTask(
  input: CustomerInternalTaskInput,
  actor?: UpdateActor,
): Promise<CustomerInternalTask> {
  const identity = buildCustomerInternalTaskIdentity(input);
  const taskId = identity.taskId || crypto.randomUUID();
  const title = normalizeTaskTitle(input.title);
  const existing = identity.taskId ? await findExistingCustomerInternalTaskById(identity.taskId) : null;
  if (existing) return existing;

  const requestId = trimNullable(input.requestId);
  const context = await getCustomerTaskContext(requestId);
  const category = normalizeTaskCategory(input.category || (requestId ? "customer_followup" : "other"));
  const priority = normalizeTaskPriority(input.priority || "normal");
  const dueAt = normalizeTaskDueAt(input.dueAt);

  await insertTaskAuditLog({
    documentId: taskAuditDocumentId(taskId, context?.requestId || requestId),
    action: CUSTOMER_RECORDS_TASK_CREATED_ACTION,
    summary: `Interne Aufgabe erstellt: ${title}`,
    metadata: buildTaskAuditMetadata({
      taskId,
      title,
      description: input.description,
      category,
      priority,
      assigneeName: input.assigneeName,
      dueAt,
      requestId: context?.requestId || requestId,
      customerName: context?.customerName || null,
      customerEmail: context?.customerEmail || null,
      clientActionId: identity.clientActionId,
      idempotencyKey: identity.idempotencyKey,
      sourceType: identity.sourceType,
      sourceId: identity.sourceId,
      actor,
    }),
    actor,
  });

  return getCustomerInternalTaskById(taskId);
}

export async function updateCustomerInternalTask(
  input: CustomerInternalTaskUpdateInput,
  actor?: UpdateActor,
): Promise<CustomerInternalTask> {
  const taskId = trimNullable(input.taskId);
  if (!taskId) {
    throw new QuoteValidationError("Bitte eine Aufgaben-ID angeben.");
  }
  const existing = await getCustomerInternalTaskById(taskId);
  const requestId = input.requestId === undefined ? existing.requestId : trimNullable(input.requestId);
  const context = await getCustomerTaskContext(requestId);
  const title = input.title === undefined ? existing.title : normalizeTaskTitle(input.title);
  const description = input.description === undefined ? existing.description : trimNullable(input.description);
  const category = normalizeTaskCategory(input.category || existing.category);
  const priority = normalizeTaskPriority(input.priority || existing.priority);
  const dueAt = input.dueAt === undefined ? existing.dueAt : normalizeTaskDueAt(input.dueAt);
  const assigneeName = input.assigneeName === undefined ? existing.assigneeName : trimNullable(input.assigneeName);

  await insertTaskAuditLog({
    documentId: taskAuditDocumentId(taskId, context?.requestId || requestId),
    action: CUSTOMER_RECORDS_TASK_UPDATED_ACTION,
    summary: `Interne Aufgabe aktualisiert: ${title}`,
    metadata: buildTaskAuditMetadata({
      taskId,
      title,
      description,
      category,
      priority,
      assigneeName,
      dueAt,
      requestId: context?.requestId || requestId,
      customerName: context?.customerName || existing.customerName,
      customerEmail: context?.customerEmail || existing.customerEmail,
      clientActionId: existing.clientActionId,
      idempotencyKey: existing.idempotencyKey,
      sourceType: existing.sourceType,
      sourceId: existing.sourceId,
      actor,
    }),
    actor,
  });

  return getCustomerInternalTaskById(taskId);
}

export async function completeCustomerInternalTask(
  taskId: string,
  note?: string | null,
  actor?: UpdateActor,
): Promise<CustomerInternalTask> {
  const normalizedTaskId = trimNullable(taskId);
  if (!normalizedTaskId) {
    throw new QuoteValidationError("Bitte eine Aufgaben-ID angeben.");
  }
  const existing = await getCustomerInternalTaskById(normalizedTaskId);
  if (existing.status === "done") return existing;

  await insertTaskAuditLog({
    documentId: taskAuditDocumentId(normalizedTaskId, existing.requestId),
    action: CUSTOMER_RECORDS_TASK_COMPLETED_ACTION,
    summary: `Interne Aufgabe erledigt: ${existing.title}`,
    metadata: {
      ...buildTaskAuditMetadata({
        taskId: normalizedTaskId,
        title: existing.title,
        description: existing.description,
        category: existing.category,
        priority: existing.priority,
        assigneeName: existing.assigneeName,
        dueAt: existing.dueAt,
        requestId: existing.requestId,
        customerName: existing.customerName,
        customerEmail: existing.customerEmail,
        clientActionId: existing.clientActionId,
        idempotencyKey: existing.idempotencyKey,
        sourceType: existing.sourceType,
        sourceId: existing.sourceId,
        actor,
      }),
      task_completion_note: trimNullable(note),
    },
    actor,
  });

  return getCustomerInternalTaskById(normalizedTaskId);
}

export async function reopenCustomerInternalTask(
  taskId: string,
  note?: string | null,
  actor?: UpdateActor,
): Promise<CustomerInternalTask> {
  const normalizedTaskId = trimNullable(taskId);
  if (!normalizedTaskId) {
    throw new QuoteValidationError("Bitte eine Aufgaben-ID angeben.");
  }
  const existing = await getCustomerInternalTaskById(normalizedTaskId);

  await insertTaskAuditLog({
    documentId: taskAuditDocumentId(normalizedTaskId, existing.requestId),
    action: CUSTOMER_RECORDS_TASK_REOPENED_ACTION,
    summary: `Interne Aufgabe wieder geöffnet: ${existing.title}`,
    metadata: buildTaskAuditMetadata({
      taskId: normalizedTaskId,
      title: existing.title,
      description: existing.description,
      category: existing.category,
      priority: existing.priority,
      assigneeName: existing.assigneeName,
      dueAt: existing.dueAt,
      requestId: existing.requestId,
      customerName: existing.customerName,
      customerEmail: existing.customerEmail,
      note,
      clientActionId: existing.clientActionId,
      idempotencyKey: existing.idempotencyKey,
      sourceType: existing.sourceType,
      sourceId: existing.sourceId,
      actor,
    }),
    actor,
  });

  return getCustomerInternalTaskById(normalizedTaskId);
}

export async function updateCustomerTrelloFields(
  requestId: string,
  boardKey: string,
  updates: CustomerTrelloFieldUpdateInput[],
  actor?: UpdateActor,
) {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const editableCard = context.trello?.editableCards.find((card) => card.boardKey === boardKey) || null;

  if (!editableCard) {
    throw new QuoteValidationError("Für dieses Board ist keine editierbare Trello-Karte verfügbar.", [], 404);
  }

  if (!updates.length) {
    throw new QuoteValidationError("Keine Trello-Feldänderung übergeben.");
  }

  const fieldById = new Map(editableCard.fields.map((field) => [field.fieldId, field]));
  const normalizedUpdates = updates
    .map((entry) => {
      const field = fieldById.get(entry.fieldId);
      if (!field) {
        throw new QuoteValidationError(`Trello-Feld ${entry.fieldId} wurde auf der Karte nicht gefunden.`);
      }
      const normalizedValue = normalizeTrelloFieldUpdate(field, entry.value);
      const before =
        field.type === "checkbox"
          ? Boolean(field.value)
          : field.value === null || field.value === undefined || field.value === ""
            ? null
            : String(field.value);
      const after =
        field.type === "checkbox"
          ? Boolean(normalizedValue)
          : normalizedValue === null || normalizedValue === undefined || normalizedValue === ""
            ? null
            : String(normalizedValue);

      if (before === after) return null;
      return { field, value: normalizedValue };
    })
    .filter(Boolean) as Array<{ field: CustomerTrelloField; value: string | boolean | null }>;

  if (!normalizedUpdates.length) {
    throw new QuoteValidationError("Keine Trello-Feldänderung erkannt.");
  }

  const rollbackSteps: Array<() => Promise<unknown>> = [];

  try {
    for (const update of normalizedUpdates) {
      await updateTrelloCustomField({
        cardId: editableCard.cardId,
        fieldId: update.field.fieldId,
        type: update.field.type,
        value: update.value,
      });
      rollbackSteps.push(() =>
        updateTrelloCustomField({
          cardId: editableCard.cardId,
          fieldId: update.field.fieldId,
          type: update.field.type,
          value: update.field.value,
        }),
      );
    }

    await insertWorkflowAuditLog({
      requestId: context.master.request_id,
      action: CUSTOMER_RECORDS_TRELLO_FIELDS_ACTION,
      status: "success",
      summary: `${normalizedUpdates.length} Trello-Feld${normalizedUpdates.length > 1 ? "er" : ""} aktualisiert`,
      changedFields: normalizedUpdates.map((update) => update.field.name),
      actor,
      extraMetadata: {
        trello_card_id: editableCard.cardId,
        trello_board_key: editableCard.boardKey,
        updated_fields: normalizedUpdates.map((update) => ({
          id: update.field.fieldId,
          name: update.field.name,
          type: update.field.type,
        })),
      },
    });
  } catch (error) {
    const rollbackFailures = await rollbackChanges(rollbackSteps);
    if (rollbackFailures.length) {
      throw new SupabaseRestError(
        "Trello-Felder konnten nicht sauber aktualisiert werden. Rollback teilweise fehlgeschlagen.",
        500,
        rollbackFailures,
      );
    }
    throw error;
  }

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: normalizedUpdates.length,
  };
}

export async function updateCustomerTrelloCard(
  requestId: string,
  input: CustomerTrelloCardUpdateInput,
  actor?: UpdateActor,
) {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const boardCard = context.trello?.cards.find(
    (card) => card.boardKey === input.boardKey && card.cardId === input.cardId,
  );

  if (!boardCard || !boardCard.cardId) {
    throw new QuoteValidationError("Die gewählte Trello-Karte ist für diese Anfrage nicht verfügbar.", [], 404);
  }

  const nextName = input.name === undefined ? boardCard.cardName : trimNullable(input.name);
  const nextDesc = input.desc === undefined ? boardCard.cardDescription : trimNullable(input.desc);
  const nextListId = input.listId === undefined ? boardCard.listId : trimNullable(input.listId);

  if (!nextName) {
    throw new QuoteValidationError("Trello-Kartentitel darf nicht leer sein.");
  }

  if (
    nextName === boardCard.cardName &&
    nextDesc === boardCard.cardDescription &&
    nextListId === boardCard.listId
  ) {
    throw new QuoteValidationError("Keine Trello-Kartenänderung erkannt.");
  }

  if (nextListId && !boardCard.listOptions.some((option) => option.listId === nextListId)) {
    throw new QuoteValidationError("Die gewählte Zielliste gehört nicht zu diesem Trello-Board.");
  }

  const rollbackSteps: Array<() => Promise<unknown>> = [];
  const changedFields: string[] = [];

  try {
    if (nextName !== boardCard.cardName || nextDesc !== boardCard.cardDescription) {
      await updateTrelloCard(boardCard.cardId, {
        name: nextName,
        desc: nextDesc,
      });
      changedFields.push(
        ...(nextName !== boardCard.cardName ? ["card_name"] : []),
        ...(nextDesc !== boardCard.cardDescription ? ["card_description"] : []),
      );
      rollbackSteps.push(() =>
        updateTrelloCard(boardCard.cardId!, {
          name: boardCard.cardName,
          desc: boardCard.cardDescription,
        }),
      );
    }

    if (nextListId !== boardCard.listId && nextListId) {
      await moveTrelloCardToList(boardCard.cardId, nextListId);
      changedFields.push("card_list");
      if (boardCard.listId) {
        rollbackSteps.push(() => moveTrelloCardToList(boardCard.cardId!, boardCard.listId!));
      }
    }

    await insertWorkflowAuditLog({
      requestId: context.master.request_id,
      action: CUSTOMER_RECORDS_TRELLO_CARD_ACTION,
      status: "success",
      summary: `${boardCard.boardName} Karte aktualisiert`,
      changedFields,
      actor,
      extraMetadata: {
        trello_card_id: boardCard.cardId,
        trello_board_key: boardCard.boardKey,
        before: {
          card_name: boardCard.cardName,
          card_description: boardCard.cardDescription,
          list_id: boardCard.listId,
          list_name: boardCard.listName,
        },
        after: {
          card_name: nextName,
          card_description: nextDesc,
          list_id: nextListId,
          list_name: boardCard.listOptions.find((option) => option.listId === nextListId)?.label || null,
        },
      },
    });
  } catch (error) {
    const rollbackFailures = await rollbackChanges(rollbackSteps);
    if (rollbackFailures.length) {
      throw new SupabaseRestError(
        "Trello-Karte konnte nicht sauber aktualisiert werden. Rollback teilweise fehlgeschlagen.",
        500,
        rollbackFailures,
      );
    }
    throw error;
  }

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: changedFields.length,
  };
}

export async function addCustomerOpsNote(requestId: string, note: string, actor?: UpdateActor) {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const normalizedNote = trimNullable(note);

  if (!normalizedNote) {
    throw new QuoteValidationError("Notiz darf nicht leer sein.");
  }

  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const rows = await supabaseRequest<WorkflowAuditRow[]>(
    "workflow_audit_log",
    {
      method: "POST",
      body: JSON.stringify([
        {
          document_id: context.master.request_id,
          workflow_name: CUSTOMER_RECORDS_WORKFLOW_NAME,
          action: CUSTOMER_RECORDS_NOTE_ACTION,
          status: "info",
          metadata: {
            request_id: context.master.request_id,
            note_text: normalizedNote,
            actor_label: actorLabel(actor),
            actor: actor || null,
          },
        },
      ]),
      headers: { Prefer: "return=representation" },
    },
  );

  return mapNoteEntry(rows[0]);
}

export async function reschedulePendingCustomerFollowups(
  requestId: string,
  resumeAt: string,
  actor?: UpdateActor,
  reason = "Kunde vorübergehend nicht erreichbar.",
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const pending = context.followups
    .filter((row) => row.status === "pending" && row.scheduled_for)
    .sort((left, right) => new Date(String(left.scheduled_for)).getTime() - new Date(String(right.scheduled_for)).getTime());
  const normalizedReason = trimNullable(reason) || "Kunde vorübergehend nicht erreichbar.";

  if (!pending.length) {
    throw new QuoteValidationError("Für diese Anfrage gibt es keine terminierbaren offenen Follow-ups.");
  }

  const targetIso = parseFutureIsoDate(resumeAt);
  const earliest = new Date(String(pending[0].scheduled_for));
  const deltaMs = new Date(targetIso).getTime() - earliest.getTime();
  if (deltaMs === 0) {
    throw new QuoteValidationError("Die Follow-ups liegen bereits auf diesem Datum.");
  }

  const rollbackSteps: Array<() => Promise<unknown>> = [];

  try {
    for (const row of pending) {
      const previous = {
        scheduled_for: row.scheduled_for || null,
        email_context_decision: null,
        email_context_delay_until: null,
        email_context_reason: null,
      };
      const shifted = new Date(new Date(String(row.scheduled_for)).getTime() + deltaMs).toISOString();
      await patchById("followup_queue", row.id, {
        scheduled_for: shifted,
        email_context_decision: "delay",
        email_context_delay_until: targetIso,
        email_context_reason: normalizedReason,
      });
      rollbackSteps.push(() => patchById("followup_queue", row.id, previous));
    }

    for (const row of context.plans) {
      const previous = {
        call_after: row.call_after || null,
        planning_reason: row.planning_reason || null,
      };
      await patchById("lead_followup_plans", row.id, {
        call_after: targetIso,
        planning_reason: normalizedReason,
      });
      rollbackSteps.push(() => patchById("lead_followup_plans", row.id, previous));
    }

    await insertWorkflowAuditLog({
      requestId: context.master.request_id,
      action: CUSTOMER_RECORDS_FOLLOWUP_RESCHEDULE_ACTION,
      status: "success",
      summary: `${pending.length} offene Follow-up${pending.length > 1 ? "s" : ""} verschoben`,
      actor,
      extraMetadata: {
        affected_followups: pending.length,
        followup_ids: pending.map((row) => row.id),
        delay_until: targetIso,
        reason: normalizedReason,
      },
    });
  } catch (error) {
    const rollbackFailures = await rollbackChanges(rollbackSteps);
    if (rollbackFailures.length) {
      throw new SupabaseRestError(
        "Follow-ups konnten nicht sauber verschoben werden. Rollback teilweise fehlgeschlagen.",
        500,
        rollbackFailures,
      );
    }
    throw error;
  }

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: pending.length,
  };
}

export async function blockCustomerContact(
  requestId: string,
  actor?: UpdateActor,
  reason = "Kunde möchte keinen weiteren Kontakt.",
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const pending = context.followups.filter((row) => row.status === "pending");
  const normalizedReason = trimNullable(reason) || "Kunde möchte keinen weiteren Kontakt.";
  const rollbackSteps: Array<() => Promise<unknown>> = [];
  const now = new Date().toISOString();
  const email = normalizeEmail(context.master.email);
  const blacklistRows = await supabaseRequest<FollowupBlacklistRow[]>("followup_blacklist", undefined, {
    select: "id,email,domain,reason,added_by,expires_at",
    email: `eq.${encodeURIComponent(email)}`,
    limit: 1,
  });
  const existingBlacklist = blacklistRows[0] || null;

  try {
    for (const row of pending) {
      const previous = {
        status: row.status || null,
        cancelled_at: null,
        cancel_reason: null,
      };
      await patchById("followup_queue", row.id, {
        status: "cancelled",
        cancelled_at: now,
        cancel_reason: normalizedReason,
      });
      rollbackSteps.push(() => patchById("followup_queue", row.id, previous));
    }

    for (const row of context.plans) {
      const previous = {
        contactability_status: row.contactability_status || null,
        call_after: row.call_after || null,
        planning_reason: row.planning_reason || null,
      };
      await patchById("lead_followup_plans", row.id, {
        contactability_status: "do_not_contact",
        call_after: null,
        planning_reason: normalizedReason,
      });
      rollbackSteps.push(() => patchById("lead_followup_plans", row.id, previous));
    }

    if (existingBlacklist) {
      const previous = {
        reason: existingBlacklist.reason || null,
        added_by: existingBlacklist.added_by || null,
        expires_at: existingBlacklist.expires_at || null,
      };
      await patchById("followup_blacklist", existingBlacklist.id, {
        reason: normalizedReason,
        added_by: actorLabel(actor) || "customer_records_console",
        expires_at: null,
      });
      rollbackSteps.push(() => patchById("followup_blacklist", existingBlacklist.id, previous));
    } else {
      const created = await supabaseRequest<FollowupBlacklistRow[]>(
        "followup_blacklist",
        {
          method: "POST",
          body: JSON.stringify([
            {
              email,
              reason: normalizedReason,
              added_by: actorLabel(actor) || "customer_records_console",
              expires_at: null,
            },
          ]),
          headers: { Prefer: "return=representation" },
        },
      );
      const createdId = created[0]?.id;
      if (createdId) {
        rollbackSteps.push(() => deleteById("followup_blacklist", createdId));
      }
    }

    await insertWorkflowAuditLog({
      requestId: context.master.request_id,
      action: CUSTOMER_RECORDS_CONTACT_BLOCK_ACTION,
      status: "success",
      summary: "Kontaktstopp gesetzt",
      actor,
      extraMetadata: {
        affected_followups: pending.length,
        followup_ids: pending.map((row) => row.id),
        reason: normalizedReason,
        blacklisted_email: email,
      },
    });
  } catch (error) {
    const rollbackFailures = await rollbackChanges(rollbackSteps);
    if (rollbackFailures.length) {
      throw new SupabaseRestError(
        "Kontaktstopp konnte nicht sauber gesetzt werden. Rollback teilweise fehlgeschlagen.",
        500,
        rollbackFailures,
      );
    }
    throw error;
  }

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: pending.length || 1,
  };
}

export async function rollbackLastCustomerRecordUpdate(requestId: string, actor?: UpdateActor): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const lastUpdate = context.audits.find((row) => row.action === CUSTOMER_RECORDS_UPDATE_ACTION);

  if (!lastUpdate) {
    throw new QuoteValidationError("Es gibt keine vorherige Änderung aus dieser Konsole zum Zurückrollen.", [], 404);
  }

  const metadata = lastUpdate.metadata || {};
  const before = metadata.before;
  const after = metadata.after;

  if (!isEditableSnapshot(before) || !isEditableSnapshot(after)) {
    throw new SupabaseRestError("Der letzte Audit-Eintrag enthält keinen vollständigen Rollback-Snapshot.", 500);
  }

  const current = toEditableSnapshot(context.master);
  if (!snapshotEquals(current, after)) {
    throw new QuoteValidationError(
      "Rollback abgebrochen: Der aktuelle Datensatz weicht bereits vom letzten gespeicherten Zustand ab.",
    );
  }

  const plan = buildCustomerUpdatePlan(current, {
    email: before.email,
    billingEmail: before.billingEmail || "",
    ccEmails: before.ccEmails || [],
    firstName: before.firstName || "",
    lastName: before.lastName || "",
    phone: before.phone || "",
    company: before.company || "",
  });

  await applyCustomerMutation(context, current, plan, actor, {
    action: CUSTOMER_RECORDS_ROLLBACK_ACTION,
    summary: `Rollback auf Stand vor ${formatAuditDate(lastUpdate.created_at)}`,
    changedFields: Object.keys(plan.masterPatch),
    extraMetadata: {
      reverted_audit_id: lastUpdate.id,
      reverted_from_action: lastUpdate.action || CUSTOMER_RECORDS_UPDATE_ACTION,
      reason: "Manueller Rollback der letzten Customer-Records-Änderung.",
    },
  });

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: 1,
  };
}

export async function pausePendingCustomerFollowups(
  requestId: string,
  actor?: UpdateActor,
  reason = "Pausiert via Customer Records Console.",
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const pending = context.followups.filter((row) => row.status === "pending");

  if (!pending.length) {
    throw new QuoteValidationError("Für diese Anfrage gibt es keine offenen Follow-ups zum Pausieren.");
  }

  const rollbackSteps: Array<() => Promise<unknown>> = [];
  const now = new Date().toISOString();

  try {
    for (const row of pending) {
      const previous = {
        status: row.status || null,
        cancelled_at: null,
        cancel_reason: null,
      };
      await patchById("followup_queue", row.id, {
        status: "cancelled",
        cancelled_at: now,
        cancel_reason: reason,
      });
      rollbackSteps.push(() => patchById("followup_queue", row.id, previous));
    }

    await insertWorkflowAuditLog({
      requestId: context.master.request_id,
      action: CUSTOMER_RECORDS_FOLLOWUP_PAUSE_ACTION,
      status: "success",
      summary: `${pending.length} offene Follow-up${pending.length > 1 ? "s" : ""} pausiert`,
      actor,
      extraMetadata: {
        affected_followups: pending.length,
        followup_ids: pending.map((row) => row.id),
        reason,
      },
    });
  } catch (error) {
    const rollbackFailures = await rollbackChanges(rollbackSteps);
    if (rollbackFailures.length) {
      throw new SupabaseRestError(
        "Follow-ups konnten nicht sauber pausiert werden. Rollback teilweise fehlgeschlagen.",
        500,
        rollbackFailures,
      );
    }
    throw error;
  }

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: pending.length,
  };
}

export async function logCustomerCall(
  requestId: string,
  input: CustomerCallLogInput,
  actor?: UpdateActor,
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const note = trimNullable(input.note);

  if (
    !input.reached &&
    !input.leftVoicemail &&
    !input.customerOnVacation &&
    !input.askedForCallback &&
    !input.noInterest &&
    !input.emailConfirmed &&
    !input.offerDiscussed &&
    !input.whatsappPreferred &&
    !input.deleteRequested &&
    !note
  ) {
    throw new QuoteValidationError("Bitte mindestens einen Anrufstatus oder eine Notiz angeben.");
  }

  const flags = [
    input.reached ? "erreicht" : null,
    input.leftVoicemail ? "voicemail" : null,
    input.customerOnVacation ? "urlaub" : null,
    input.askedForCallback ? "rückruf" : null,
    input.noInterest ? "kein_interesse" : null,
    input.emailConfirmed ? "email_bestätigt" : null,
    input.offerDiscussed ? "angebot_besprochen" : null,
    input.whatsappPreferred ? "whatsapp_bevorzugt" : null,
    input.deleteRequested ? "datenlöschung" : null,
  ].filter(Boolean);

  await insertWorkflowAuditLog({
    requestId: context.master.request_id,
    action: CUSTOMER_RECORDS_CALL_LOG_ACTION,
    status: "info",
    summary: `Anruf protokolliert${flags.length ? `: ${flags.join(", ")}` : ""}`,
    actor,
    extraMetadata: {
      call_flags: flags,
      reached: input.reached,
      left_voicemail: input.leftVoicemail,
      customer_on_vacation: input.customerOnVacation,
      asked_for_callback: input.askedForCallback,
      no_interest: input.noInterest,
      email_confirmed: input.emailConfirmed,
      offer_discussed: input.offerDiscussed,
      whatsapp_preferred: input.whatsappPreferred,
      delete_requested: input.deleteRequested,
      note: note,
      customer_phone: trimNullable(context.master.phone),
      customer_email: normalizeEmail(context.master.email),
    },
  });

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: 1,
  };
}

export async function scheduleCustomerCallback(
  requestId: string,
  callbackAt: string,
  actor?: UpdateActor,
  reason = "Kunde bat um Rückruf.",
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const pending = context.followups
    .filter((row) => row.status === "pending" && row.scheduled_for)
    .sort((left, right) => new Date(String(left.scheduled_for)).getTime() - new Date(String(right.scheduled_for)).getTime());
  const targetIso = parseFutureIsoDate(callbackAt);
  const normalizedReason = trimNullable(reason) || "Kunde bat um Rückruf.";
  const rollbackSteps: Array<() => Promise<unknown>> = [];

  try {
    if (pending.length) {
      const earliest = new Date(String(pending[0].scheduled_for));
      const deltaMs = new Date(targetIso).getTime() - earliest.getTime();

      for (const row of pending) {
        const previous = {
          scheduled_for: row.scheduled_for || null,
          email_context_decision: null,
          email_context_delay_until: null,
          email_context_reason: null,
        };
        const shifted = new Date(new Date(String(row.scheduled_for)).getTime() + deltaMs).toISOString();
        await patchById("followup_queue", row.id, {
          scheduled_for: shifted,
          email_context_decision: "callback",
          email_context_delay_until: targetIso,
          email_context_reason: normalizedReason,
        });
        rollbackSteps.push(() => patchById("followup_queue", row.id, previous));
      }
    }

    for (const row of context.plans) {
      const previous = {
        call_after: row.call_after || null,
        planning_reason: row.planning_reason || null,
        contactability_status: row.contactability_status || null,
      };
      await patchById("lead_followup_plans", row.id, {
        call_after: targetIso,
        planning_reason: normalizedReason,
        contactability_status: "callback_scheduled",
      });
      rollbackSteps.push(() => patchById("lead_followup_plans", row.id, previous));
    }

    await insertWorkflowAuditLog({
      requestId: context.master.request_id,
      action: CUSTOMER_RECORDS_CALLBACK_SCHEDULED_ACTION,
      status: "success",
      summary: "Rückruf terminiert",
      actor,
      extraMetadata: {
        callback_at: targetIso,
        reason: normalizedReason,
        affected_followups: pending.length,
        followup_ids: pending.map((row) => row.id),
      },
    });
  } catch (error) {
    const rollbackFailures = await rollbackChanges(rollbackSteps);
    if (rollbackFailures.length) {
      throw new SupabaseRestError(
        "Rückruf konnte nicht sauber terminiert werden. Rollback teilweise fehlgeschlagen.",
        500,
        rollbackFailures,
      );
    }
    throw error;
  }

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: Math.max(context.plans.length, pending.length, 1),
  };
}

export async function startCustomerSalesRecovery(
  requestId: string,
  actor?: UpdateActor,
  reason = "Angebot gesehen, Auftrag fehlt. Kaufnahen Rückruf anstoßen.",
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);

  if (!context.quote?.viewed_at || context.order || context.orderDiagnostic.status !== "unlinked") {
    throw new QuoteValidationError("Für diesen Datensatz liegt aktuell kein offenes Kaufsignal ohne Auftrag vor.");
  }

  const phone = trimNullable(context.master.phone);
  if (!phone) {
    throw new QuoteValidationError("Für diesen Datensatz fehlt eine Telefonnummer für die Sales-Recovery.");
  }

  const normalizedReason = trimNullable(reason) || "Angebot gesehen, Auftrag fehlt. Kaufnahen Rückruf anstoßen.";
  const callbackAt =
    context.plans.some((row) => row.call_after && new Date(String(row.call_after)).getTime() > Date.now())
      ? String(
          [...context.plans]
            .filter((row) => row.call_after)
            .sort((left, right) => new Date(String(left.call_after)).getTime() - new Date(String(right.call_after)).getTime())[0]
            ?.call_after,
        )
      : new Date(
          (() => {
            const base = new Date();
            base.setDate(base.getDate() + 1);
            base.setHours(10, 0, 0, 0);
            return base;
          })(),
        ).toISOString();

  await scheduleCustomerCallback(normalizedRequestId, callbackAt, actor, normalizedReason);
  await setCustomerWorkboardState(
    normalizedRequestId,
    {
      state: "snoozed",
      snoozeUntil: callbackAt,
      reason: normalizedReason,
    },
    actor,
  );

  await insertWorkflowAuditLog({
    requestId: normalizedRequestId,
    action: CUSTOMER_RECORDS_SALES_RECOVERY_ACTION,
    status: "success",
    summary: "Sales-Recovery gestartet",
    actor,
    extraMetadata: {
      reason: normalizedReason,
      callback_at: callbackAt,
      quote_viewed_at: context.quote.viewed_at,
      order_diagnostic_status: context.orderDiagnostic.status,
      order_diagnostic_summary: context.orderDiagnostic.summary,
      customer_phone: phone,
      linked_actions: [CUSTOMER_RECORDS_CALLBACK_SCHEDULED_ACTION, CUSTOMER_RECORDS_WORKBOARD_SNOOZED_ACTION],
    },
  });

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: 2,
  };
}

export async function setCustomerWorkboardState(
  requestId: string,
  input: CustomerWorkboardStateInput,
  actor?: UpdateActor,
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const normalizedReason = trimNullable(input.reason) || null;

  if (input.state === "snoozed") {
    const snoozeUntil = parseFutureIsoDate(input.snoozeUntil || "");
    await insertWorkflowAuditLog({
      requestId: context.master.request_id,
      action: CUSTOMER_RECORDS_WORKBOARD_SNOOZED_ACTION,
      status: "success",
      summary: "Workboard-Fall zurückgestellt",
      actor,
      extraMetadata: {
        request_id: context.master.request_id,
        snooze_until: snoozeUntil,
        reason: normalizedReason || "Später bearbeiten.",
        actor_label: actorLabel(actor),
      },
    });
  } else {
    await insertWorkflowAuditLog({
      requestId: context.master.request_id,
      action: CUSTOMER_RECORDS_WORKBOARD_HANDLED_ACTION,
      status: "success",
      summary: "Workboard-Fall erledigt",
      actor,
      extraMetadata: {
        request_id: context.master.request_id,
        reason: normalizedReason || "Operativ erledigt.",
        actor_label: actorLabel(actor),
      },
    });
  }

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: 1,
  };
}

function customerCaseOutcomeSummary(outcome: CustomerCaseOutcomeInput["outcome"]) {
  switch (outcome) {
    case "won":
      return "Gewonnen / operativ abgeschlossen";
    case "lost":
      return "Verloren / kein weiterer Follow-up";
    case "callback":
      return "Rückruf-Fall gesetzt";
    case "vacation":
      return "Urlaubs-/später-Fall gesetzt";
    case "do_not_contact":
      return "Do-not-contact gesetzt";
    default:
      return "Fallausgang gesetzt";
  }
}

export async function applyCustomerCaseOutcome(
  requestId: string,
  input: CustomerCaseOutcomeInput,
  actor?: UpdateActor,
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const normalizedReason = trimNullable(input.reason) || null;
  const linkedActions: string[] = [];
  let targetIso: string | null = null;

  if (input.outcome === "won") {
    try {
      await pausePendingCustomerFollowups(
        normalizedRequestId,
        actor,
        normalizedReason || "Anfrage gewonnen / operativ abgeschlossen.",
      );
      linkedActions.push(CUSTOMER_RECORDS_FOLLOWUP_PAUSE_ACTION);
    } catch (error) {
      if (!(error instanceof QuoteValidationError)) throw error;
    }
    await setCustomerWorkboardState(
      normalizedRequestId,
      {
        state: "handled",
        reason: normalizedReason || "Gewonnen / operativ abgeschlossen.",
      },
      actor,
    );
    linkedActions.push(CUSTOMER_RECORDS_WORKBOARD_HANDLED_ACTION);
  } else if (input.outcome === "lost") {
    try {
      await pausePendingCustomerFollowups(
        normalizedRequestId,
        actor,
        normalizedReason || "Verloren / aktuell kein weiterer Follow-up.",
      );
      linkedActions.push(CUSTOMER_RECORDS_FOLLOWUP_PAUSE_ACTION);
    } catch (error) {
      if (!(error instanceof QuoteValidationError)) throw error;
    }
    await setCustomerWorkboardState(
      normalizedRequestId,
      {
        state: "handled",
        reason: normalizedReason || "Verloren / aktuell kein weiterer Follow-up.",
      },
      actor,
    );
    linkedActions.push(CUSTOMER_RECORDS_WORKBOARD_HANDLED_ACTION);
  } else if (input.outcome === "callback") {
    targetIso = parseFutureIsoDate(input.resumeAt || "");
    await scheduleCustomerCallback(
      normalizedRequestId,
      targetIso,
      actor,
      normalizedReason || "Rückruf vereinbart.",
    );
    linkedActions.push(CUSTOMER_RECORDS_CALLBACK_SCHEDULED_ACTION);
    await setCustomerWorkboardState(
      normalizedRequestId,
      {
        state: "snoozed",
        snoozeUntil: targetIso,
        reason: normalizedReason || "Bis zum Rückruf zurückgestellt.",
      },
      actor,
    );
    linkedActions.push(CUSTOMER_RECORDS_WORKBOARD_SNOOZED_ACTION);
  } else if (input.outcome === "vacation") {
    targetIso = parseFutureIsoDate(input.resumeAt || "");
    try {
      await reschedulePendingCustomerFollowups(
        normalizedRequestId,
        targetIso,
        actor,
        normalizedReason || "Kunde im Urlaub / später erneut ansprechen.",
      );
      linkedActions.push(CUSTOMER_RECORDS_FOLLOWUP_RESCHEDULE_ACTION);
    } catch (error) {
      if (error instanceof QuoteValidationError) {
        await scheduleCustomerCallback(
          normalizedRequestId,
          targetIso,
          actor,
          normalizedReason || "Kunde im Urlaub / später erneut ansprechen.",
        );
        linkedActions.push(CUSTOMER_RECORDS_CALLBACK_SCHEDULED_ACTION);
      } else {
        throw error;
      }
    }
    await setCustomerWorkboardState(
      normalizedRequestId,
      {
        state: "snoozed",
        snoozeUntil: targetIso,
        reason: normalizedReason || "Bis nach Urlaub zurückgestellt.",
      },
      actor,
    );
    linkedActions.push(CUSTOMER_RECORDS_WORKBOARD_SNOOZED_ACTION);
  } else if (input.outcome === "do_not_contact") {
    await blockCustomerContact(
      normalizedRequestId,
      actor,
      normalizedReason || "Kunde möchte keinen weiteren Kontakt.",
    );
    linkedActions.push(CUSTOMER_RECORDS_CONTACT_BLOCK_ACTION);
    await setCustomerWorkboardState(
      normalizedRequestId,
      {
        state: "handled",
        reason: normalizedReason || "Do-not-contact gesetzt.",
      },
      actor,
    );
    linkedActions.push(CUSTOMER_RECORDS_WORKBOARD_HANDLED_ACTION);
  } else {
    throw new QuoteValidationError("Unbekannter Fallausgang.");
  }

  await insertWorkflowAuditLog({
    requestId: normalizedRequestId,
    action: CUSTOMER_RECORDS_CASE_OUTCOME_ACTION,
    status: "success",
    summary: customerCaseOutcomeSummary(input.outcome),
    actor,
    extraMetadata: {
      outcome: input.outcome,
      reason:
        normalizedReason ||
        (input.outcome === "won"
          ? "Anfrage gewonnen / operativ abgeschlossen."
          : input.outcome === "lost"
            ? "Verloren / aktuell kein weiterer Follow-up."
            : input.outcome === "callback"
              ? "Rückruf vereinbart."
              : input.outcome === "vacation"
                ? "Kunde im Urlaub / später erneut ansprechen."
                : "Kunde möchte keinen weiteren Kontakt."),
      resume_at: targetIso,
      linked_actions: linkedActions,
    },
  });

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: linkedActions.length || 1,
  };
}

export async function setCustomerCaseTeamState(
  requestId: string,
  input: CustomerTeamStateInput,
  actor?: UpdateActor,
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const mode = input.mode;
  const ownerName = trimNullable(input.ownerName);
  const handoverNote = trimNullable(input.handoverNote);

  if (mode === "assign" && !ownerName) {
    throw new QuoteValidationError("Bitte einen Owner-Namen angeben.");
  }

  if (mode === "handover" && !ownerName && !handoverNote) {
    throw new QuoteValidationError("Bitte mindestens Zielperson oder Handover-Hinweis angeben.");
  }

  await insertWorkflowAuditLog({
    requestId: normalizedRequestId,
    action: CUSTOMER_RECORDS_TEAM_STATE_ACTION,
    status: "success",
    summary:
      mode === "assign"
        ? `Fall übernommen${ownerName ? `: ${ownerName}` : ""}`
        : mode === "handover"
          ? `Handover gesetzt${ownerName ? `: ${ownerName}` : ""}`
          : "Team-Status zurückgesetzt",
    actor,
    extraMetadata: {
      team_mode: mode,
      owner_name: mode === "clear" ? null : ownerName,
      handover_note: mode === "handover" ? handoverNote : null,
      operator_name: trimNullable(actor?.operatorName),
      actor_label: actorLabel(actor),
    },
  });

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: 1,
  };
}

function customerCaseFlowSummary(input: CustomerCaseFlowStateInput) {
  if (input.state === "reset") {
    return input.flowLabel ? `Case Flow zurückgesetzt: ${input.flowLabel}` : "Case Flow zurückgesetzt";
  }
  if (input.state === "started") {
    return input.flowLabel ? `Case Flow gestartet: ${input.flowLabel}` : "Case Flow gestartet";
  }
  if (input.state === "step_completed") {
    return input.stepLabel
      ? `Case Flow fortgeführt: ${input.stepLabel}`
      : input.flowLabel
        ? `Case Flow fortgeführt: ${input.flowLabel}`
        : "Case Flow fortgeführt";
  }
  return "Case Flow aktualisiert";
}

function customerSpecialCaseSummary(input: CustomerSpecialCaseInput) {
  const label = specialCaseKindLabel(input.kind) || "Sonderfall";
  return input.urgent ? `Problemfall gemeldet: ${label} (dringend)` : `Problemfall gemeldet: ${label}`;
}

export async function reportCustomerSpecialCase(
  requestId: string,
  input: CustomerSpecialCaseInput,
  actor?: UpdateActor,
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  await fetchCustomerContextByRequestId(normalizedRequestId);

  const kind = normalizeSpecialCaseKind(input.kind);
  if (!kind) {
    throw new QuoteValidationError("Bitte einen gültigen Problemfall-Typ angeben.");
  }

  const note = trimNullable(input.note);
  const ownerName = trimNullable(input.ownerName);
  const dueAt = trimNullable(input.dueAt);
  const urgent = Boolean(input.urgent);

  await insertWorkflowAuditLog({
    requestId: normalizedRequestId,
    action: CUSTOMER_RECORDS_SPECIAL_CASE_ACTION,
    status: "success",
    summary: customerSpecialCaseSummary({ ...input, kind }),
    actor,
    extraMetadata: {
      special_case_status: "open",
      special_case_kind: kind,
      special_case_label: specialCaseKindLabel(kind),
      special_case_note: note,
      special_case_owner_name: ownerName,
      special_case_due_at: dueAt,
      special_case_urgent: urgent,
      operator_name: trimNullable(actor?.operatorName),
      actor_label: actorLabel(actor),
    },
  });

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: 1,
  };
}

export async function resolveCustomerSpecialCase(
  requestId: string,
  resolutionNote: string | null | undefined,
  actor?: UpdateActor,
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  const context = await fetchCustomerContextByRequestId(normalizedRequestId);
  const specialCase = buildSpecialCaseSummary(context);

  if (specialCase.status !== "open" || !specialCase.kind) {
    throw new QuoteValidationError("Für diesen Fall ist aktuell kein offener Problemfall hinterlegt.");
  }

  const note = trimNullable(resolutionNote);

  await insertWorkflowAuditLog({
    requestId: normalizedRequestId,
    action: CUSTOMER_RECORDS_SPECIAL_CASE_RESOLVED_ACTION,
    status: "success",
    summary: `Problemfall erledigt: ${specialCase.label || "Sonderfall"}`,
    actor,
    extraMetadata: {
      special_case_status: "resolved",
      special_case_kind: specialCase.kind,
      special_case_label: specialCase.label,
      special_case_note: specialCase.detail,
      special_case_owner_name: specialCase.ownerName,
      special_case_due_at: specialCase.dueAt,
      resolution_note: note,
      operator_name: trimNullable(actor?.operatorName),
      actor_label: actorLabel(actor),
    },
  });

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: 1,
  };
}

export async function setCustomerCaseFlowState(
  requestId: string,
  input: CustomerCaseFlowStateInput,
  actor?: UpdateActor,
): Promise<CustomerActionResult> {
  const normalizedRequestId = normalizeRequestSearch(requestId);
  await fetchCustomerContextByRequestId(normalizedRequestId);

  const completedKeys = Array.isArray(input.completedKeys)
    ? input.completedKeys.map((value) => String(value)).filter(Boolean)
    : [];
  const totalSteps =
    input.totalSteps === null || input.totalSteps === undefined ? null : Number(input.totalSteps);
  const normalizedTotalSteps = Number.isFinite(totalSteps) ? totalSteps : null;
  const flowState =
    input.state === "reset"
      ? "active"
      : normalizedTotalSteps !== null && completedKeys.length >= normalizedTotalSteps && normalizedTotalSteps > 0
        ? "completed"
        : input.state === "step_completed"
          ? "active"
          : "active";

  await insertWorkflowAuditLog({
    requestId: normalizedRequestId,
    action: CUSTOMER_RECORDS_FLOW_STATE_ACTION,
    status: "success",
    summary: customerCaseFlowSummary(input),
    actor,
    extraMetadata: {
      flow_state: flowState,
      flow_key: trimNullable(input.flowKey),
      flow_label: trimNullable(input.flowLabel),
      step_key: trimNullable(input.stepKey),
      step_label: trimNullable(input.stepLabel),
      completed_keys: completedKeys,
      total_steps: normalizedTotalSteps,
      operator_name: trimNullable(actor?.operatorName),
    },
  });

  return {
    record: mapSearchResult(await fetchCustomerContextByRequestId(normalizedRequestId)),
    count: 1,
  };
}

function formatAuditDate(value: string | null | undefined) {
  if (!value) return "letztem Stand";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(date);
}
