import { supabaseRpc } from "@/lib/quotes/supabase-rest";

export type EmailAgentDecisionGate = {
  passed: boolean;
  evaluated_count: number;
  unsafe_no_reply_count: number;
  actionable_recall: number;
  no_reply_precision: number;
  routing_accuracy: number;
  exact_accuracy: number;
  run_id: string | null;
  created_at: string | null;
};

export type EmailAgentDraftQualityGate = {
  status: "observing" | "passed" | "blocked";
  passed: boolean;
  current_version: string;
  current_samples: number;
  minimum_samples: number;
  safety_correction_count: number;
  safety_correction_share: number;
  manual_rewrite_count: number;
  manual_rewrite_share: number;
  median_edit_ratio: number;
  thresholds: {
    max_safety_correction_share: number;
    max_manual_rewrite_share: number;
    max_median_edit_ratio: number;
  };
};

export type EmailAgentRolloutGate = {
  version: "email-agent-rollout-gate-v1";
  requested_stage: "shadow" | "review_only" | "routing_gate";
  effective_stage: "shadow" | "review_only" | "routing_gate";
  active_evaluation_version: string | null;
  decision_gate: EmailAgentDecisionGate;
  draft_quality_gate: EmailAgentDraftQualityGate;
  historical_feedback: {
    samples: number;
    safety_correction_count: number;
    manual_rewrite_count: number;
    median_edit_ratio: number;
  };
  allow_action_driving_no_reply: boolean;
  create_human_review_drafts: boolean;
  automatic_send_allowed: false;
  human_send_approval_required: true;
  rollout_ready: boolean;
};

export type EmailAgentRetryHealth = {
  version: "email-agent-retry-health-v1";
  due_retry_count: number;
  scheduled_retry_count: number;
  stale_processing_count: number;
  failed_final_count: number;
  oldest_due_at: string | null;
  recovered_24h: number;
  retry_failures_24h: number;
  automatic_send_allowed: false;
  human_approval_required: true;
};

export type EmailAgentLearningQuality = {
  version: "email-agent-learning-quality-v3";
  feedback: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    ignored: number;
    reason_counts: Record<string, number>;
  };
  style_profile: {
    version: "email-style-profile-v3-human-gated";
    eligible: boolean;
    approved_sample_count: number;
    minimum_approved_samples: number;
    recommended_max_words: number | null;
    recommended_max_paragraphs: number | null;
    scope: "category" | "channel" | "global";
  };
  improvement_candidates: {
    pending: number;
    knowledge: number;
    resolver: number;
    policy: number;
    manual_review: number;
    customer_content_stored: false;
  };
  quality_gate_7d: {
    evaluated: number;
    passed: number;
    soft_flagged: number;
  };
  automatic_prompt_rewrite_allowed: false;
  fact_learning_allowed: false;
  automatic_send_allowed: false;
  human_approval_required: true;
};

export type EmailAgentOperationalQuality = EmailAgentRolloutGate & {
  retry_health: EmailAgentRetryHealth;
  learning_quality: EmailAgentLearningQuality;
};

export async function getEmailAgentRolloutGate() {
  const [rollout, retryHealth, learningQuality] = await Promise.all([
    supabaseRpc<EmailAgentRolloutGate>("get_email_agent_rollout_gate_v1"),
    supabaseRpc<EmailAgentRetryHealth>("get_email_agent_retry_health"),
    supabaseRpc<EmailAgentLearningQuality>("get_email_agent_learning_quality_v3"),
  ]);
  return {
    ...rollout,
    retry_health: retryHealth,
    learning_quality: learningQuality,
  } satisfies EmailAgentOperationalQuality;
}
