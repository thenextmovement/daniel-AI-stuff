import type {
  CustomFieldMap,
  TrelloAction,
  TrelloAttachment,
  TrelloCardData,
  TrelloCustomFieldOption,
  TrelloEditableCustomField,
} from "./types";

export type TrelloCustomField = {
  id: string;
  name: string;
  type?: string;
  options?: Array<{
    id: string;
    value?: {
      text?: string;
    };
  }>;
};

type TrelloCustomFieldItem = {
  idCustomField: string;
  idValue?: string;
  value?: {
    text?: string;
    number?: string;
    checked?: string;
    date?: string;
  };
};

function trelloConfig() {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) throw new Error("Trello API-Konfiguration fehlt.");
  return { key, token };
}

async function trelloFetch<T>(path: string) {
  const { key, token } = trelloConfig();
  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);

  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url.toString(), { cache: "no-store" });
    if (response.status !== 429 || attempt === 2) break;

    const retryAfter = Number(response.headers.get("retry-after"));
    const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 750 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  }

  if (!response) throw new Error("Trello Anfrage fehlgeschlagen: keine Antwort.");
  if (!response.ok) throw new Error(`Trello Anfrage fehlgeschlagen: ${response.status}`);
  return (await response.json()) as T;
}

export type TrelloCardSearchResult = {
  id: string;
  name?: string;
  idBoard?: string;
  url?: string;
};

export type TrelloBoardList = {
  id: string;
  name?: string;
  closed?: boolean;
  pos?: number;
};

export type CreatedTrelloCard = {
  id: string;
  idBoard?: string;
  name?: string;
  url?: string;
  shortUrl?: string;
};

function customFieldValue(item: TrelloCustomFieldItem) {
  const value = item.value || {};
  return value.text ?? value.number ?? value.checked ?? value.date ?? "";
}

function fieldOptions(field: TrelloCustomField): TrelloCustomFieldOption[] {
  return (field.options || [])
    .map((option) => ({
      id: option.id,
      text: String(option.value?.text || "").trim(),
    }))
    .filter((option) => option.text);
}

function editableFieldValue(field: TrelloCustomField, item?: TrelloCustomFieldItem): TrelloEditableCustomField {
  const options = fieldOptions(field);
  if (!item) {
    return {
      id: field.id,
      name: field.name,
      type: field.type || "text",
      value: null,
      displayValue: null,
      options,
    };
  }

  if (field.type === "checkbox") {
    const checked = item.value?.checked === "true";
    return {
      id: field.id,
      name: field.name,
      type: field.type,
      value: checked,
      displayValue: checked ? "Ja" : "Nein",
      options,
    };
  }

  if (field.type === "list") {
    const selected = options.find((option) => option.id === item.idValue) || null;
    return {
      id: field.id,
      name: field.name,
      type: field.type,
      value: item.idValue || null,
      displayValue: selected?.text || null,
      options,
    };
  }

  const raw = item.value?.text ?? item.value?.number ?? item.value?.date ?? null;
  return {
    id: field.id,
    name: field.name,
    type: field.type || "text",
    value: raw,
    displayValue: raw ? String(raw) : null,
    options,
  };
}

function trelloCardCreatedAt(cardId: string) {
  const prefix = String(cardId || "").slice(0, 8);
  if (!/^[0-9a-f]{8}$/i.test(prefix)) return null;
  const timestamp = Number.parseInt(prefix, 16) * 1000;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getTrelloCard(cardId: string): Promise<TrelloCardData> {
  const card = await trelloFetch<{
    id: string;
    name?: string;
    desc?: string;
    idBoard: string;
    idList?: string;
    customFieldItems?: TrelloCustomFieldItem[];
    attachments?: TrelloAttachment[];
    actions?: TrelloAction[];
  }>(
    `/cards/${encodeURIComponent(cardId)}?fields=id,name,desc,idBoard,idList&customFieldItems=true&attachments=true&actions=commentCard&actions_limit=50&action_fields=date,data`,
  );
  const fields = await trelloFetch<TrelloCustomField[]>(
    `/boards/${encodeURIComponent(card.idBoard)}/customFields`,
  );
  const fieldNameById = new Map(fields.map((field) => [field.id, field.name]));
  const customFieldItemById = new Map((card.customFieldItems || []).map((item) => [item.idCustomField, item]));
  const customFields: CustomFieldMap = {};

  for (const item of card.customFieldItems || []) {
    const name = fieldNameById.get(item.idCustomField);
    if (name) customFields[name] = customFieldValue(item);
  }

  return {
    id: card.id,
    idBoard: card.idBoard,
    idList: card.idList,
    name: card.name,
    desc: card.desc,
    createdAt: trelloCardCreatedAt(card.id),
    customFields,
    attachments: card.attachments || [],
    actions: card.actions || [],
    editableFields: fields.map((field) => editableFieldValue(field, customFieldItemById.get(field.id))),
  };
}

export async function getTrelloCardVisuals(cardId: string) {
  return trelloFetch<{
    id: string;
    name?: string;
    url?: string;
    attachments?: TrelloAttachment[];
  }>(`/cards/${encodeURIComponent(cardId)}?fields=id,name,url&attachments=true`);
}

export async function searchTrelloCards(query: string, boardIds: string[] = []) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) return [] as TrelloCardSearchResult[];

  const search = new URLSearchParams();
  search.set("query", normalizedQuery);
  search.set("modelTypes", "cards");
  search.set("cards_limit", "20");
  search.set("card_fields", "id,name,idBoard,url");
  if (boardIds.length) {
    search.set("idBoards", boardIds.join(","));
  }

  const response = await trelloFetch<{ cards?: TrelloCardSearchResult[] }>(`/search?${search.toString()}`);
  return response.cards || [];
}

export async function getTrelloAttachment(cardId: string, attachmentId: string): Promise<TrelloAttachment> {
  return trelloFetch<TrelloAttachment>(
    `/cards/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(attachmentId)}?fields=id,name,fileName,url,mimeType`,
  );
}

export async function downloadTrelloAttachment(attachment: TrelloAttachment) {
  const { key, token } = trelloConfig();
  const source = attachment.url;
  if (!source) throw new Error("Trello Attachment URL fehlt.");
  const response = await fetch(source, {
    cache: "no-store",
    headers: {
      Authorization: `OAuth oauth_consumer_key="${key}", oauth_token="${token}"`,
    },
  });
  if (!response.ok) throw new Error(`Trello Attachment Download fehlgeschlagen: ${response.status}`);
  return {
    contentType: response.headers.get("content-type") || attachment.mimeType || "application/octet-stream",
    body: await response.arrayBuffer(),
  };
}

export async function updateTrelloCustomField(params: {
  cardId: string;
  fieldId: string;
  type: string;
  value: string | boolean | null;
}) {
  const { cardId, fieldId, type, value } = params;

  const payload: Record<string, unknown> = {};
  if (type === "list") {
    payload.idValue = value ? String(value) : "";
  } else if (type === "checkbox") {
    payload.value = { checked: value ? "true" : "false" };
  } else if (type === "number") {
    payload.value = value === null || value === "" ? "" : { number: String(value) };
  } else if (type === "date") {
    payload.value = value ? { date: String(value) } : "";
  } else {
    payload.value = value ? { text: String(value) } : "";
  }

  const { key, token } = trelloConfig();
  const url = new URL(
    `https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/customField/${encodeURIComponent(fieldId)}/item`,
  );
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Trello Custom Field Update fehlgeschlagen: ${response.status}`);
  }
}

export async function createTrelloCard(input: {
  listId: string;
  name: string;
  desc?: string | null;
}) {
  const { key, token } = trelloConfig();
  const url = new URL("https://api.trello.com/1/cards");
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);
  url.searchParams.set("idList", input.listId);
  url.searchParams.set("name", input.name);
  if (input.desc) url.searchParams.set("desc", input.desc);

  const response = await fetch(url.toString(), {
    method: "POST",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Trello Karte konnte nicht erstellt werden: ${response.status}`);
  }

  return (await response.json()) as CreatedTrelloCard;
}

export async function getTrelloBoardCustomFields(boardId: string) {
  return trelloFetch<TrelloCustomField[]>(`/boards/${encodeURIComponent(boardId)}/customFields`);
}

function customFieldNameKey(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function findTrelloCustomFieldByName(boardId: string, names: string[]) {
  const wanted = new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const wantedKeys = new Set(names.map(customFieldNameKey).filter(Boolean));
  const fields = await getTrelloBoardCustomFields(boardId);
  return (
    fields.find((field) => wanted.has(String(field.name || "").trim().toLowerCase())) ||
    fields.find((field) => wantedKeys.has(customFieldNameKey(String(field.name || "")))) ||
    null
  );
}

export async function getTrelloBoardLists(boardId: string) {
  const lists = await trelloFetch<TrelloBoardList[]>(
    `/boards/${encodeURIComponent(boardId)}/lists?fields=id,name,closed,pos`,
  );
  return (lists || []).filter((list) => !list.closed);
}

export async function updateTrelloCard(
  cardId: string,
  patch: {
    name?: string | null;
    desc?: string | null;
  },
) {
  const { key, token } = trelloConfig();
  const url = new URL(`https://api.trello.com/1/cards/${encodeURIComponent(cardId)}`);
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);

  if (patch.name !== undefined) {
    url.searchParams.set("name", patch.name || "");
  }
  if (patch.desc !== undefined) {
    url.searchParams.set("desc", patch.desc || "");
  }

  const response = await fetch(url.toString(), {
    method: "PUT",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Trello Karten-Update fehlgeschlagen: ${response.status}`);
  }
}

export async function moveTrelloCardToList(cardId: string, listId: string) {
  const { key, token } = trelloConfig();
  const url = new URL(`https://api.trello.com/1/cards/${encodeURIComponent(cardId)}`);
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);
  url.searchParams.set("idList", listId);

  const response = await fetch(url.toString(), {
    method: "PUT",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Trello Kartenverschiebung fehlgeschlagen: ${response.status}`);
  }
}
