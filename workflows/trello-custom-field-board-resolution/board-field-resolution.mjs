const TRELLO_ID = /^[0-9a-f]{24}$/i;

function requiredId(value, label) {
  const normalized = String(value || "").trim();
  if (!TRELLO_ID.test(normalized)) throw new Error(`${label} is missing or invalid`);
  return normalized;
}

function requiredField(fields, boardId, name, type) {
  const matches = fields.filter(
    (field) =>
      String(field?.name || "").trim().toLowerCase() === name.toLowerCase() &&
      String(field?.idModel || "") === boardId &&
      field?.modelType === "board",
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${name} field on board ${boardId}, found ${matches.length}`);
  }
  if (matches[0].type !== type) throw new Error(`${name} must be a ${type} field`);
  requiredId(matches[0].id, `${name} custom field ID`);
  return matches[0];
}

export function boardCustomFieldsUrl(card) {
  const boardId = requiredId(card?.idBoard, "Trello card board ID");
  return `https://api.trello.com/1/boards/${boardId}/customFields`;
}

export function buildFieldUpdates({ card, customFields, requestId, product1Text = "LED Neon" }) {
  const cardId = requiredId(card?.id, "Trello card ID");
  const boardId = requiredId(card?.idBoard, "Trello card board ID");
  if (!Array.isArray(customFields) || customFields.length === 0) {
    throw new Error(`No Trello custom fields returned for board ${boardId}`);
  }
  const foreignField = customFields.find(
    (field) => String(field?.idModel || "") !== boardId || field?.modelType !== "board",
  );
  if (foreignField) throw new Error(`Trello custom field board mismatch for card ${cardId}`);

  const normalizedRequestId = String(requestId || "").trim();
  if (!normalizedRequestId) throw new Error("Request ID is required before Trello projection");

  const nerdyField = requiredField(customFields, boardId, "Nerdy-Forms_ID", "text");
  const product1Field = requiredField(customFields, boardId, "Product 1", "list");
  const normalizedProduct = product1Text.trim().toLowerCase();
  const options = (product1Field.options || []).filter(
    (option) => String(option?.value?.text || "").trim().toLowerCase() === normalizedProduct,
  );
  if (options.length !== 1) {
    throw new Error(`Expected exactly one Product 1 option ${product1Text} on board ${boardId}`);
  }
  const optionId = requiredId(options[0].id || options[0]._id, `Product 1 option ${product1Text}`);

  return [
    {
      cardId,
      boardId,
      customFieldId: nerdyField.id,
      fieldName: "Nerdy-Forms_ID",
      idempotencyKey: `${normalizedRequestId}:${cardId}:Nerdy-Forms_ID`,
      customFieldPayload: { value: { text: normalizedRequestId } },
    },
    {
      cardId,
      boardId,
      customFieldId: product1Field.id,
      fieldName: "Product 1",
      idempotencyKey: `${normalizedRequestId}:${cardId}:Product 1:${optionId}`,
      customFieldPayload: { idValue: optionId },
    },
  ];
}

export { TRELLO_ID };
