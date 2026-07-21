import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const inventory = JSON.parse(
  await readFile(resolve(here, "production-inventory.generated.json"), "utf8"),
);

const explicitDecisions = {
  TLLSwYTcIRgtinVg: {
    capability: "pandadoc_event_lifecycle",
    classification: "canonical_refactor",
    targetMode: "split_loop_with_bounded_ai_enrichment",
    decision: "split_receiver_error_handler_enrichment_and_customer_projection",
    priority: "critical",
  },
  geeNR1aVW9tZjPuN: {
    capability: "internal_github_control",
    classification: "deactivate",
    targetMode: "inactive_until_owner_allowlist_and_two_step_approval",
    decision: "unsafe_unused_write_agent",
    priority: "critical",
  },
  cqbB8GIwhP2guGIb: {
    capability: "winback_outreach",
    classification: "canonical_replacement_ready",
    targetMode: "database_claim_bounded_ai_draft_human_send",
    decision: "replace_agent_auto_send_with_draft_loop",
    priority: "critical",
  },
  dljSoxks55YNqFbf: {
    capability: "internal_telegram_assistant",
    classification: "deactivate",
    targetMode: "inactive_until_owner_allowlist_read_only_tools_and_approval_wrappers",
    decision: "unsafe_unused_unrestricted_tool_agent",
    priority: "critical",
  },
  btJd34v7PJFVej6G: {
    capability: "missing_design_reminder",
    classification: "canonical_replacement_ready",
    targetMode: "deterministic_database_claim_draft_human_send",
    decision: "remove_agent_and_auto_send",
    priority: "critical",
  },
  "9FoJMH6OUdsi36FB": {
    capability: "quote_video_and_delivery",
    classification: "canonical_refactor",
    targetMode: "event_intake_video_job_worker_delivery_worker",
    decision: "split_oversized_customer_delivery_monolith",
    priority: "critical",
  },
  CS4jhqo9tdd0cPe4: {
    capability: "followup_queue",
    classification: "canonical_refactor",
    targetMode: "claim_loop_reply_classifier_delivery_executor",
    decision: "split_three_trigger_monolith",
    priority: "critical",
  },
  X5etVW0msgSzHMMG: {
    capability: "quote_ready",
    classification: "canonical_refactor",
    targetMode: "event_intake_offer_job_projection",
    decision: "split_two_trigger_trello_authority_monolith",
    priority: "high",
  },
  fcPiGDWq41htB5mV: {
    capability: "unstructured_inquiry",
    classification: "canonical_refactor",
    targetMode: "email_intake_bounded_extraction_human_review_draft",
    decision: "split_two_trigger_ai_communication_workflow",
    priority: "high",
  },
  uRYt9I30bzzVTB2D: {
    capability: "inflatable_supplier_request",
    classification: "canonical_refactor",
    targetMode: "database_recipient_delivery_loop",
    decision: "replace_trello_delivery_authority",
    priority: "high",
  },
  Rmv4Ht895SiIgUOC: {
    capability: "gemini_mockup",
    classification: "legacy_deactivate_after_replay",
    targetMode: "inactive",
    decision: "duplicate_v1_1_variant",
    priority: "high",
  },
  T4mdDxLquLMJ6FMl: {
    capability: "gemini_mockup",
    classification: "canonical_refactor",
    targetMode: "asset_intake_generation_job_projection",
    decision: "split_oversized_v1_2_and_fix_cleanup_credentials",
    priority: "critical",
  },
  "9MHAajzPsdk2Wt2X": {
    capability: "customs_ci",
    classification: "canonical_refactor",
    targetMode: "customs_job_worker_document_projection",
    decision: "split_trello_authority_monolith",
    priority: "high",
  },
  HIFQvcfBKPEK9oSN: {
    capability: "video_generation",
    classification: "canonical_worker_refactor",
    targetMode: "database_video_job_worker",
    decision: "split_generation_from_projection",
    priority: "high",
  },
  ThfkcnArNJ75XnX6: {
    capability: "customs_difference_invoice",
    classification: "canonical_refactor",
    targetMode: "single_trigger_job_loop_plus_manual_adapter",
    decision: "split_three_trigger_invoice_monolith",
    priority: "high",
  },
  Gb01bGXui65eOJCP: {
    capability: "customs_monthly_invoice",
    classification: "canonical_refactor",
    targetMode: "single_trigger_month_job_loop_plus_manual_adapter",
    decision: "split_three_trigger_invoice_monolith",
    priority: "high",
  },
  ESDlD5V0yxFKxF8x: {
    capability: "customs_supplier_invoice",
    classification: "canonical_refactor",
    targetMode: "single_trigger_ci_job_loop_plus_manual_adapter",
    decision: "split_three_trigger_invoice_monolith",
    priority: "high",
  },
  GTcIwaTHdaxdSM3f: {
    capability: "placetel_notes",
    classification: "canonical_refactor",
    targetMode: "call_event_intake_note_worker",
    decision: "split_two_trigger_monolith",
    priority: "medium",
  },
  "7UJW9mgP42m0ulbj": {
    capability: "pandadoc_sent_sync",
    classification: "canonical_refactor",
    targetMode: "pandadoc_event_job_activecampaign_projection",
    decision: "split_oversized_sync_monolith",
    priority: "high",
  },
  FQ7lf36yje4B1eE3: {
    capability: "landingpage_inquiry_intake",
    classification: "canonical_refactor",
    targetMode: "webhook_validation_job_enqueue",
    decision: "split_oversized_intake",
    priority: "high",
  },
  X497QfsvfE2Od0Vj: {
    capability: "customs_month_rebuild",
    classification: "canonical_refactor",
    targetMode: "bounded_month_rebuild_job",
    decision: "split_oversized_rebuild",
    priority: "medium",
  },
  nUrqyTSnGE8j9QT8: {
    capability: "activecampaign_auto_reply",
    classification: "canonical_refactor",
    targetMode: "validated_template_or_human_review_draft_loop",
    decision: "split_customer_communication_boundary",
    priority: "high",
  },
  "2fRdyqdyVDMWwH4O": {
    capability: "qonto_webhook",
    classification: "canonical_refactor",
    targetMode: "webhook_validation_finance_job_projection",
    decision: "split_oversized_finance_intake",
    priority: "high",
  },
};

function inferCapability(name) {
  const value = name.toLowerCase();
  const rules = [
    ["email", "email_operations"],
    ["outlook", "email_operations"],
    ["pandadoc", "pandadoc_operations"],
    ["trello", "trello_projection"],
    ["shopify", "shopify_operations"],
    ["supplier", "supplier_operations"],
    ["liefer", "shipping_operations"],
    ["shipping", "shipping_operations"],
    ["customs", "customs_operations"],
    ["video", "video_generation"],
    ["mockup", "design_generation"],
    ["design", "design_operations"],
    ["quote", "quote_operations"],
    ["angebot", "quote_operations"],
    ["follow-up", "followup_operations"],
    ["activecampaign", "activecampaign_operations"],
    ["ac ", "activecampaign_operations"],
    ["telegram", "internal_telegram"],
    ["qonto", "finance_operations"],
    ["dpd", "shipping_operations"],
    ["placetel", "call_operations"],
  ];
  return rules.find(([needle]) => value.includes(needle))?.[1] || "general_automation";
}

function defaultDecision(workflow) {
  const flags = new Set(workflow.flags || []);
  if (/\b(löschen|loeschen|inactive draft|old|backup|deprecated)\b/i.test(workflow.name)) {
    return {
      capability: inferCapability(workflow.name),
      classification: "deactivation_review",
      targetMode: "inactive_after_dependency_check",
      decision: "active_name_indicates_legacy_or_draft",
      priority: "high",
    };
  }
  if (workflow.triggerCount !== 1) {
    return {
      capability: inferCapability(workflow.name),
      classification: "trigger_split_required",
      targetMode: "canonical_single_trigger_loop_plus_adapters",
      decision: "multiple_or_missing_trigger",
      priority: flags.has("ai_and_customer_communication") ? "high" : "medium",
    };
  }
  if (flags.has("ai_and_customer_communication")) {
    return {
      capability: inferCapability(workflow.name),
      classification: "safety_review_required",
      targetMode: "bounded_ai_proposal_deterministic_gate",
      decision: "ai_and_external_communication",
      priority: "high",
    };
  }
  if (flags.has("trello_source_candidate")) {
    return {
      capability: inferCapability(workflow.name),
      classification: "source_of_truth_review_required",
      targetMode: "database_loop_trello_projection",
      decision: "trello_authority_candidate",
      priority: "high",
    };
  }
  return {
    capability: inferCapability(workflow.name),
    classification: "canonical_keep",
    targetMode: "deterministic_loop_or_adapter",
    decision: "within_current_structural_boundary",
    priority: "normal",
  };
}

const workflows = inventory.workflows.map((workflow) => ({
  id: workflow.id,
  name: workflow.name,
  current: {
    nodeCount: workflow.nodeCount,
    triggerCount: workflow.triggerCount,
    flags: workflow.flags,
  },
  ...(explicitDecisions[workflow.id] || defaultDecision(workflow)),
}));

const manifest = {
  generatedAt: new Date().toISOString(),
  sourceGeneratedAt: inventory.generatedAt,
  scope: "all_active_n8n_workflows",
  counts: {
    total: workflows.length,
    canonicalKeep: workflows.filter((workflow) => workflow.classification === "canonical_keep").length,
    refactorOrReview: workflows.filter((workflow) => workflow.classification !== "canonical_keep").length,
    deactivate: workflows.filter((workflow) => /deactiv/i.test(workflow.classification)).length,
    critical: workflows.filter((workflow) => workflow.priority === "critical").length,
  },
  workflows,
};

await writeFile(
  resolve(here, "capability-manifest.generated.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify(manifest.counts));
