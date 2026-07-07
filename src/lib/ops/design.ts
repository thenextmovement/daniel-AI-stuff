import { createHash } from "node:crypto";
import { attachmentName, isValidMockupAttachment } from "@/lib/quotes/mockups";
import { addTrelloCardAttachment, addTrelloCardComment, deleteTrelloCardAttachment, downloadTrelloAttachment, getTrelloAttachment, getTrelloCard, getTrelloList, renameTrelloCardAttachment, searchTrelloCards } from "@/lib/quotes/trello";
import type { TrelloAttachment } from "@/lib/quotes/types";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { getOfferById, patchOfferById, type OpsOfferItem, type OpsOfferPatchInput, type OpsOfferPatchResult } from "@/lib/ops/offers";
import {
  getCustomerRecordByRequestId,
  listCustomerRecordsByRequestIds,
  parseTrelloCardIdentifier,
  searchCustomerRecords,
  selectReferenceTrelloAttachment,
  type CustomerCrmQuoteSummary,
  type CustomerSearchResult,
} from "@/lib/ops/customer-records";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type DesignAttachmentKind = "mockup" | "reference" | "image" | "video" | "other";

export type DesignAttachment = {
  id: string;
  cardId: string;
  name: string;
  mimeType: string | null;
  url: string | null;
  proxyUrl: string | null;
  kind: DesignAttachmentKind;
  removalEligible: boolean;
};

export type DesignCardSummary = {
  cardId: string;
  cardName: string | null;
  cardUrl: string | null;
  boardId: string | null;
  listId: string | null;
  listName: string | null;
  description: string | null;
  promptBlocks: DesignTrelloPromptBlocks;
  attachments: DesignAttachment[];
};

export type DesignOfferCandidate = {
  id: string;
  label: string;
  status: string | null;
  totalGross: number | null;
  acceptedAt: string | null;
  updatedAt: string | null;
  locked: boolean;
  imageCount: number;
};

export type DesignPromptPreview = {
  title: string;
  prompt: string;
  source: "design_studio_edit_prompt" | "missing_trello_prompt";
  sourceLabel: string;
  videoPrompt: string | null;
  warnings: string[];
};

export type DesignTrelloPromptBlocks = {
  imagePrompt: string | null;
  videoPrompt: string | null;
  hasMarkers: boolean;
};

export type DesignWorkspace = {
  query: string;
  record: Pick<
    CustomerSearchResult,
    "requestId" | "displayName" | "email" | "phone" | "company" | "request" | "crmQuote"
  > | null;
  cards: DesignCardSummary[];
  primaryCard: DesignCardSummary | null;
  offerCandidates: DesignOfferCandidate[];
  promptPreview: DesignPromptPreview;
  stats: {
    totalAttachments: number;
    mockups: number;
    removable: number;
    offers: number;
  };
};

export type DesignJobDraft = {
  id: string;
  jobKey: string;
  status: string;
  requestId: string | null;
  trelloCardId: string | null;
  offerId: string | null;
  promptVersion: {
    id: string;
    versionNumber: number;
    title: string;
    promptHash: string;
  };
};

export type DesignRemovalPlan = {
  id: string;
  backupKey: string;
  status: string;
  trelloCardId: string;
  trelloCardUrl: string | null;
  selectedAttachmentCount: number;
};

export type DesignAssetSummary = {
  id: string;
  assetKey: string;
  jobId: string | null;
  status: string;
  publicUrl: string | null;
  trelloAttachmentId: string | null;
  name: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
};

export type DesignJobSummary = {
  id: string;
  jobKey: string;
  status: string;
  requestId: string | null;
  trelloCardId: string | null;
  offerId: string | null;
  sourceQuery: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  assets?: DesignAssetSummary[];
};

export type DesignTrelloAttachResult = {
  job: DesignJobSummary;
  asset: DesignAssetSummary;
  trelloAttachmentId: string;
  trelloAttachmentUrl: string | null;
  replacedAttachmentId?: string | null;
  archivedAttachmentName?: string | null;
};

export type DesignRemovalApplyResult = {
  removalPlan: DesignRemovalPlan;
  deleted: number;
  failed: Array<{ attachmentId: string; error: string }>;
};

export type DesignOfferLinkResult = {
  status: string;
  offerId: string;
  assetId: string;
  dryRun: boolean;
  crmQuoteImage?: DesignCrmQuoteImageLink | null;
  offerPatch?: OpsOfferPatchResult | null;
};

export type DesignCrmQuoteImageLink = {
  id: string;
  versionId: string;
  itemIndex: number;
  imageIndex: number;
  url: string;
};

export type DesignGenerateResult = {
  job: DesignJobSummary;
  asset: DesignAssetSummary | null;
  model: string;
  storagePath: string | null;
};

export type DesignWorkerJob = DesignJobSummary & {
  promptVersion: {
    id: string;
    versionNumber: number;
    title: string;
    promptText: string;
    promptHash: string;
  };
};

type DesignJobRow = {
  id: string;
  job_key: string;
  request_id: string | null;
  trello_card_id: string | null;
  trello_card_url: string | null;
  offer_id: string | null;
  source_query: string | null;
  status: string;
  prompt_version_id: string | null;
  operator_name: string | null;
  created_by: string | null;
  error_message: string | null;
  selected_asset_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type DesignPromptVersionRow = {
  id: string;
  job_id: string;
  version_number: number;
  prompt_title: string;
  prompt_text: string;
  prompt_hash: string;
  source: string;
  edited_by: string | null;
  created_at: string;
};

type DesignAssetRow = {
  id: string;
  asset_key: string;
  job_id: string;
  prompt_version_id: string | null;
  request_id: string | null;
  trello_card_id: string | null;
  source: string;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string | null;
  trello_attachment_id: string | null;
  name: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type DesignOfferAssetLinkRow = {
  id: string;
  link_key: string;
  asset_id: string;
  offer_id: string;
  offer_item_id: string | null;
  offer_version_id: string | null;
  design_group_key: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type CrmQuoteVersionRow = {
  id: string;
  quote_id: string;
  version_number: number;
  created_at: string | null;
};

type CrmQuoteVersionImageRow = {
  id: string;
  version_id: string;
  item_index: number;
  image_index: number;
  original_url: string;
  copied_url: string | null;
  versioned_url: string | null;
  copy_status: string | null;
  created_at: string | null;
};

type DesignRemovalBackupRow = {
  id: string;
  backup_key: string;
  trello_card_id: string;
  trello_card_url: string | null;
  status: string;
  selected_attachment_count: number;
  attachments?: Array<{
    id?: string;
    card_id?: string;
    name?: string;
    mime_type?: string | null;
    url?: string | null;
    kind?: string;
  }> | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type DesignReferenceAttachment = {
  cardId: string;
  attachmentId: string;
  name: string;
  kind: DesignAttachmentKind;
};

type DesignReferenceAsset = {
  assetId: string;
  publicUrl: string;
  name: string;
  mimeType: string | null;
};

const DESIGN_JOB_SELECT =
  "id,job_key,request_id,trello_card_id,trello_card_url,offer_id,source_query,status,prompt_version_id,selected_asset_id,operator_name,created_by,error_message,metadata,created_at,updated_at";
const DESIGN_PROMPT_VERSION_SELECT = "id,job_id,version_number,prompt_title,prompt_text,prompt_hash,source,edited_by,created_at";
const DESIGN_ASSET_SELECT =
  "id,asset_key,job_id,prompt_version_id,request_id,trello_card_id,source,status,storage_bucket,storage_path,public_url,trello_attachment_id,name,mime_type,width,height,metadata,created_at,updated_at";

function trimNullable(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function extractTrelloMockupPromptBlocks(description: string | null | undefined): DesignTrelloPromptBlocks {
  const text = String(description || "");
  const imageMatch = text.match(/#startprompt([\s\S]*?)#endprompt/i);
  const videoMatch = text.match(/#startvideoprompt([\s\S]*?)#endvideoprompt/i);

  return {
    imagePrompt: trimNullable(imageMatch?.[1]),
    videoPrompt: trimNullable(videoMatch?.[1]),
    hasMarkers: Boolean(imageMatch || videoMatch),
  };
}

function isTrelloObjectId(value: string) {
  return /^[0-9a-f]{24}$/i.test(value);
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => trimNullable(value)).filter((value): value is string => Boolean(value))));
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableActionKey(prefix: string, parts: Array<string | null | undefined>) {
  return `${prefix}:${stableHash(parts.map((part) => trimNullable(part) || "-").join("|")).slice(0, 32)}`;
}

export function archiveMockupAttachmentName(name: string) {
  const normalized = String(name || "").trim();
  if (!normalized) return "alte_Vorschaubilder.png";
  const archived = normalized
    .replace(/^mockup/i, "alte_Vorschaubilder")
    .replace(/^moc[\s_-]*ab/i, "alte_Vorschaubilder")
    .replace(/^mocab/i, "alte_Vorschaubilder");
  if (archived !== normalized) return archived;
  return `alte_Vorschaubilder_${normalized}`;
}

function slugPathPart(value: unknown, fallback: string) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function supabaseProjectUrl() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!url) throw new QuoteValidationError("SUPABASE_URL fehlt.");
  return url;
}

function supabaseServiceRoleKey() {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) throw new QuoteValidationError("SUPABASE_SERVICE_ROLE_KEY fehlt.");
  return key;
}

function designAssetBucket() {
  return String(process.env.DESIGN_ASSET_BUCKET || "design-assets").trim() || "design-assets";
}

function openAiImageApiKey() {
  const key = String(process.env.OPS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new QuoteValidationError("OPS_OPENAI_API_KEY oder OPENAI_API_KEY fehlt fuer direkte Design-Generierung.", [], 503);
  return key;
}

function requestIdCandidate(value: string) {
  const direct = value.trim();
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{5,80}$/.test(direct) && !direct.includes("trello.com")) return direct;
  const requestMatch = direct.match(/(?:request[_-]?id|requestId|rid)[=:\/\s]+([A-Za-z0-9_-]{6,80})/i);
  return requestMatch?.[1] || null;
}

function classifyAttachment(attachment: TrelloAttachment, referenceId: string | null): DesignAttachmentKind {
  if (referenceId && attachment.id === referenceId) return "reference";
  if (isValidMockupAttachment(attachment)) return "mockup";
  const name = attachmentName(attachment);
  if ((attachment.mimeType && /^image\//i.test(attachment.mimeType)) || /\.(png|jpe?g|webp|avif)$/i.test(name)) return "image";
  if ((attachment.mimeType && /^video\//i.test(attachment.mimeType)) || /\.(mp4|mov|webm|m4v)$/i.test(name)) return "video";
  return "other";
}

function attachmentProxyUrl(cardId: string, attachmentId: string, kind: DesignAttachmentKind) {
  if (!["mockup", "reference", "image", "video"].includes(kind)) return null;
  const params = new URLSearchParams({ cardId, attachmentId });
  return `/api/ops/customer-records/trello-attachments?${params.toString()}`;
}

async function loadDesignCard(cardId: string, cardUrl?: string | null): Promise<DesignCardSummary> {
  const card = await getTrelloCard(cardId);
  const list = card.idList ? await getTrelloList(card.idList).catch(() => null) : null;
  const reference = selectReferenceTrelloAttachment(card.attachments || []);
  const description = trimNullable(card.desc);
  const attachments = (card.attachments || [])
    .map((attachment) => {
      const kind = classifyAttachment(attachment, reference?.id || null);
      return {
        id: attachment.id,
        cardId: card.id,
        name: attachmentName(attachment) || attachment.id,
        mimeType: trimNullable(attachment.mimeType),
        url: trimNullable(attachment.url),
        proxyUrl: attachmentProxyUrl(card.id, attachment.id, kind),
        kind,
        removalEligible: true,
      } satisfies DesignAttachment;
    })
    .sort((left, right) => {
      const kindOrder: Record<DesignAttachmentKind, number> = { mockup: 0, reference: 1, image: 2, video: 3, other: 4 };
      const kindDiff = kindOrder[left.kind] - kindOrder[right.kind];
      return kindDiff || left.name.localeCompare(right.name, "de", { numeric: true });
    });

  return {
    cardId: card.id,
    cardName: trimNullable(card.name),
    cardUrl: trimNullable(cardUrl) || `https://trello.com/c/${card.id}`,
    boardId: trimNullable(card.idBoard),
    listId: trimNullable(card.idList),
    listName: trimNullable(list?.name),
    description,
    promptBlocks: extractTrelloMockupPromptBlocks(description),
    attachments,
  };
}

function cardIdsFromRecord(record: CustomerSearchResult | null) {
  if (!record) return [];
  return uniqueValues([
    parseTrelloCardIdentifier(record.request?.trelloCardUrl),
    ...(record.trello?.cards || []).map((card) => card.cardId),
  ]);
}

function offerLocked(offer: CustomerCrmQuoteSummary) {
  return Boolean(offer.acceptedAt || ["accepted", "completed", "downloaded"].includes(String(offer.status || "").toLowerCase()));
}

function offerCandidates(record: CustomerSearchResult | null): DesignOfferCandidate[] {
  if (!record?.crmQuote) return [];
  const quote = record.crmQuote;
  return [
    {
      id: quote.id,
      label: quote.quoteNumber || quote.projectNumber || quote.id,
      status: quote.status,
      totalGross: quote.customerLiveTotal ?? quote.totalGross,
      acceptedAt: quote.acceptedAt,
      updatedAt: quote.updatedAt,
      locked: offerLocked(quote),
      imageCount: quote.latestVersionImages.length,
    },
  ];
}

function isQuoteReadyLikeList(listName: string | null | undefined) {
  const normalized = String(listName || "").toLowerCase();
  return /quote\s*ready|ready|ki\s*mockup|mockup\s*erstellen|mockup/.test(normalized);
}

function cardPromptPriority(card: DesignCardSummary) {
  if (!card.promptBlocks.imagePrompt) return 0;
  return isQuoteReadyLikeList(card.listName) ? 100 : 80;
}

function selectPrimaryDesignCard(cards: DesignCardSummary[]) {
  return [...cards]
    .sort((left, right) => {
      const promptDiff = cardPromptPriority(right) - cardPromptPriority(left);
      if (promptDiff) return promptDiff;
      const mockupDiff =
        right.attachments.filter((attachment) => attachment.kind === "mockup").length -
        left.attachments.filter((attachment) => attachment.kind === "mockup").length;
      if (mockupDiff) return mockupDiff;
      const mediaDiff =
        right.attachments.filter((attachment) => attachment.kind === "reference" || attachment.kind === "image").length -
        left.attachments.filter((attachment) => attachment.kind === "reference" || attachment.kind === "image").length;
      return mediaDiff;
    })[0] || null;
}

function buildDesignStudioEditPrompt(record: CustomerSearchResult | null, primaryCard: DesignCardSummary | null) {
  if (!primaryCard) return null;
  const request = record?.request || null;
  const hasVisualSource = primaryCard.attachments.some((attachment) => attachment.kind === "mockup" || attachment.kind === "reference" || attachment.kind === "image");
  const cardTitle = trimNullable(primaryCard.cardName);
  if (!hasVisualSource && !cardTitle && !request?.title && !request?.description) return null;

  const lines = [
    "Design-Studio Edit-Prompt fuer ein vorhandenes NEONTRIP Angebotsmockup.",
    "",
    "Quelle:",
    cardTitle ? `- Trello-Karte: ${cardTitle}` : null,
    request?.title ? `- Projekt: ${request.title}` : null,
    request?.size ? `- Groesse: ${request.size}` : null,
    request?.colors?.length ? `- Bestehende Farbangabe: ${request.colors.join(", ")}` : null,
    request?.application ? `- Anwendung: ${request.application}` : null,
    request?.sKategorie || request?.segmentLabel ? `- Kategorie: ${request.sKategorie || request.segmentLabel}` : null,
    hasVisualSource ? `- Vorhandene Trello-Bilder: ${primaryCard.attachments.filter((attachment) => attachment.kind === "mockup" || attachment.kind === "reference" || attachment.kind === "image").length}` : null,
    "",
    "Edit-Regeln:",
    "- Nutze immer das ausgewaehlte vorhandene Bild als visuelle Vorlage.",
    "- Bewahre Text, Logo-/Schriftanmutung, Produktart, Groesse, Perspektive, Hintergrund, Bildausschnitt und Montageart so weit wie moeglich.",
    "- Keine neuen Woerter, Logos, Marken, Preisangaben oder Lieferzusagen erfinden.",
    "- Wenn eine manuelle Aenderung gesetzt ist, nur diesen einen Aspekt sichtbar veraendern.",
    "- Dieser Prompt ersetzt nicht den echten n8n Quote-Ready Produktionsprompt fuer komplette Neugenerierungen.",
    "- Ergebnis ist ein internes Design-Studio-Mockup und muss vor Kundenfreigabe geprueft werden.",
  ].filter((line): line is string => line !== null);

  return lines.join("\n");
}

function buildPromptPreview(record: CustomerSearchResult | null, primaryCard: DesignCardSummary | null): DesignPromptPreview {
  const request = record?.request || null;
  const warnings: string[] = [];
  if (!primaryCard) warnings.push("Keine Trello-Karte geladen. Prompt ist noch nicht generierbar.");
  if (primaryCard?.promptBlocks.imagePrompt || primaryCard?.promptBlocks.videoPrompt) {
    warnings.push("Trello #startprompt/#endprompt wurde ignoriert: dieser Block ist nicht der echte n8n Quote-Ready Produktionsprompt.");
    if (primaryCard.promptBlocks.imagePrompt && !isQuoteReadyLikeList(primaryCard.listName)) {
      warnings.push(`Prompt-Marker gefunden, aber Karte liegt in "${primaryCard.listName || "unbekannter Liste"}" statt Quote Ready/KI-Mockup. Bitte Quelle pruefen.`);
    }
  }

  const editPrompt = buildDesignStudioEditPrompt(record, primaryCard);
  if (editPrompt) {
    return {
      title: request?.title || primaryCard?.cardName || "Design Mockup Prompt",
      prompt: editPrompt,
      source: "design_studio_edit_prompt",
      sourceLabel: "Design-Studio Edit-Prompt",
      videoPrompt: null,
      warnings,
    };
  }

  warnings.push("Kein Design-Studio Prompt generierbar. Bitte Karte mit vorhandenem Mockup, Referenzbild oder Angebotskontext laden.");

  return {
    title: request?.title || primaryCard?.cardName || "Design Mockup Prompt",
    prompt: "",
    source: "missing_trello_prompt",
    sourceLabel: "Kein Design-Studio Prompt gefunden",
    videoPrompt: null,
    warnings,
  };
}

async function findRecord(query: string) {
  const requestId = requestIdCandidate(query);
  if (requestId && !isTrelloObjectId(requestId)) {
    try {
      return await getCustomerRecordByRequestId(requestId, { includeTrello: true });
    } catch {
      // Fall through to broad search.
    }
  }

  const records = await searchCustomerRecords(query);
  if (records[0]) return records[0];

  const trelloCardId = parseTrelloCardIdentifier(query);
  if (trelloCardId && trelloCardId !== query) {
    const trelloRecords = await searchCustomerRecords(trelloCardId).catch(() => []);
    if (trelloRecords[0]) return trelloRecords[0];
  }

  return null;
}

async function cardIdsFromQuery(query: string) {
  const directId = isTrelloObjectId(query) ? query : null;
  const shortLink = parseTrelloCardIdentifier(query);
  if (directId) return [directId];
  if (shortLink) return [shortLink];

  try {
    const matches = await searchTrelloCards(query);
    return matches.map((match) => match.id).slice(0, 3);
  } catch {
    return [];
  }
}

export async function loadDesignWorkspace(query: string): Promise<DesignWorkspace> {
  const normalizedQuery = trimNullable(query);
  if (!normalizedQuery) {
    throw new QuoteValidationError("Suchbegriff ist erforderlich.");
  }

  const record = await findRecord(normalizedQuery);
  const ids = uniqueValues([...(await cardIdsFromQuery(normalizedQuery)), ...cardIdsFromRecord(record)]).slice(0, 6);
  const cards = (
    await Promise.all(
      ids.map(async (cardId) => {
        try {
          return await loadDesignCard(cardId, record?.request?.trelloCardUrl);
        } catch (error) {
          console.warn("design card lookup failed", { cardId, error });
          return null;
        }
      }),
    )
  ).filter((card): card is DesignCardSummary => Boolean(card));

  const primaryCard = selectPrimaryDesignCard(cards);
  const offers = offerCandidates(record);
  const totalAttachments = cards.reduce((sum, card) => sum + card.attachments.length, 0);
  const mockups = cards.reduce((sum, card) => sum + card.attachments.filter((attachment) => attachment.kind === "mockup").length, 0);

  return {
    query: normalizedQuery,
    record: record
      ? {
          requestId: record.requestId,
          displayName: record.displayName,
          email: record.email,
          phone: record.phone,
          company: record.company,
          request: record.request,
          crmQuote: record.crmQuote,
        }
      : null,
    cards,
    primaryCard,
    offerCandidates: offers,
    promptPreview: buildPromptPreview(record, primaryCard),
    stats: {
      totalAttachments,
      mockups,
      removable: totalAttachments,
      offers: offers.length,
    },
  };
}

export async function loadDesignWorkspaceByRequestId(requestId: string): Promise<DesignWorkspace> {
  const [record] = await listCustomerRecordsByRequestIds([requestId], { includeTrello: true });
  if (!record) throw new QuoteValidationError("Kein Fall für diese Request-ID gefunden.");
  return loadDesignWorkspace(record.requestId);
}

export async function createDesignJobDraft(input: {
  idempotencyKey: string;
  query: string;
  promptTitle: string;
  promptText: string;
  operatorName?: string | null;
  offerId?: string | null;
  referenceAttachmentIds?: string[] | null;
  referenceAssetId?: string | null;
}) {
  const idempotencyKey = trimNullable(input.idempotencyKey);
  const promptText = trimNullable(input.promptText);
  const query = trimNullable(input.query);
  if (!idempotencyKey) throw new QuoteValidationError("idempotencyKey ist erforderlich.");
  if (!query) throw new QuoteValidationError("Suchbegriff ist erforderlich.");
  if (!promptText || promptText.length < 40) throw new QuoteValidationError("Prompt ist zu kurz.");

  const existing = await supabaseRequest<DesignJobRow[]>("design_jobs", undefined, {
    select: DESIGN_JOB_SELECT,
    job_key: `eq.${idempotencyKey}`,
    limit: 1,
  });
  if (existing[0]?.prompt_version_id) {
    const versions = await supabaseRequest<DesignPromptVersionRow[]>("design_prompt_versions", undefined, {
      select: DESIGN_PROMPT_VERSION_SELECT,
      id: `eq.${existing[0].prompt_version_id}`,
      limit: 1,
    });
    const version = versions[0];
    if (!version) throw new QuoteValidationError("Bestehender Design-Job ist unvollständig.");
    return mapDesignJobDraft(existing[0], version);
  }

  const workspace = await loadDesignWorkspace(query);
  const primaryCard = workspace.primaryCard;
  const requestId = workspace.record?.requestId || null;
  const operatorName = trimNullable(input.operatorName);
  const offerId = trimNullable(input.offerId);
  const promptTitle = trimNullable(input.promptTitle) || workspace.promptPreview.title;
  const promptHash = stableHash(promptText);
  const referenceIds = uniqueValues(input.referenceAttachmentIds || []).slice(0, 4);
  const referenceAttachments: DesignReferenceAttachment[] = workspace.cards.flatMap((card) =>
    card.attachments
      .filter((attachment) => referenceIds.includes(attachment.id) && ["mockup", "reference", "image"].includes(attachment.kind))
      .map((attachment) => ({
        cardId: card.cardId,
        attachmentId: attachment.id,
        name: attachment.name,
        kind: attachment.kind,
      })),
  );
  const referenceAssetId = trimNullable(input.referenceAssetId);
  const referenceAssets: DesignReferenceAsset[] = [];
  if (referenceAssetId) {
    const asset = await getDesignAsset(referenceAssetId);
    if (!asset.public_url) throw new QuoteValidationError("Ausgewaehltes generiertes Asset hat keine oeffentliche Bild-URL.");
    referenceAssets.push({
      assetId: asset.id,
      publicUrl: asset.public_url,
      name: asset.name || asset.id,
      mimeType: asset.mime_type,
    });
  }
  const referenceCard = referenceAttachments[0]
    ? workspace.cards.find((card) => card.cardId === referenceAttachments[0]?.cardId) || null
    : null;
  const jobCard = referenceCard || primaryCard;

  const jobs = await supabaseRequest<DesignJobRow[]>("design_jobs", {
    method: "POST",
    body: JSON.stringify({
      job_key: idempotencyKey,
      request_id: requestId,
      trello_card_id: jobCard?.cardId || null,
      trello_card_url: jobCard?.cardUrl || null,
      offer_id: offerId,
      source_query: query,
      status: "draft",
      operator_name: operatorName,
      created_by: operatorName,
      metadata: {
        source: "ops_design_ui",
        attachment_count: workspace.stats.totalAttachments,
        mockup_count: workspace.stats.mockups,
        reference_attachments: referenceAttachments,
        reference_assets: referenceAssets,
      },
    }),
    headers: { Prefer: "return=representation" },
  });
  const job = jobs[0];
  if (!job) throw new QuoteValidationError("Design-Job konnte nicht erstellt werden.");

  const versions = await supabaseRequest<DesignPromptVersionRow[]>("design_prompt_versions", {
    method: "POST",
    body: JSON.stringify({
      job_id: job.id,
      version_number: 1,
      prompt_title: promptTitle,
      prompt_text: promptText,
      prompt_hash: promptHash,
      source: "manual",
      edited_by: operatorName,
      metadata: {
        source: "ops_design_ui",
        warnings: workspace.promptPreview.warnings,
        reference_attachment_count: referenceAttachments.length,
        reference_asset_count: referenceAssets.length,
      },
    }),
    headers: { Prefer: "return=representation" },
  });
  const promptVersion = versions[0];
  if (!promptVersion) throw new QuoteValidationError("Prompt-Version konnte nicht erstellt werden.");

  const updatedJobs = await supabaseRequest<DesignJobRow[]>(
    "design_jobs",
    {
      method: "PATCH",
      body: JSON.stringify({
        prompt_version_id: promptVersion.id,
        updated_at: new Date().toISOString(),
      }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${job.id}` },
  );

  return mapDesignJobDraft(updatedJobs[0] || { ...job, prompt_version_id: promptVersion.id }, promptVersion);
}

async function getDesignJob(jobId: string) {
  const normalizedJobId = trimNullable(jobId);
  if (!normalizedJobId) throw new QuoteValidationError("Design-Job ist erforderlich.");
  const jobs = await supabaseRequest<DesignJobRow[]>("design_jobs", undefined, {
    select: DESIGN_JOB_SELECT,
    id: `eq.${normalizedJobId}`,
    limit: 1,
  });
  const job = jobs[0];
  if (!job) throw new QuoteValidationError("Design-Job wurde nicht gefunden.", ["Design-Job wurde nicht gefunden."], 404);
  return job;
}

async function getPromptVersion(promptVersionId: string | null) {
  if (!promptVersionId) throw new QuoteValidationError("Design-Job hat noch keine Prompt-Version.");
  const versions = await supabaseRequest<DesignPromptVersionRow[]>("design_prompt_versions", undefined, {
    select: DESIGN_PROMPT_VERSION_SELECT,
    id: `eq.${promptVersionId}`,
    limit: 1,
  });
  const version = versions[0];
  if (!version) throw new QuoteValidationError("Prompt-Version wurde nicht gefunden.", ["Prompt-Version wurde nicht gefunden."], 404);
  return version;
}

async function getOrCreateDraftAsset(job: DesignJobRow, promptVersion: DesignPromptVersionRow, operatorName: string | null) {
  const assetKey = stableActionKey("design-asset", [job.id, promptVersion.id, "primary"]);
  const existing = await supabaseRequest<DesignAssetRow[]>("design_assets", undefined, {
    select: DESIGN_ASSET_SELECT,
    asset_key: `eq.${assetKey}`,
    limit: 1,
  });
  if (existing[0]) return existing[0];

  const rows = await supabaseRequest<DesignAssetRow[]>("design_assets", {
    method: "POST",
    body: JSON.stringify({
      asset_key: assetKey,
      job_id: job.id,
      prompt_version_id: promptVersion.id,
      request_id: job.request_id,
      trello_card_id: job.trello_card_id,
      source: "generated",
      status: "draft",
      name: promptVersion.prompt_title || "Design Mockup",
      metadata: {
        source: "ops_design_ui",
        queued_by: operatorName,
        prompt_hash: promptVersion.prompt_hash,
      },
    }),
    headers: { Prefer: "return=representation" },
  });
  const asset = rows[0];
  if (!asset) throw new QuoteValidationError("Design-Asset konnte nicht vorbereitet werden.");
  return asset;
}

async function getOrCreateOfferAssetLink(input: {
  asset: DesignAssetRow;
  offerId: string;
  requestId: string | null;
  trelloCardId: string | null;
  operatorName: string | null;
}) {
  const linkKey = stableActionKey("design-offer-link", [input.asset.id, input.offerId]);
  const existing = await supabaseRequest<DesignOfferAssetLinkRow[]>("design_offer_asset_links", undefined, {
    select: "id,link_key,asset_id,offer_id,offer_item_id,offer_version_id,design_group_key,status,metadata,created_at,updated_at",
    link_key: `eq.${linkKey}`,
    limit: 1,
  });
  if (existing[0]) return existing[0];

  const rows = await supabaseRequest<DesignOfferAssetLinkRow[]>("design_offer_asset_links", {
    method: "POST",
    body: JSON.stringify({
      link_key: linkKey,
      asset_id: input.asset.id,
      offer_id: input.offerId,
      design_group_key: input.trelloCardId || input.requestId || input.asset.id,
      status: "needs_price_review",
      reviewed_by: input.operatorName,
      reviewed_at: input.operatorName ? new Date().toISOString() : null,
      price_context: {
        source: "ops_design_ui",
        rule: "manual_design_link_requires_price_review",
      },
      metadata: {
        request_id: input.requestId,
        trello_card_id: input.trelloCardId,
      },
    }),
    headers: { Prefer: "return=representation" },
  });
  const link = rows[0];
  if (!link) throw new QuoteValidationError("Angebotszuordnung konnte nicht vorbereitet werden.");
  return link;
}

function offerItemIndex(
  offer: Awaited<ReturnType<typeof getOfferById>>,
  offerItemId: string | null,
  linkedItemTitle: string | null,
) {
  const items = [...offer.items].sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, "de"));
  const directIndex = offerItemId ? items.findIndex((item) => item.id === offerItemId) : -1;
  if (directIndex >= 0) return directIndex;

  const titleIndex = linkedItemTitle ? items.findIndex((item) => item.title === linkedItemTitle) : -1;
  if (titleIndex >= 0) return titleIndex;

  return 0;
}

function mapCrmQuoteImageLink(row: CrmQuoteVersionImageRow): DesignCrmQuoteImageLink {
  return {
    id: row.id,
    versionId: row.version_id,
    itemIndex: row.item_index,
    imageIndex: row.image_index,
    url: trimNullable(row.versioned_url) || trimNullable(row.copied_url) || row.original_url,
  };
}

function offerItemPatch(item: OpsOfferItem): NonNullable<OpsOfferPatchInput["items"]>[number] {
  return {
    id: item.id,
    section: item.section || "LED-Leuchtschild",
    title: item.title,
    description: item.description || null,
    quantity: item.quantity,
    unitPriceNet: item.unitPriceNet,
    listPriceNet: item.listPriceNet,
    discountLabel: item.discountLabel || null,
    selectable: item.selectable,
    selectedByDefault: item.selectedByDefault,
    quantityEditable: item.quantityEditable,
    minQuantity: item.minQuantity,
    maxQuantity: item.maxQuantity,
    sortOrder: item.sortOrder,
  };
}

function upsertLightColorLine(description: string | null | undefined, lightColorLabel: string) {
  const lines = String(description || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const nextLine = `Leuchtfarbe: ${lightColorLabel}`;
  const index = lines.findIndex((line) => /^leuchtfarbe\s*:/i.test(line) || /^farbe\s*:/i.test(line));
  if (index >= 0) {
    lines[index] = nextLine;
  } else {
    lines.unshift(nextLine);
  }
  return lines.join("\n");
}

async function latestCrmQuoteVersion(offerId: string) {
  const versions = await supabaseRequest<CrmQuoteVersionRow[]>("crm_quote_versions", undefined, {
    select: "id,quote_id,version_number,created_at",
    quote_id: `eq.${offerId}`,
    order: "version_number.desc,created_at.desc",
    limit: 1,
  });
  return versions[0] || null;
}

async function getOrCreateCrmQuoteVersionImage(input: {
  offerId: string;
  asset: DesignAssetRow;
  itemIndex: number;
}) {
  const publicUrl = trimNullable(input.asset.public_url);
  if (!publicUrl) throw new QuoteValidationError("Design-Asset hat keine oeffentliche URL fuer die Angebotsanreicherung.");

  const version = await latestCrmQuoteVersion(input.offerId);
  if (!version) throw new QuoteValidationError("Keine CRM-Angebotsversion fuer die Design-Anreicherung gefunden.");

  const existing = await supabaseRequest<CrmQuoteVersionImageRow[]>("crm_quote_version_images", undefined, {
    select: "id,version_id,item_index,image_index,original_url,copied_url,versioned_url,copy_status,created_at",
    version_id: `eq.${version.id}`,
    original_url: `eq.${publicUrl}`,
    limit: 1,
  });
  if (existing[0]) return mapCrmQuoteImageLink(existing[0]);

  const latestForItem = await supabaseRequest<CrmQuoteVersionImageRow[]>("crm_quote_version_images", undefined, {
    select: "id,version_id,item_index,image_index,original_url,copied_url,versioned_url,copy_status,created_at",
    version_id: `eq.${version.id}`,
    item_index: `eq.${input.itemIndex}`,
    order: "image_index.desc",
    limit: 1,
  });
  const nextImageIndex = Math.max(0, Number(latestForItem[0]?.image_index ?? -1) + 1);

  const rows = await supabaseRequest<CrmQuoteVersionImageRow[]>("crm_quote_version_images", {
    method: "POST",
    body: JSON.stringify({
      version_id: version.id,
      item_index: input.itemIndex,
      image_index: nextImageIndex,
      original_url: publicUrl,
      copied_url: publicUrl,
      versioned_url: publicUrl,
      copy_status: "done",
    }),
    headers: { Prefer: "return=representation" },
  });
  const row = rows[0];
  if (!row) throw new QuoteValidationError("Design-Bild konnte nicht in der CRM-Angebotsversion gespeichert werden.");
  return mapCrmQuoteImageLink(row);
}

export async function queueDesignJob(input: {
  jobId: string;
  operatorName?: string | null;
  offerId?: string | null;
}) {
  const operatorName = trimNullable(input.operatorName);
  const offerId = trimNullable(input.offerId);
  const job = await getDesignJob(input.jobId);
  const promptVersion = await getPromptVersion(job.prompt_version_id);

  if (["generated", "attached_to_trello", "linked_to_offer"].includes(job.status)) {
    throw new QuoteValidationError("Design-Job ist bereits verarbeitet.");
  }

  const asset = await getOrCreateDraftAsset(job, promptVersion, operatorName);
  if (offerId || job.offer_id) {
    await getOrCreateOfferAssetLink({
      asset,
      offerId: offerId || job.offer_id || "",
      requestId: job.request_id,
      trelloCardId: job.trello_card_id,
      operatorName,
    });
  }

  const updated = await supabaseRequest<DesignJobRow[]>(
    "design_jobs",
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "queued",
        offer_id: offerId || job.offer_id,
        selected_asset_id: asset.id,
        updated_at: new Date().toISOString(),
        metadata: {
          source: "ops_design_ui",
          queued_by: operatorName,
          queued_without_side_effects: true,
        },
      }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${job.id}` },
  );

  return mapDesignJobDraft(updated[0] || { ...job, status: "queued", selected_asset_id: asset.id }, promptVersion);
}

export async function prepareDesignRemovalPlan(input: {
  idempotencyKey: string;
  query: string;
  attachmentIds: string[];
  operatorName?: string | null;
  reason?: string | null;
}): Promise<DesignRemovalPlan> {
  const idempotencyKey = trimNullable(input.idempotencyKey);
  const query = trimNullable(input.query);
  const operatorName = trimNullable(input.operatorName);
  const selectedIds = uniqueValues(input.attachmentIds || []);
  if (!idempotencyKey) throw new QuoteValidationError("idempotencyKey ist erforderlich.");
  if (!query) throw new QuoteValidationError("Suchbegriff ist erforderlich.");
  if (!selectedIds.length) throw new QuoteValidationError("Mindestens ein Anhang muss ausgewählt werden.");

  const existing = await supabaseRequest<DesignRemovalBackupRow[]>("design_trello_removal_backups", undefined, {
    select: "id,backup_key,trello_card_id,trello_card_url,status,selected_attachment_count,created_at,updated_at",
    backup_key: `eq.${idempotencyKey}`,
    limit: 1,
  });
  if (existing[0]) return mapRemovalPlan(existing[0]);

  const workspace = await loadDesignWorkspace(query);
  const selected = workspace.cards.flatMap((card) =>
    card.attachments
      .filter((attachment) => selectedIds.includes(attachment.id) && attachment.removalEligible)
      .map((attachment) => ({ card, attachment })),
  );
  if (!selected.length) throw new QuoteValidationError("Keine entfernbaren Anhänge gefunden.");

  const cardIds = uniqueValues(selected.map((item) => item.card.cardId));
  if (cardIds.length !== 1) throw new QuoteValidationError("Bulk-Removal ist pro Trello-Karte vorzubereiten.");

  const primaryCard = selected[0].card;
  const rows = await supabaseRequest<DesignRemovalBackupRow[]>("design_trello_removal_backups", {
    method: "POST",
    body: JSON.stringify({
      backup_key: idempotencyKey,
      trello_card_id: primaryCard.cardId,
      trello_card_url: primaryCard.cardUrl,
      operator_name: operatorName,
      reason: trimNullable(input.reason) || "ops_design_bulk_removal",
      status: "prepared",
      selected_attachment_count: selected.length,
      attachments: selected.map(({ attachment }) => ({
        id: attachment.id,
        card_id: attachment.cardId,
        name: attachment.name,
        mime_type: attachment.mimeType,
        url: attachment.url,
        kind: attachment.kind,
      })),
      metadata: {
        source: "ops_design_ui",
        request_id: workspace.record?.requestId || null,
        query: workspace.query,
        prepared_without_delete: true,
      },
    }),
    headers: { Prefer: "return=representation" },
  });
  const backup = rows[0];
  if (!backup) throw new QuoteValidationError("Removal-Backup konnte nicht erstellt werden.");
  return mapRemovalPlan(backup);
}

export async function listDesignJobs(input: {
  status?: string | null;
  limit?: number | null;
} = {}): Promise<DesignJobSummary[]> {
  const status = trimNullable(input.status);
  const limit = Math.max(1, Math.min(Number(input.limit || 20), 50));
  const query: Record<string, string | number | boolean | null> = {
    select: DESIGN_JOB_SELECT,
    order: "updated_at.desc",
    limit,
  };
  if (status && status !== "all") query.status = `eq.${status}`;
  const rows = await supabaseRequest<DesignJobRow[]>("design_jobs", undefined, query);
  const summaries = rows.map(mapDesignJobSummary);
  for (const summary of summaries) {
    summary.assets = await listDesignAssetsForJob(summary.id);
  }
  return summaries;
}

export async function listDesignAssetsForJob(jobId: string): Promise<DesignAssetSummary[]> {
  const normalizedJobId = trimNullable(jobId);
  if (!normalizedJobId) return [];
  const rows = await supabaseRequest<DesignAssetRow[]>("design_assets", undefined, {
    select: DESIGN_ASSET_SELECT,
    job_id: `eq.${normalizedJobId}`,
    order: "created_at.desc",
    limit: 20,
  });
  return rows.map(mapDesignAssetSummary);
}

async function getDesignAsset(assetId: string) {
  const normalizedAssetId = trimNullable(assetId);
  if (!normalizedAssetId) throw new QuoteValidationError("Design-Asset ist erforderlich.");
  const rows = await supabaseRequest<DesignAssetRow[]>("design_assets", undefined, {
    select: DESIGN_ASSET_SELECT,
    id: `eq.${normalizedAssetId}`,
    limit: 1,
  });
  const asset = rows[0];
  if (!asset) throw new QuoteValidationError("Design-Asset wurde nicht gefunden.", ["Design-Asset wurde nicht gefunden."], 404);
  return asset;
}

async function latestGeneratedAssetForJob(jobId: string) {
  const rows = await supabaseRequest<DesignAssetRow[]>("design_assets", undefined, {
    select: DESIGN_ASSET_SELECT,
    job_id: `eq.${jobId}`,
    source: "eq.generated",
    order: "created_at.desc",
    limit: 1,
  });
  return rows[0] || null;
}

export async function attachDesignAssetToTrello(input: {
  jobId: string;
  assetId?: string | null;
  operatorName?: string | null;
  replacementAttachmentId?: string | null;
}): Promise<DesignTrelloAttachResult> {
  const job = await getDesignJob(input.jobId);
  const asset = input.assetId ? await getDesignAsset(input.assetId) : await latestGeneratedAssetForJob(job.id);
  if (!asset) throw new QuoteValidationError("Kein generiertes Asset fuer diesen Job gefunden.");
  if (!job.trello_card_id) throw new QuoteValidationError("Design-Job hat keine Trello-Karte.");
  if (!asset.public_url) throw new QuoteValidationError("Design-Asset hat keine oeffentliche URL fuer Trello.");

  const replacementAttachmentId = trimNullable(input.replacementAttachmentId);
  const replacementReference = replacementAttachmentId
    ? referenceAttachmentsFromJob(job).find((reference) => reference.attachmentId === replacementAttachmentId) || null
    : null;
  if (replacementAttachmentId && !replacementReference) {
    throw new QuoteValidationError("Der zu ersetzende Trello-Anhang gehoert nicht zu diesem Design-Job.");
  }
  const replacementAttachment = replacementReference
    ? await getTrelloAttachment(replacementReference.cardId, replacementReference.attachmentId)
    : null;
  const replacementName = replacementAttachment ? attachmentName(replacementAttachment) || replacementReference?.name || replacementAttachment.id : null;
  const archivedReplacementName = replacementName ? archiveMockupAttachmentName(replacementName) : null;

  if (asset.trello_attachment_id) {
    if (replacementAttachment && archivedReplacementName) {
      await renameTrelloCardAttachment({
        cardId: replacementReference?.cardId || job.trello_card_id,
        attachmentId: replacementAttachment.id,
        name: archivedReplacementName,
      });
    }
    return {
      job: mapDesignJobSummary(job),
      asset: mapDesignAssetSummary(asset),
      trelloAttachmentId: asset.trello_attachment_id,
      trelloAttachmentUrl: null,
      replacedAttachmentId: replacementAttachment?.id || null,
      archivedAttachmentName: archivedReplacementName,
    };
  }

  const attachmentNameForUpload = replacementName || asset.name || "NEONTRIP Design Mockup";
  const attachment = await addTrelloCardAttachment({
    cardId: job.trello_card_id,
    url: asset.public_url,
    name: attachmentNameForUpload,
  });
  if (replacementAttachment && archivedReplacementName) {
    await renameTrelloCardAttachment({
      cardId: replacementReference?.cardId || job.trello_card_id,
      attachmentId: replacementAttachment.id,
      name: archivedReplacementName,
    });
  }
  const now = new Date().toISOString();
  const updatedAssets = await supabaseRequest<DesignAssetRow[]>(
    "design_assets",
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "attached_to_trello",
        trello_attachment_id: attachment.id,
        name: attachmentNameForUpload,
        updated_at: now,
        metadata: {
          ...(asset.metadata || {}),
          trello_attached_by: trimNullable(input.operatorName),
          trello_attached_at: now,
          trello_replacement_attachment_id: replacementAttachment?.id || null,
          trello_replacement_original_name: replacementName,
          trello_replacement_archived_name: archivedReplacementName,
        },
      }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${asset.id}` },
  );

  const updatedJobs = await supabaseRequest<DesignJobRow[]>(
    "design_jobs",
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "attached_to_trello",
        selected_asset_id: asset.id,
        updated_at: now,
        metadata: {
          ...(job.metadata || {}),
          trello_attachment_id: attachment.id,
          trello_attached_by: trimNullable(input.operatorName),
          trello_replacement_attachment_id: replacementAttachment?.id || null,
          trello_replacement_original_name: replacementName,
          trello_replacement_archived_name: archivedReplacementName,
        },
      }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${job.id}` },
  );

  await addTrelloCardComment({
    cardId: job.trello_card_id,
    text: replacementAttachment && archivedReplacementName
      ? `NEONTRIP Design-Ops: Mockup ersetzt. Neu: ${attachmentNameForUpload}. Alt umbenannt zu ${archivedReplacementName}.`
      : `NEONTRIP Design-Ops: neues Mockup angehaengt (${updatedAssets[0]?.name || asset.name || asset.id}).`,
  }).catch((error) => console.warn("design trello comment skipped", { jobId: job.id, error }));

  return {
    job: mapDesignJobSummary(updatedJobs[0] || { ...job, status: "attached_to_trello" }),
    asset: mapDesignAssetSummary(updatedAssets[0] || { ...asset, status: "attached_to_trello", trello_attachment_id: attachment.id }),
    trelloAttachmentId: attachment.id,
    trelloAttachmentUrl: trimNullable(attachment.url),
    replacedAttachmentId: replacementAttachment?.id || null,
    archivedAttachmentName: archivedReplacementName,
  };
}

export async function applyDesignRemovalPlan(input: {
  removalPlanId: string;
  confirmText: string;
  operatorName?: string | null;
}): Promise<DesignRemovalApplyResult> {
  const normalizedId = trimNullable(input.removalPlanId);
  if (!normalizedId) throw new QuoteValidationError("Removal-Plan ist erforderlich.");
  if (trimNullable(input.confirmText) !== "ENTFERNEN") {
    throw new QuoteValidationError("Bitte bestaetige mit ENTFERNEN.");
  }

  const rows = await supabaseRequest<DesignRemovalBackupRow[]>("design_trello_removal_backups", undefined, {
    select: "id,backup_key,trello_card_id,trello_card_url,status,selected_attachment_count,attachments,metadata,created_at,updated_at",
    id: `eq.${normalizedId}`,
    limit: 1,
  });
  const backup = rows[0];
  if (!backup) throw new QuoteValidationError("Removal-Plan wurde nicht gefunden.", ["Removal-Plan wurde nicht gefunden."], 404);
  if (backup.status === "applied") {
    return { removalPlan: mapRemovalPlan(backup), deleted: backup.selected_attachment_count, failed: [] };
  }
  if (backup.status !== "prepared") {
    throw new QuoteValidationError("Removal-Plan ist nicht mehr im vorbereiteten Status.");
  }

  const deleted: string[] = [];
  const failed: Array<{ attachmentId: string; error: string }> = [];
  for (const attachment of backup.attachments || []) {
    const attachmentId = trimNullable(attachment.id);
    if (!attachmentId) continue;
    try {
      await deleteTrelloCardAttachment({ cardId: backup.trello_card_id, attachmentId });
      deleted.push(attachmentId);
    } catch (error) {
      failed.push({
        attachmentId,
        error: error instanceof Error ? error.message : "Trello Delete fehlgeschlagen.",
      });
    }
  }

  const now = new Date().toISOString();
  const nextStatus = failed.length ? "failed" : "applied";
  const updated = await supabaseRequest<DesignRemovalBackupRow[]>(
    "design_trello_removal_backups",
    {
      method: "PATCH",
      body: JSON.stringify({
        status: nextStatus,
        applied_at: failed.length ? null : now,
        updated_at: now,
        metadata: {
          ...(backup.metadata || {}),
          applied_by: trimNullable(input.operatorName),
          deleted_attachment_ids: deleted,
          failed,
        },
      }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${backup.id}` },
  );

  return {
    removalPlan: mapRemovalPlan(updated[0] || { ...backup, status: nextStatus }),
    deleted: deleted.length,
    failed,
  };
}

export async function linkDesignAssetToOffer(input: {
  assetId: string;
  offerId: string;
  offerImageId?: string | null;
  offerItemId?: string | null;
  lightColorLabel?: string | null;
  expectedUpdatedAt?: string | null;
  operatorName?: string | null;
  dryRun?: boolean | null;
}): Promise<DesignOfferLinkResult> {
  const asset = await getDesignAsset(input.assetId);
  const offerId = trimNullable(input.offerId);
  if (!offerId) throw new QuoteValidationError("Offer-ID ist erforderlich.");

  const offer = await getOfferById(offerId);
  if (!offer.lock.editable || offer.lock.lockLevel === "hard") {
    throw new QuoteValidationError("Angebot ist fuer Design-Integration gesperrt.");
  }

  const offerImageId = trimNullable(input.offerImageId);
  const offerItemId = trimNullable(input.offerItemId);
  const lightColorLabel = trimNullable(input.lightColorLabel);
  const offerImage = offerImageId ? offer.images.find((image) => image.id === offerImageId) : null;
  const offerItem = offerItemId ? offer.items.find((item) => item.id === offerItemId) : null;
  if (offerImageId && !offerImage) throw new QuoteValidationError("Ausgewaehlter Bildslot existiert nicht im Angebot.");
  if (offerItemId && !offerItem) throw new QuoteValidationError("Ausgewaehltes Produkt existiert nicht im Angebot.");
  if (lightColorLabel && !offerItem) throw new QuoteValidationError("Bitte eine Angebotsposition wählen, wenn die Leuchtfarbe im Angebot aktualisiert werden soll.");
  if (!asset.public_url) throw new QuoteValidationError("Design-Asset hat keine oeffentliche URL fuer die Angebotsanreicherung.");

  const link = await getOrCreateOfferAssetLink({
    asset,
    offerId,
    requestId: asset.request_id,
    trelloCardId: asset.trello_card_id,
    operatorName: trimNullable(input.operatorName),
  });

  let offerPatch: OpsOfferPatchResult | null = null;
  if (offerImage || (offerItem && lightColorLabel)) {
    const imagePatches = offerImage
      ? [
          {
            id: offerImage.id,
            title: asset.name || offerImage.title || "Design Mockup",
            enabled: true,
            sortOrder: offerImage.sortOrder,
          },
        ]
      : undefined;
    const itemPatches = offerItem && lightColorLabel
      ? offer.items.map((item) => {
          const patch = offerItemPatch(item);
          if (item.id !== offerItem.id) return patch;
          return {
            ...patch,
            description: upsertLightColorLine(item.description, lightColorLabel),
          };
        })
      : undefined;
    offerPatch = await patchOfferById(
      offer.offerId,
      {
        expectedUpdatedAt: trimNullable(input.expectedUpdatedAt) || offer.updatedAt,
        actor: trimNullable(input.operatorName) || "Ops Design",
        reason: lightColorLabel ? "ops_design_asset_and_light_color_link" : "ops_design_asset_link",
        revisionReason: offer.lock.requiresRevisionReason
          ? `Design-Mockup${lightColorLabel ? ` und Leuchtfarbe ${lightColorLabel}` : ""} aus Design Studio aktualisiert.`
          : undefined,
        images: imagePatches,
        items: itemPatches,
      },
      Boolean(input.dryRun),
    );
  }

  let crmQuoteImage: DesignCrmQuoteImageLink | null = null;
  if (!input.dryRun) {
    const itemIndex = offerItemIndex(offer, offerItemId, offerImage?.linkedItemTitle || null);
    crmQuoteImage = await getOrCreateCrmQuoteVersionImage({
      offerId,
      asset,
      itemIndex,
    });
    const nextStatus = offerPatch ? "linked" : "needs_price_review";
    await supabaseRequest<DesignOfferAssetLinkRow[]>(
      "design_offer_asset_links",
      {
        method: "PATCH",
        body: JSON.stringify({
          offer_item_id: offerItemId,
          offer_version_id: offer.updatedAt,
          status: nextStatus,
          reviewed_by: trimNullable(input.operatorName),
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: {
            ...(link.metadata || {}),
            offer_image_id: offerImageId,
            offer_item_title: offerItem?.title || null,
            light_color_label: lightColorLabel,
            asset_public_url: asset.public_url,
            crm_quote_image_id: crmQuoteImage.id,
            crm_quote_version_id: crmQuoteImage.versionId,
            crm_quote_item_index: crmQuoteImage.itemIndex,
            crm_quote_image_index: crmQuoteImage.imageIndex,
          },
        }),
        headers: { Prefer: "return=representation" },
      },
      { id: `eq.${link.id}` },
    );

    await supabaseRequest<DesignAssetRow[]>(
      "design_assets",
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "linked_to_offer",
          updated_at: new Date().toISOString(),
          metadata: {
            ...(asset.metadata || {}),
            offer_id: offerId,
            offer_item_id: offerItemId,
            offer_image_id: offerImageId,
            light_color_label: lightColorLabel,
            crm_quote_image_id: crmQuoteImage.id,
            crm_quote_version_id: crmQuoteImage.versionId,
            crm_quote_item_index: crmQuoteImage.itemIndex,
            crm_quote_image_index: crmQuoteImage.imageIndex,
          },
        }),
        headers: { Prefer: "return=representation" },
      },
      { id: `eq.${asset.id}` },
    );
  }

  return {
    status: offerPatch ? (input.dryRun ? "dry_run_ok" : "linked") : "needs_price_review",
    offerId,
    assetId: asset.id,
    dryRun: Boolean(input.dryRun),
    crmQuoteImage,
    offerPatch,
  };
}

export async function listQueuedDesignJobsForWorker(input: {
  limit?: number | null;
} = {}): Promise<DesignWorkerJob[]> {
  const limit = Math.max(1, Math.min(Number(input.limit || 5), 10));
  const rows = await supabaseRequest<DesignJobRow[]>("design_jobs", undefined, {
    select: DESIGN_JOB_SELECT,
    status: "eq.queued",
    order: "updated_at.asc",
    limit,
  });
  const jobs: DesignWorkerJob[] = [];
  for (const job of rows) {
    if (!job.prompt_version_id) continue;
    const promptVersion = await getPromptVersion(job.prompt_version_id);
    jobs.push({
      ...mapDesignJobSummary(job),
      promptVersion: {
        id: promptVersion.id,
        versionNumber: promptVersion.version_number,
        title: promptVersion.prompt_title,
        promptText: promptVersion.prompt_text,
        promptHash: promptVersion.prompt_hash,
      },
    });
  }
  return jobs;
}

export async function markDesignJobGenerating(input: {
  jobId: string;
  workerRunId?: string | null;
}) {
  const job = await getDesignJob(input.jobId);
  if (job.status !== "queued" && job.status !== "generating") {
    throw new QuoteValidationError("Nur queued Design-Jobs koennen gestartet werden.");
  }
  const updated = await supabaseRequest<DesignJobRow[]>(
    "design_jobs",
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "generating",
        updated_at: new Date().toISOString(),
        metadata: {
          source: "design_worker",
          worker_run_id: trimNullable(input.workerRunId),
        },
      }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${job.id}` },
  );
  return mapDesignJobSummary(updated[0] || { ...job, status: "generating" });
}

async function uploadDesignAssetToStorage(input: {
  job: DesignJobRow;
  promptVersion: DesignPromptVersionRow;
  idempotencyKey: string;
  bytes: Buffer;
  contentType: string;
  extension: string;
}) {
  const bucket = designAssetBucket();
  const path = [
    slugPathPart(input.job.request_id, "no-request"),
    input.job.id,
    `${stableHash(`${input.promptVersion.prompt_hash}:${input.idempotencyKey}`).slice(0, 24)}.${input.extension}`,
  ].join("/");
  const uploadUrl = `${supabaseProjectUrl()}/storage/v1/object/${encodeURIComponent(bucket)}/${path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
  const key = supabaseServiceRoleKey();
  const uploadBody = new Blob([new Uint8Array(input.bytes)], { type: input.contentType });
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": input.contentType,
      "x-upsert": "true",
    },
    body: uploadBody,
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new QuoteValidationError(`Design-Asset konnte nicht gespeichert werden (${response.status}).`, [body.slice(0, 300)]);
  }

  return {
    bucket,
    path,
    publicUrl: `${supabaseProjectUrl()}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`,
  };
}

async function generateOpenAiDesignImage(promptText: string) {
  const model = String(process.env.OPS_OPENAI_IMAGE_MODEL || "gpt-image-1.5").trim() || "gpt-image-1.5";
  const outputFormat = String(process.env.OPS_OPENAI_IMAGE_FORMAT || "webp").trim().toLowerCase();
  const imageFormat = outputFormat === "png" || outputFormat === "jpeg" ? outputFormat : "webp";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiImageApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: promptText,
      n: 1,
      size: "1024x1024",
      quality: "medium",
      output_format: imageFormat,
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new QuoteValidationError(
      `OpenAI Image API antwortete mit ${response.status}.`,
      [payload?.error?.message || "Bitte OPS_OPENAI_API_KEY, Organisation und Modellzugriff pruefen."],
      response.status,
    );
  }

  const image = payload?.data?.[0] || null;
  if (image?.b64_json) {
    return {
      model,
      bytes: Buffer.from(image.b64_json, "base64"),
      contentType: imageFormat === "jpeg" ? "image/jpeg" : `image/${imageFormat}`,
      extension: imageFormat === "jpeg" ? "jpg" : imageFormat,
      remoteUrl: null as string | null,
    };
  }

  if (image?.url) {
    const imageResponse = await fetch(image.url, { cache: "no-store" });
    if (!imageResponse.ok) throw new QuoteValidationError(`OpenAI Bild-URL konnte nicht geladen werden (${imageResponse.status}).`);
    const contentType = imageResponse.headers.get("content-type") || "image/png";
    const extension = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
    return {
      model,
      bytes: Buffer.from(await imageResponse.arrayBuffer()),
      contentType,
      extension,
      remoteUrl: image.url,
    };
  }

  throw new QuoteValidationError("OpenAI Image API lieferte kein Bild.");
}

function referenceAttachmentsFromJob(job: DesignJobRow): DesignReferenceAttachment[] {
  const raw = (job.metadata || {}).reference_attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const value = entry as Record<string, unknown>;
      const cardId = trimNullable(value.cardId);
      const attachmentId = trimNullable(value.attachmentId);
      const name = trimNullable(value.name) || attachmentId || "reference-image";
      const kind = trimNullable(value.kind) as DesignAttachmentKind | null;
      if (!cardId || !attachmentId || !kind || !["mockup", "reference", "image"].includes(kind)) return null;
      return { cardId, attachmentId, name, kind };
    })
    .filter((entry): entry is DesignReferenceAttachment => Boolean(entry))
    .slice(0, 4);
}

function referenceAssetsFromJob(job: DesignJobRow): DesignReferenceAsset[] {
  const raw = (job.metadata || {}).reference_assets;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const value = entry as Record<string, unknown>;
      const assetId = trimNullable(value.assetId);
      const publicUrl = trimNullable(value.publicUrl);
      const name = trimNullable(value.name) || assetId || "generated-design-asset";
      const mimeType = trimNullable(value.mimeType);
      if (!assetId || !publicUrl) return null;
      return { assetId, publicUrl, name, mimeType };
    })
    .filter((entry): entry is DesignReferenceAsset => Boolean(entry))
    .slice(0, 4);
}

function promptForImageEdit(promptText: string) {
  const lightColorMatch = promptText.match(/Ändere ausschließlich die sichtbare Leuchtfarbe des Schildes zu ([^\n.]+)/i);
  const lightColor = trimNullable(lightColorMatch?.[1]);
  if (lightColor) {
    return [
      `Ändere in dem bereitgestellten Bild ausschließlich die sichtbare Leuchtfarbe des vorhandenen Schildes zu ${lightColor}.`,
      "Erhalte exakt dasselbe Motiv: Text, Logo, Buchstabenform, Position, Perspektive, Hintergrund, Montage, Größe, Material, Bildausschnitt und Kamerawinkel unverändert.",
      "Keine neue Szene, kein neues Schild, keine neuen Wörter, keine zusätzlichen Logos, keine Dekoration und keine Änderungen an Helligkeit oder Umgebung außer der Lichtfarbe.",
    ].join("\n");
  }

  return [
    "Bearbeite das bereitgestellte Ausgangsbild. Erhalte Layout, Perspektive, Hintergrund, Produktform, Text, Logo-/Schriftanmutung, Materialwirkung und Komposition so weit wie technisch möglich.",
    "Nimm nur die im Prompt beschriebene Änderung vor. Bei Leuchtfarbenänderungen darf ausschließlich die sichtbare Licht-/LED-Farbe verändert werden.",
    "Keine neuen Wörter, Logos, Produkte, Räume, Preisangaben oder Designelemente hinzufügen.",
    "",
    promptText,
  ].join("\n");
}

function safeImageFilename(name: string, contentType: string) {
  const extension = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
  const base = slugPathPart(name.replace(/\.[a-z0-9]+$/i, ""), "reference");
  return `${base}.${extension}`;
}

function referenceImageContentType(contentType: string | null | undefined, name: string) {
  const normalized = String(contentType || "").split(";")[0]?.trim().toLowerCase();
  if (/^image\/png$/i.test(normalized)) return "image/png";
  if (/^image\/jpe?g$/i.test(normalized)) return "image/jpeg";
  if (/^image\/webp$/i.test(normalized)) return "image/webp";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  return null;
}

async function downloadDesignReferenceAttachments(job: DesignJobRow) {
  const references = referenceAttachmentsFromJob(job);
  const files = [];
  for (const reference of references) {
    const attachment = await getTrelloAttachment(reference.cardId, reference.attachmentId);
    const file = await downloadTrelloAttachment(attachment);
    const contentType = referenceImageContentType(file.contentType, reference.name);
    if (!contentType) {
      throw new QuoteValidationError(`Referenzbild ${reference.name} ist kein unterstütztes Bildformat fuer Image-Edit.`);
    }
    files.push({
      reference,
      body: file.body,
      contentType,
      filename: safeImageFilename(reference.name, contentType),
    });
  }
  for (const reference of referenceAssetsFromJob(job)) {
    const response = await fetch(reference.publicUrl, { cache: "no-store" });
    if (!response.ok) throw new QuoteValidationError(`Generiertes Referenzbild konnte nicht geladen werden (${response.status}).`);
    const contentType = referenceImageContentType(response.headers.get("content-type") || reference.mimeType, reference.name);
    if (!contentType) {
      throw new QuoteValidationError(`Generiertes Referenzbild ${reference.name} ist kein unterstütztes Bildformat fuer Image-Edit.`);
    }
    files.push({
      reference,
      body: Buffer.from(await response.arrayBuffer()),
      contentType,
      filename: safeImageFilename(reference.name, contentType),
    });
  }
  return files;
}

async function generateOpenAiDesignImageEdit(promptText: string, referenceFiles: Awaited<ReturnType<typeof downloadDesignReferenceAttachments>>) {
  if (!referenceFiles.length) return generateOpenAiDesignImage(promptText);
  const model = String(process.env.OPS_OPENAI_IMAGE_EDIT_MODEL || process.env.OPS_OPENAI_IMAGE_MODEL || "gpt-image-1.5").trim() || "gpt-image-1.5";
  const outputFormat = String(process.env.OPS_OPENAI_IMAGE_FORMAT || "webp").trim().toLowerCase();
  const imageFormat = outputFormat === "png" || outputFormat === "jpeg" ? outputFormat : "webp";
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", promptForImageEdit(promptText));
  form.append("n", "1");
  form.append("size", "1024x1024");
  form.append("quality", "medium");
  form.append("output_format", imageFormat);
  if (!/^gpt-image-2/i.test(model) && !/mini/i.test(model)) form.append("input_fidelity", "high");
  for (const file of referenceFiles) {
    form.append("image[]", new Blob([file.body], { type: file.contentType }), file.filename);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiImageApiKey()}`,
    },
    body: form,
  });

  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new QuoteValidationError(
      `OpenAI Image Edit API antwortete mit ${response.status}.`,
      [payload?.error?.message || "Bitte Referenzbild, OPS_OPENAI_API_KEY, Organisation und Modellzugriff pruefen."],
      response.status,
    );
  }

  const image = payload?.data?.[0] || null;
  if (image?.b64_json) {
    return {
      model,
      bytes: Buffer.from(image.b64_json, "base64"),
      contentType: imageFormat === "jpeg" ? "image/jpeg" : `image/${imageFormat}`,
      extension: imageFormat === "jpeg" ? "jpg" : imageFormat,
      remoteUrl: null as string | null,
    };
  }

  if (image?.url) {
    const imageResponse = await fetch(image.url, { cache: "no-store" });
    if (!imageResponse.ok) throw new QuoteValidationError(`OpenAI Bild-URL konnte nicht geladen werden (${imageResponse.status}).`);
    const contentType = imageResponse.headers.get("content-type") || "image/png";
    const extension = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
    return {
      model,
      bytes: Buffer.from(await imageResponse.arrayBuffer()),
      contentType,
      extension,
      remoteUrl: image.url,
    };
  }

  throw new QuoteValidationError("OpenAI Image Edit API lieferte kein Bild.");
}

export async function generateDesignJobNow(input: {
  jobId: string;
  idempotencyKey: string;
  operatorName?: string | null;
}): Promise<DesignGenerateResult> {
  const idempotencyKey = trimNullable(input.idempotencyKey);
  if (!idempotencyKey) throw new QuoteValidationError("idempotencyKey ist erforderlich.");

  const job = await getDesignJob(input.jobId);
  const promptVersion = await getPromptVersion(job.prompt_version_id);
  if (["generated", "attached_to_trello", "linked_to_offer"].includes(job.status)) {
    const existingAsset = job.selected_asset_id ? await getDesignAsset(job.selected_asset_id).catch(() => null) : await latestGeneratedAssetForJob(job.id);
    return {
      job: mapDesignJobSummary(job),
      asset: existingAsset ? mapDesignAssetSummary(existingAsset) : null,
      model: "existing",
      storagePath: existingAsset?.storage_path || null,
    };
  }

  await supabaseRequest<DesignJobRow[]>(
    "design_jobs",
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "generating",
        updated_at: new Date().toISOString(),
        metadata: {
          ...(job.metadata || {}),
          direct_generate_by: trimNullable(input.operatorName),
          direct_generate_idempotency_key: idempotencyKey,
        },
      }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${job.id}` },
  );

  try {
    const referenceFiles = await downloadDesignReferenceAttachments(job);
    const generated = referenceFiles.length
      ? await generateOpenAiDesignImageEdit(promptVersion.prompt_text, referenceFiles)
      : await generateOpenAiDesignImage(promptVersion.prompt_text);
    const stored = await uploadDesignAssetToStorage({
      job,
      promptVersion,
      idempotencyKey,
      bytes: generated.bytes,
      contentType: generated.contentType,
      extension: generated.extension,
    });
    const updatedJob = await applyDesignWorkerCallback({
      jobId: job.id,
      idempotencyKey,
      status: "generated",
      workerRunId: stableActionKey("direct-openai", [job.id, idempotencyKey]),
      asset: {
        assetKey: stableActionKey("design-asset", [job.id, promptVersion.id, idempotencyKey]),
        storageBucket: stored.bucket,
        storagePath: stored.path,
        publicUrl: stored.publicUrl,
        mimeType: generated.contentType,
        name: promptVersion.prompt_title,
      },
    });
    const asset = await latestGeneratedAssetForJob(job.id);
    return {
      job: updatedJob,
      asset: asset ? mapDesignAssetSummary(asset) : null,
      model: generated.model,
      storagePath: stored.path,
    };
  } catch (error) {
    await applyDesignWorkerCallback({
      jobId: job.id,
      idempotencyKey,
      status: "failed",
      workerRunId: stableActionKey("direct-openai", [job.id, idempotencyKey]),
      errorMessage: error instanceof Error ? error.message : "Direkte Design-Generierung fehlgeschlagen.",
    }).catch((callbackError) => console.warn("design direct failure callback failed", { jobId: job.id, callbackError }));
    throw error;
  }
}

export async function applyDesignWorkerCallback(input: {
  jobId: string;
  idempotencyKey: string;
  status: "generated" | "failed";
  asset?: {
    assetKey?: string | null;
    storageBucket?: string | null;
    storagePath?: string | null;
    publicUrl?: string | null;
    mimeType?: string | null;
    width?: number | null;
    height?: number | null;
    name?: string | null;
    trelloAttachmentId?: string | null;
  } | null;
  errorMessage?: string | null;
  workerRunId?: string | null;
}) {
  const job = await getDesignJob(input.jobId);
  const promptVersion = await getPromptVersion(job.prompt_version_id);
  const idempotencyKey = trimNullable(input.idempotencyKey);
  if (!idempotencyKey) throw new QuoteValidationError("idempotencyKey ist erforderlich.");

  if (input.status === "failed") {
    const updated = await supabaseRequest<DesignJobRow[]>(
      "design_jobs",
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "failed",
          error_message: trimNullable(input.errorMessage) || "Worker meldete einen Fehler.",
          updated_at: new Date().toISOString(),
          metadata: {
            source: "design_worker",
            worker_run_id: trimNullable(input.workerRunId),
            idempotency_key: idempotencyKey,
          },
        }),
        headers: { Prefer: "return=representation" },
      },
      { id: `eq.${job.id}` },
    );
    return mapDesignJobSummary(updated[0] || { ...job, status: "failed", error_message: trimNullable(input.errorMessage) });
  }

  const assetInput = input.asset || {};
  const assetKey = trimNullable(assetInput.assetKey) || stableActionKey("design-asset", [job.id, promptVersion.id, idempotencyKey]);
  const existing = await supabaseRequest<DesignAssetRow[]>("design_assets", undefined, {
    select: DESIGN_ASSET_SELECT,
    asset_key: `eq.${assetKey}`,
    limit: 1,
  });
  const assetStatus = trimNullable(assetInput.storagePath) || trimNullable(assetInput.publicUrl) ? "stored" : "generated";
  const assetBody = {
    asset_key: assetKey,
    job_id: job.id,
    prompt_version_id: promptVersion.id,
    request_id: job.request_id,
    trello_card_id: job.trello_card_id,
    source: "generated",
    status: assetStatus,
    storage_bucket: trimNullable(assetInput.storageBucket),
    storage_path: trimNullable(assetInput.storagePath),
    public_url: trimNullable(assetInput.publicUrl),
    trello_attachment_id: trimNullable(assetInput.trelloAttachmentId),
    name: trimNullable(assetInput.name) || promptVersion.prompt_title,
    mime_type: trimNullable(assetInput.mimeType),
    width: Number.isFinite(assetInput.width) ? Number(assetInput.width) : null,
    height: Number.isFinite(assetInput.height) ? Number(assetInput.height) : null,
    metadata: {
      source: "design_worker",
      worker_run_id: trimNullable(input.workerRunId),
      idempotency_key: idempotencyKey,
      prompt_hash: promptVersion.prompt_hash,
    },
  };
  const assetRows = existing[0]
    ? await supabaseRequest<DesignAssetRow[]>(
        "design_assets",
        {
          method: "PATCH",
          body: JSON.stringify({ ...assetBody, updated_at: new Date().toISOString() }),
          headers: { Prefer: "return=representation" },
        },
        { id: `eq.${existing[0].id}` },
      )
    : await supabaseRequest<DesignAssetRow[]>("design_assets", {
        method: "POST",
        body: JSON.stringify(assetBody),
        headers: { Prefer: "return=representation" },
      });
  const asset = assetRows[0] || existing[0];
  if (!asset) throw new QuoteValidationError("Worker-Asset konnte nicht gespeichert werden.");

  const updated = await supabaseRequest<DesignJobRow[]>(
    "design_jobs",
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "generated",
        selected_asset_id: asset.id,
        error_message: null,
        updated_at: new Date().toISOString(),
        metadata: {
          source: "design_worker",
          worker_run_id: trimNullable(input.workerRunId),
          idempotency_key: idempotencyKey,
        },
      }),
      headers: { Prefer: "return=representation" },
    },
    { id: `eq.${job.id}` },
  );
  return mapDesignJobSummary(updated[0] || { ...job, status: "generated" });
}

function mapDesignJobDraft(job: DesignJobRow, promptVersion: DesignPromptVersionRow): DesignJobDraft {
  return {
    id: job.id,
    jobKey: job.job_key,
    status: job.status,
    requestId: job.request_id,
    trelloCardId: job.trello_card_id,
    offerId: job.offer_id,
    promptVersion: {
      id: promptVersion.id,
      versionNumber: promptVersion.version_number,
      title: promptVersion.prompt_title,
      promptHash: promptVersion.prompt_hash,
    },
  };
}

function mapDesignJobSummary(job: DesignJobRow): DesignJobSummary {
  return {
    id: job.id,
    jobKey: job.job_key,
    status: job.status,
    requestId: job.request_id,
    trelloCardId: job.trello_card_id,
    offerId: job.offer_id,
    sourceQuery: job.source_query,
    errorMessage: job.error_message,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

function mapDesignAssetSummary(asset: DesignAssetRow): DesignAssetSummary {
  return {
    id: asset.id,
    assetKey: asset.asset_key,
    jobId: asset.job_id,
    status: asset.status,
    publicUrl: asset.public_url,
    trelloAttachmentId: asset.trello_attachment_id,
    name: asset.name,
    mimeType: asset.mime_type,
    width: asset.width,
    height: asset.height,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
  };
}

function mapRemovalPlan(row: DesignRemovalBackupRow): DesignRemovalPlan {
  return {
    id: row.id,
    backupKey: row.backup_key,
    status: row.status,
    trelloCardId: row.trello_card_id,
    trelloCardUrl: row.trello_card_url,
    selectedAttachmentCount: row.selected_attachment_count,
  };
}
