export const WORKFLOW_ID = "fcPiGDWq41htB5mV";
export const GET_FIELDS_NODE = "Get Board Custom Fields";
export const PREPARE_FIELDS_NODE = "Prepare Field Data";

export const DYNAMIC_BOARD_FIELDS_URL =
  "={{ (() => { const card = $('Create Trello Card').item.json; const boardId = String(card.idBoard || '').trim(); if (!/^[0-9a-f]{24}$/i.test(boardId)) throw new Error('Created Trello card has no valid board ID'); return 'https://api.trello.com/1/boards/' + boardId + '/customFields'; })() }}";

export const PREPARE_FIELD_DATA_CODE = `const customFields = $input.all().map(item => item.json).filter(Boolean);
const card = $('Create Trello Card').item.json;
const cardId = String(card.id || '').trim();
const boardId = String(card.idBoard || '').trim();
const trelloId = /^[0-9a-f]{24}$/i;
if (!trelloId.test(cardId)) throw new Error('Created Trello card has no valid card ID');
if (!trelloId.test(boardId)) throw new Error('Created Trello card has no valid board ID');
if (!customFields.length) throw new Error('No Trello custom fields returned for board ' + boardId);
const foreignField = customFields.find(field => String(field.idModel || '') !== boardId || field.modelType !== 'board');
if (foreignField) throw new Error('Trello custom field board mismatch for card ' + cardId);

function requiredField(name, type) {
  const matches = customFields.filter(field =>
    String(field.name || '').trim().toLowerCase() === name.toLowerCase() &&
    String(field.idModel || '') === boardId &&
    field.modelType === 'board'
  );
  if (matches.length !== 1) throw new Error('Expected exactly one ' + name + ' field on board ' + boardId + ', found ' + matches.length);
  if (matches[0].type !== type) throw new Error(name + ' must be a ' + type + ' field');
  if (!trelloId.test(String(matches[0].id || ''))) throw new Error(name + ' has an invalid custom field ID');
  return matches[0];
}

const nerdyField = requiredField('Nerdy-Forms_ID', 'text');
const product1Field = requiredField('Product 1', 'list');
const options = (product1Field.options || []).filter(option =>
  String(option.value?.text || '').trim().toLowerCase() === 'led neon'
);
if (options.length !== 1) throw new Error('Expected exactly one Product 1 option LED Neon on board ' + boardId);
const optionId = String(options[0].id || options[0]._id || '').trim();
if (!trelloId.test(optionId)) throw new Error('Product 1 option LED Neon has an invalid ID');
const requestId = String($('Translate Fields').item.json.requestId || '').trim();
if (!requestId) throw new Error('Request ID is required before Trello projection');

return [
  { json: {
    cardId,
    boardId,
    customFieldId: nerdyField.id,
    fieldName: 'Nerdy-Forms_ID',
    idempotencyKey: requestId + ':' + cardId + ':Nerdy-Forms_ID',
    customFieldPayload: { value: { text: requestId } }
  } },
  { json: {
    cardId,
    boardId,
    customFieldId: product1Field.id,
    fieldName: 'Product 1',
    idempotencyKey: requestId + ':' + cardId + ':Product 1:' + optionId,
    customFieldPayload: { idValue: optionId }
  } }
];`;

function getUniqueNode(workflow, name) {
  const nodes = workflow.nodes.filter((node) => node.name === name);
  if (nodes.length !== 1) throw new Error(`Expected exactly one node named ${name}, found ${nodes.length}`);
  return nodes[0];
}

export function patchWorkflow(workflow) {
  const patched = structuredClone(workflow);
  const beforeCount = patched.nodes.length;
  getUniqueNode(patched, GET_FIELDS_NODE).parameters.url = DYNAMIC_BOARD_FIELDS_URL;
  getUniqueNode(patched, PREPARE_FIELDS_NODE).parameters.jsCode = PREPARE_FIELD_DATA_CODE;
  if (patched.nodes.length !== beforeCount) throw new Error("Unexpected node-count change");
  return patched;
}
