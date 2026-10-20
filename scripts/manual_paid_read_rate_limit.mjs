// This function is also embedded in the existing n8n completion node.
export function readRateLimitContext(input, meta, now = Date.now()) {
  const error = input?.error;
  const codes = [error?.httpCode, error?.statusCode, error?.status, error?.response?.statusCode]
    .filter(value => value !== undefined && value !== null && value !== "");
  if (!error || !codes.length || codes.some(value => String(value) !== "429") ||
    !meta?._manualPaidReconcile || meta._manualPaidMode !== "canonical" ||
    !/^[0-9]{1,30}$/.test(String(meta.shopifyOrderId || ""))) {
    throw new Error("MANUAL_PAID_READ_FAILURE_REQUIRES_REVIEW");
  }
  const headers = error.response?.headers || error.headers || {};
  const retryAfter = Object.entries(headers).find(([key]) => key.toLowerCase() === "retry-after")?.[1];
  let retryAfterSeconds = 300;
  if (retryAfter !== undefined) {
    const raw = String(retryAfter).trim();
    const seconds = /^[0-9]+$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - now) / 1000);
    if (!Number.isFinite(seconds) || seconds > 900) throw new Error("MANUAL_PAID_READ_BACKOFF_REQUIRES_REVIEW");
    retryAfterSeconds = Math.max(300, seconds);
  }
  return {
    ...meta,
    _manualPaidOutcome: "READ_RETRY_REQUIRED",
    reasonCode: "SHOPIFY_READ_RATE_LIMIT",
    _manualPaidProof: {
      stage: "READ_SHOPIFY_TRANSACTIONS", requestMethod: "GET", httpStatus: 429,
      shopifyOrderId: meta.shopifyOrderId, sideEffectsStarted: false, retryAfterSeconds,
    },
  };
}

// Generate only the bounded patch against a fresh full workflow read.
export function buildReadRateLimitPatch(workflow) {
  if (workflow.id !== "6NZnfGpyfUVikqpf" || !workflow.active ||
    workflow.versionId !== workflow.activeVersionId) throw new Error("MANUAL_PAID_WORKFLOW_DRIFT");
  const read = workflow.nodes.find(node => node.name === "Read Shopify Transactions");
  const completion = workflow.nodes.find(node => node.name === "Prepare Manual Paid Reconciliation Completion");
  const before = "const ctx = $input.first()?.json || {};";
  const outcomes = "'OUTCOME_UNKNOWN','EXECUTION_FAILED'";
  if (read?.type !== "n8n-nodes-base.httpRequest" || read.parameters.method !== "GET" ||
    read.onError || read.continueOnFail || !read.parameters.url.includes("/transactions.json") ||
    completion?.parameters.jsCode.split(before).length !== 2 ||
    completion.parameters.jsCode.split(outcomes).length !== 2 ||
    workflow.connections[read.name]?.main?.length !== 1) throw new Error("MANUAL_PAID_WORKFLOW_DRIFT");
  const code = `${readRateLimitContext.toString()}\n` + completion.parameters.jsCode
    .replace(before, "const input = $input.first()?.json || {};\nconst ctx = input.error ? readRateLimitContext(input, $('Queue and Select Candidate').first().json) : input;")
    .replace(outcomes, outcomes + ",'READ_RETRY_REQUIRED'");
  return [
    { type: "updateNode", nodeId: read.id, updates: { onError: "continueErrorOutput" } },
    { type: "updateNode", nodeId: completion.id, updates: { "parameters.jsCode": code } },
    { type: "addConnection", source: read.name, target: completion.name, sourceIndex: 1, targetIndex: 0 },
  ];
}
