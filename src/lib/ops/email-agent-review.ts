import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";

export type EmailAgentLearningStatus = "pending" | "approved" | "rejected" | "ignored";
export type EmailAgentReviewPriority = "low" | "normal" | "high";

export type EmailAgentEvidenceCard = {
  version?: string;
  generated_at?: string;
  channel?: string;
  customer_match?: {
    matched?: boolean;
    basis?: string;
    organization?: string | null;
    related_email_count?: number;
    request_count?: number;
  };
  checks?: Record<string, boolean>;
  attachments?: {
    actual?: Array<{
      name?: string;
      content_type?: string;
      readable?: boolean;
      document_type?: string;
    }>;
    claimed_types?: string[];
    missing_claimed?: Array<{ type?: string; label?: string; reason?: string }>;
  };
  commerce?: {
    resolver_version?: string;
    selected_shopify_order?: Record<string, unknown> | null;
    signed_offer?: Record<string, unknown> | null;
    financial_reconciliation?: Record<string, unknown> | null;
    evidence_sources?: unknown[];
  };
  knowledge?: {
    matched_count?: number;
    version_ids?: string[];
  };
  safety?: {
    risk_level?: string | null;
    reply_length_class?: string | null;
    safe_fallback_used?: boolean;
    validation_reasons?: string[];
    possible_prompt_injection?: boolean;
    human_approval_required?: boolean;
  };
};

type EmailAgentReviewRow = {
  log_id: string;
  draft_created_at: string;
  source_message_id: string;
  conversation_id: string | null;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  channel: string | null;
  category: string;
  risk_level: string | null;
  reply_length_class: string | null;
  review_status: string;
  validation_reasons: string[] | null;
  draft_id: string | null;
  draft_body_text: string | null;
  feedback_id: number | null;
  sent_message_id: string | null;
  sent_internet_message_id: string | null;
  sent_body_text: string | null;
  edit_ratio: number | string | null;
  edit_labels: string[] | null;
  change_profile: Record<string, unknown> | null;
  review_priority: EmailAgentReviewPriority | null;
  learning_status: EmailAgentLearningStatus | null;
  human_review_note: string | null;
  human_reviewed_by: string | null;
  human_reviewed_at: string | null;
  collected_at: string | null;
  evidence_card: EmailAgentEvidenceCard | null;
};

export type EmailAgentReviewCase = {
  logId: string;
  draftCreatedAt: string;
  sourceMessageId: string;
  conversationId: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  channel: string;
  category: string;
  riskLevel: string | null;
  replyLengthClass: string | null;
  reviewStatus: string;
  validationReasons: string[];
  draftId: string | null;
  draftBodyText: string | null;
  feedbackId: number | null;
  sentMessageId: string | null;
  sentInternetMessageId: string | null;
  sentBodyText: string | null;
  editRatio: number | null;
  editLabels: string[];
  changeProfile: Record<string, unknown>;
  reviewPriority: EmailAgentReviewPriority | null;
  learningStatus: EmailAgentLearningStatus | null;
  humanReviewNote: string | null;
  humanReviewedBy: string | null;
  humanReviewedAt: string | null;
  collectedAt: string | null;
  evidenceCard: EmailAgentEvidenceCard;
};

export type EmailAgentReviewFilter =
  | "all"
  | "pending"
  | "approved"
  | "rejected"
  | "ignored"
  | "awaiting_send";

function normalizeRow(row: EmailAgentReviewRow): EmailAgentReviewCase {
  const editRatio = row.edit_ratio === null ? null : Number(row.edit_ratio);
  return {
    logId: row.log_id,
    draftCreatedAt: row.draft_created_at,
    sourceMessageId: row.source_message_id,
    conversationId: row.conversation_id,
    fromEmail: row.from_email,
    fromName: row.from_name,
    subject: row.subject,
    channel: row.channel || "external_email",
    category: row.category,
    riskLevel: row.risk_level,
    replyLengthClass: row.reply_length_class,
    reviewStatus: row.review_status,
    validationReasons: Array.isArray(row.validation_reasons) ? row.validation_reasons : [],
    draftId: row.draft_id,
    draftBodyText: row.draft_body_text,
    feedbackId: row.feedback_id,
    sentMessageId: row.sent_message_id,
    sentInternetMessageId: row.sent_internet_message_id,
    sentBodyText: row.sent_body_text,
    editRatio: Number.isFinite(editRatio) ? editRatio : null,
    editLabels: Array.isArray(row.edit_labels) ? row.edit_labels : [],
    changeProfile: row.change_profile || {},
    reviewPriority: row.review_priority,
    learningStatus: row.learning_status,
    humanReviewNote: row.human_review_note,
    humanReviewedBy: row.human_reviewed_by,
    humanReviewedAt: row.human_reviewed_at,
    collectedAt: row.collected_at,
    evidenceCard: row.evidence_card || {},
  };
}

export async function listEmailAgentReviewCases(input: {
  status?: EmailAgentReviewFilter;
  priority?: EmailAgentReviewPriority | "all";
  limit?: number;
} = {}) {
  const status = input.status || "pending";
  const requestedLimit = Number(input.limit);
  const query: Record<string, string | number> = {
    select:
      "log_id,draft_created_at,source_message_id,conversation_id,from_email,from_name,subject,channel,category,risk_level,reply_length_class,review_status,validation_reasons,draft_id,draft_body_text,feedback_id,sent_message_id,sent_internet_message_id,sent_body_text,edit_ratio,edit_labels,change_profile,review_priority,learning_status,human_review_note,human_reviewed_by,human_reviewed_at,collected_at,evidence_card",
    order: "draft_created_at.desc",
    limit: Number.isFinite(requestedLimit) ? Math.max(1, Math.min(250, Math.trunc(requestedLimit))) : 100,
  };

  if (status === "awaiting_send") query.feedback_id = "is.null";
  else if (status !== "all") query.learning_status = `eq.${status}`;
  if (input.priority && input.priority !== "all") query.review_priority = `eq.${input.priority}`;

  const rows = await supabaseRequest<EmailAgentReviewRow[]>("email_agent_review_overview", undefined, query);
  return rows.map(normalizeRow);
}

export async function reviewEmailAgentFeedback(input: {
  feedbackId: number;
  decision: Exclude<EmailAgentLearningStatus, "pending">;
  note?: string | null;
  reviewer?: string | null;
}) {
  return supabaseRpc<{
    updated: boolean;
    feedback_id: number;
    learning_status: EmailAgentLearningStatus;
    human_reviewed_at: string;
  }>("review_email_agent_feedback", {
    p_feedback_id: input.feedbackId,
    p_decision: input.decision,
    p_note: input.note || null,
    p_reviewer: input.reviewer || null,
  });
}
