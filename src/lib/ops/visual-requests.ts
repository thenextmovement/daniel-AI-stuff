import { createOpsInternalTask, type OpsInternalTask } from "@/lib/ops/internal-tasks";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type OpsVisualRequestInput = {
  requestId?: string | null;
  offerId?: string | null;
  offerNumber?: string | null;
  trelloCardId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  prompt?: string | null;
  usage?: string | null;
  referenceImageUrl?: string | null;
  count?: number | null;
  operatorName?: string | null;
};

export type OpsVisualRequestResult = {
  mode: "webhook_sent" | "task_created";
  task: OpsInternalTask | null;
  webhookStatus?: number | null;
};

function cleanText(value: unknown, maxLength: number) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : "";
}

function nullableText(value: unknown, maxLength: number) {
  return cleanText(value, maxLength) || null;
}

function normalizedCount(value: unknown) {
  const number = Number(value || 1);
  if (!Number.isFinite(number)) return 1;
  return Math.min(Math.max(Math.trunc(number), 1), 4);
}

function getVisualWebhookUrl() {
  return String(process.env.OPS_VISUAL_REQUEST_WEBHOOK_URL || "").trim();
}

function getVisualWebhookToken() {
  return String(process.env.OPS_VISUAL_REQUEST_WEBHOOK_TOKEN || "").trim();
}

function visualTaskTitle(input: OpsVisualRequestInput) {
  const offerLabel = cleanText(input.offerNumber, 80) || cleanText(input.offerId, 80);
  const customerLabel = cleanText(input.customerName, 80) || cleanText(input.customerEmail, 80);
  if (offerLabel && customerLabel) return `Visualisierung fuer ${offerLabel} - ${customerLabel}`;
  if (offerLabel) return `Visualisierung fuer ${offerLabel}`;
  if (customerLabel) return `Visualisierung fuer ${customerLabel}`;
  return "Visualisierung erstellen";
}

function visualTaskDescription(input: OpsVisualRequestInput, count: number) {
  const lines = [
    "Visualisierung aus Customer Records angefordert.",
    "",
    `Prompt: ${cleanText(input.prompt, 3000)}`,
    `Anzahl: ${count}`,
    input.usage ? `Usage/Einsatz: ${cleanText(input.usage, 500)}` : null,
    input.referenceImageUrl ? `Referenzbild: ${cleanText(input.referenceImageUrl, 1000)}` : null,
    input.offerNumber ? `Angebot: ${cleanText(input.offerNumber, 120)}` : null,
    input.offerId ? `Offer-ID: ${cleanText(input.offerId, 160)}` : null,
    input.requestId ? `Request-ID: ${cleanText(input.requestId, 160)}` : null,
    input.trelloCardId ? `Trello Card ID: ${cleanText(input.trelloCardId, 160)}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

async function postVisualWebhook(input: OpsVisualRequestInput, count: number) {
  const webhookUrl = getVisualWebhookUrl();
  if (!webhookUrl) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const token = getVisualWebhookToken();
    const response = await fetch(webhookUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        source: "neontrip_ops_customer_records",
        requestId: nullableText(input.requestId, 160),
        offerId: nullableText(input.offerId, 160),
        offerNumber: nullableText(input.offerNumber, 120),
        trelloCardId: nullableText(input.trelloCardId, 160),
        customerName: nullableText(input.customerName, 240),
        customerEmail: nullableText(input.customerEmail, 240),
        prompt: cleanText(input.prompt, 3000),
        usage: nullableText(input.usage, 500),
        referenceImageUrl: nullableText(input.referenceImageUrl, 1000),
        count,
        operatorName: nullableText(input.operatorName, 120),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new QuoteValidationError(
        `Visual-Webhook antwortete mit ${response.status}.`,
        [body.slice(0, 300) || "Bitte n8n/Generator-Workflow pruefen."],
        502,
      );
    }

    return response.status;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestOpsVisual(input: OpsVisualRequestInput): Promise<OpsVisualRequestResult> {
  const prompt = cleanText(input.prompt, 3000);
  if (prompt.length < 12) {
    throw new QuoteValidationError("Visualisierung braucht einen konkreten Prompt.", ["Bitte Motiv, Stil, Einsatzort oder Aenderungswunsch beschreiben."], 422);
  }

  const count = normalizedCount(input.count);
  const webhookStatus = await postVisualWebhook({ ...input, prompt }, count);
  if (webhookStatus) {
    return { mode: "webhook_sent", task: null, webhookStatus };
  }

  const task = await createOpsInternalTask(
    {
      title: visualTaskTitle(input),
      description: visualTaskDescription({ ...input, prompt }, count),
      status: "open",
      priority: "high",
      category: "offer",
      assigneeLabel: nullableText(input.operatorName, 120),
      requestId: nullableText(input.requestId, 120),
      customerName: nullableText(input.customerName, 240),
      customerEmail: nullableText(input.customerEmail, 240),
      trelloCardId: nullableText(input.trelloCardId, 120),
      sourceApp: "customer_records_visual_request",
      sourceRef: nullableText(input.offerId, 160) || nullableText(input.requestId, 160),
      metadata: {
        offer_id: nullableText(input.offerId, 160),
        offer_number: nullableText(input.offerNumber, 120),
        prompt,
        usage: nullableText(input.usage, 500),
        reference_image_url: nullableText(input.referenceImageUrl, 1000),
        count,
        webhook_configured: false,
      },
    },
    { operatorName: input.operatorName || null },
  );

  return { mode: "task_created", task, webhookStatus: null };
}
