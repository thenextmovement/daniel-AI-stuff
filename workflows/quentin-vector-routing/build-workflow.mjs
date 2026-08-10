import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'generated');
fs.mkdirSync(outDir, { recursive: true });

const trelloCredential = { trelloApi: { id: '96DRckmFxj423JUR', name: 'Trello account' } };
const openAiCredential = { openAiApi: { id: 'StsVoyuEzSmCM5jg', name: 'OpenAi account' } };
const code = (id, name, position, jsCode) => ({ id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position, parameters: { jsCode } });
const http = (id, name, position, parameters, credentials = trelloCredential, extra = {}) => ({
  id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.3, position, parameters, credentials, ...extra,
});

const gateCode = `
const event = $json.action || $json;
const eventId = String(event.id || $json.id || '');
const type = String(event.type || '');
const data = event.data || {};
const boardId = String(data.board?.id || data.card?.idBoard || '');
const listAfterId = String(data.listAfter?.id || '');
if (!eventId || type !== 'updateCard' || boardId !== '62bae9b97705e7419ed64593' || listAfterId !== '6421a75cc602d9d540d59f2d') return [];
const sd = $getWorkflowStaticData('global');
const doneKey = 'done_' + eventId;
const processingKey = 'processing_' + eventId;
if (sd[doneKey]) return [];
const now = Date.now();
if (sd[processingKey] && now - Number(sd[processingKey]) < 15 * 60 * 1000) return [];
sd[processingKey] = now;
return [{ json: { eventId, cardId: String(data.card?.id || ''), sourceBoardId: boardId, sourceListId: listAfterId } }];`;

const prepareCode = `
const card = $json;
const event = $('Gate Exact Vector Event').first().json;
function classifyTitle(title) {
  const value = String(title || '').toLowerCase().replace(/[‐‑‒–—−_]/g, '-');
  if (/\\b(?:led\\s*-?\\s*neon(?:\\s*-?\\s*flex)?|neon\\s*-?\\s*flex)\\b/i.test(value)) return { kind: 'led-neon-flex', destinationListId: '6421a72719c7af9056e6d16b', known: true };
  const rules = [
    ['3d-backlit', /\\b3d\\s*-?\\s*back\\s*-?\\s*lit\\b/i], ['3d-frontlit', /\\b3d\\s*-?\\s*front\\s*-?\\s*lit\\b/i],
    ['3d-nonlit', /\\b3d\\s*-?\\s*non\\s*-?\\s*lit\\b/i], ['lightbox', /\\blight\\s*-?\\s*box\\b/i],
    ['ultra-thin-acrylic', /\\bultra\\s*-?\\s*thin\\s+acrylic\\b/i], ['neon-halo', /\\bneon\\s*-?\\s*halo\\b/i],
    ['full-glow', /\\bfull\\s*-?\\s*glow\\b/i], ['marquee', /\\bmarquee\\b/i],
  ];
  const found = rules.find(([, regex]) => regex.test(value));
  return { kind: found ? found[0] : 'unknown-non-neon', destinationListId: '659ffc4e5f8bffd67fe38265', known: Boolean(found) };
}
const route = classifyTitle(card.name);
const attachments = Array.isArray(card.attachments) ? card.attachments : [];
const image = attachments.filter(a => /^image\\.png$/i.test(String(a.name || '').trim())).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))[0] || null;
const fieldValues = Object.fromEntries((card.customFieldItems || []).map(item => [item.idCustomField, item.value?.text ?? item.value?.number ?? '']));
return [{ json: { ...event, cardId: card.id, cardName: card.name || '', cardUrl: card.url || '', route, imageUrl: image?.url || '', imageAttachmentId: image?.id || '', fieldValues } }];`;

const visionBodyCode = `
const ctx = $('Prepare Card Context').first().json;
let dataUrl = '';
try {
  const buffer = await $getBinaryDataBuffer(0, 'image');
  if (buffer?.length) dataUrl = 'data:image/png;base64,' + buffer.toString('base64');
} catch (error) {}
const prompt = [
  'Read this supplier technical drawing. Return strict JSON only.',
  'Identify every product/size variant, maximum four. Preserve visual reading order: design groups top-to-bottom and left-to-right; variants inside each group left-to-right/top-to-bottom.',
  'For each variant return: reading_order (1-based integer), design_index (1-based integer), size_index (1-based within design), total (number or null), backboard_raw (exact English phrase or empty), confidence (0..1).',
  'The price to extract is Total, never Production Price and never Shipping cost.',
  'Do not invent unreadable values. issues must list uncertainties.',
  'Schema: {"variants":[{"reading_order":1,"design_index":1,"size_index":1,"total":117,"backboard_raw":"Cut to shape","confidence":0.99}],"issues":[]}'
].join('\\n');
const body = {
  model: 'gpt-4o', temperature: 0,
  response_format: { type: 'json_object' },
  messages: [{ role: 'user', content: dataUrl ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }] : [{ type: 'text', text: prompt + '\\nNo image was available; return empty variants and an issue.' }] }]
};
return [{ json: { ...ctx, body } }];`;

const planCode = `
const ctx = $('Prepare Card Context').first().json;
const BACKBOARD_IDS = ['67ab34664610ec7a48dd3e25','67ab34753b38d5d627c00406','67f4f919135f6ee95dcfafc1','67f4f96efd792feaa9b0c1df'];
const PRICE_IDS = ['67ab4036913a9ecdc0cb3a30','67ab404384a17910e9673e48','67f4f8f054ff1b3f888c0228','67f4f933dd18fd2f77bf8708'];
function translate(raw, kind) {
  const value = String(raw || '').toLowerCase().trim().replace(/[‐‑‒–—−_]/g, ' ');
  if (kind === 'led-neon-flex') {
    if (/cut\\s*to\\s*shape|shape\\s*cut/.test(value)) return { value: 'Formzuschnitt' };
    if (/cut\\s*to\\s*(?:letter|letters)|fine\\s*cut/.test(value)) return { value: 'Feinzuschnitt' };
    if (/cut\\s*to\\s*(?:board|rectangle)|rectangular\\s*cut/.test(value)) return { value: 'Rechteckiger Zuschnitt' };
    return { value: '' };
  }
  return { value: /loose\\s*letters?/.test(value) ? 'Einzelne Buchstaben' : '' };
}
function money(value) {
  if (value === null || value === undefined || value === '') return { value: null };
  const number = Number(String(value).replace(/[^0-9,.-]/g, '').replace(',', '.'));
  return { value: Number.isFinite(number) ? Math.round(number * 100) / 100 : null };
}
let proposal = { variants: [], issues: [] };
const warnings = [];
try {
  const raw = $json.choices?.[0]?.message?.content;
  proposal = JSON.parse(String(raw || '{}'));
} catch (error) { warnings.push('image.png konnte nicht zuverlässig ausgewertet werden'); }
let variants = Array.isArray(proposal.variants) ? proposal.variants : [];
variants = variants.filter(v => Number.isInteger(Number(v.reading_order)) && Number(v.reading_order) >= 1).sort((a,b) => Number(a.reading_order)-Number(b.reading_order));
if (!ctx.imageUrl) warnings.push('image.png fehlt');
if (!variants.length) warnings.push('keine sicher zuordenbare Variante aus image.png');
if (variants.length > 4) warnings.push((variants.length - 4) + ' weitere Variante(n) passen nicht in die vier Trello-Felder');
if (Array.isArray(proposal.issues)) {
  for (const issue of proposal.issues) {
    const text = String(issue || '').trim();
    if (text) warnings.push(text);
  }
}
const fieldOps = [];
let mismatch = false;
for (let index = 0; index < 4; index += 1) {
  const variant = variants[index];
  const value = variant ? translate(variant.backboard_raw, ctx.route.kind).value : '';
  if (variant && !value) warnings.push('Backboard_' + (index + 1) + ' konnte nicht sicher ausgelesen werden');
  fieldOps.push({ fieldId: BACKBOARD_IDS[index], value });
  if (variant && money(variant.total).value !== null) {
    const current = money(ctx.fieldValues[PRICE_IDS[index]]).value;
    if (current === null || Math.abs(current - money(variant.total).value) > 0.009) mismatch = true;
  } else if (variant) warnings.push('Total für Price_' + (index + 1) + ' konnte nicht sicher ausgelesen werden');
}
if (!ctx.route.known) warnings.push('Produkttyp im Titel nicht eindeutig; sicherheitshalber direkt zu Quote Ready geroutet');
if (ctx.route.kind !== 'led-neon-flex' && !variants.length) warnings.push('Neon-Zuschnittswerte wurden bei einem Nicht-Neon-Produkt entfernt');
const suffix = 'Custom Fields Abweichung❗';
const newTitle = mismatch && !ctx.cardName.includes(suffix) ? ctx.cardName + ' ' + suffix : ctx.cardName;
const uniqueWarnings = [];
for (const warning of warnings) {
  const text = String(warning || '').trim();
  if (text && !uniqueWarnings.includes(text)) uniqueWarnings.push(text);
}
const output = [];
for (const op of fieldOps) output.push({ json: { ...ctx, ...op, mismatch, newTitle, warnings: uniqueWarnings } });
return output;`;

const finalizeCode = `
const plan = $('Plan Safe Field Operations').first().json;
const failedFields = $input.all().filter(item => item.json?.error).length;
const warnings = [...(plan.warnings || [])];
if (failedFields) warnings.push(failedFields + ' Backboard-Feld(er) konnten technisch nicht aktualisiert werden');
const unique = [...new Set(warnings)];
return [{ json: { ...plan, warnings: unique, needsComment: unique.length > 0, commentText: '❗ TICKET-103 [' + plan.eventId + '] ' + unique.join('; ') } }];`;

const completeCode = `
const plan = $('Finalize Advisory Results').first().json;
const copied = $json;
if (!copied?.id || String(copied.idList || '') !== String(plan.route.destinationListId)) throw new Error('Copied card verification failed');
const sd = $getWorkflowStaticData('global');
sd['done_' + plan.eventId] = new Date().toISOString();
delete sd['processing_' + plan.eventId];
return [{ json: { status: 'routed', eventId: plan.eventId, sourceCardId: plan.cardId, copiedCardId: copied.id, copiedCardUrl: copied.url, destinationListId: copied.idList, warnings: plan.warnings } }];`;

const nodes = [
  { id: 'trigger', name: 'Quentin Board Trigger', type: 'n8n-nodes-base.trelloTrigger', typeVersion: 1, position: [0,300], parameters: { id: '62bae9b97705e7419ed64593' }, credentials: trelloCredential },
  code('gate','Gate Exact Vector Event',[220,300],gateCode),
  http('get-card','Get Source Card',[440,300],{ method:'GET', url:"=https://api.trello.com/1/cards/{{ $json.cardId }}", authentication:'predefinedCredentialType', nodeCredentialType:'trelloApi', sendQuery:true, queryParameters:{parameters:[{name:'fields',value:'id,name,url,idBoard,idList'},{name:'attachments',value:'true'},{name:'attachment_fields',value:'id,name,mimeType,date,url'},{name:'customFieldItems',value:'true'}]}, options:{timeout:30000} },trelloCredential,{retryOnFail:true,maxTries:3,waitBetweenTries:5000}),
  code('prepare','Prepare Card Context',[660,300],prepareCode),
  http('download','Download image.png',[880,300],{ method:'GET', url:"={{ $json.imageUrl || 'https://api.trello.com/1/cards/' + $json.cardId + '/attachments/not-found/download/image.png' }}", authentication:'predefinedCredentialType', nodeCredentialType:'trelloApi', options:{response:{response:{responseFormat:'file',outputPropertyName:'image'}},timeout:30000} },trelloCredential,{continueOnFail:true,retryOnFail:true,maxTries:2,waitBetweenTries:3000}),
  code('vision-body','Build Vision Proposal',[1100,300],visionBodyCode),
  http('vision','Read Supplier Drawing',[1320,300],{ method:'POST', url:'https://api.openai.com/v1/chat/completions', authentication:'predefinedCredentialType', nodeCredentialType:'openAiApi', sendHeaders:true, headerParameters:{parameters:[{name:'Content-Type',value:'application/json'}]}, sendBody:true, specifyBody:'json', jsonBody:'={{ JSON.stringify($json.body) }}', options:{timeout:60000} },openAiCredential,{continueOnFail:true,retryOnFail:true,maxTries:2,waitBetweenTries:5000}),
  code('plan','Plan Safe Field Operations',[1540,300],planCode),
  http('update-fields','Update Backboard Fields',[1760,300],{ method:'PUT', url:"=https://api.trello.com/1/cards/{{ $json.cardId }}/customField/{{ $json.fieldId }}/item", authentication:'predefinedCredentialType', nodeCredentialType:'trelloApi', sendBody:true, specifyBody:'json', jsonBody:'={{ JSON.stringify({ value: $json.value ? { text: $json.value } : null }) }}', options:{timeout:30000} },trelloCredential,{continueOnFail:true,retryOnFail:true,maxTries:3,waitBetweenTries:3000}),
  code('finalize','Finalize Advisory Results',[1980,300],finalizeCode),
  http('title','Set Price Deviation Title',[2200,300],{ method:'PUT', url:"=https://api.trello.com/1/cards/{{ $json.cardId }}", authentication:'predefinedCredentialType', nodeCredentialType:'trelloApi', sendBody:true, specifyBody:'json', jsonBody:'={{ JSON.stringify({ name: $json.newTitle }) }}', options:{timeout:30000} },trelloCredential,{continueOnFail:true,retryOnFail:true,maxTries:3,waitBetweenTries:3000}),
  { id:'if-comment', name:'Warning Comment Needed?', type:'n8n-nodes-base.if', typeVersion:2.3, position:[2420,300], parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:'warn',leftValue:"={{ $('Finalize Advisory Results').first().json.needsComment }}",rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}},
  http('comment','Add One Warning Comment',[2640,200],{ method:'POST', url:"=https://api.trello.com/1/cards/{{ $('Finalize Advisory Results').first().json.cardId }}/actions/comments", authentication:'predefinedCredentialType', nodeCredentialType:'trelloApi', sendBody:true, specifyBody:'json', jsonBody:"={{ JSON.stringify({ text: $('Finalize Advisory Results').first().json.commentText }) }}", options:{timeout:30000} },trelloCredential,{continueOnFail:true,retryOnFail:true,maxTries:3,waitBetweenTries:3000}),
  http('copy','Copy Normalized Card Once',[2860,300],{ method:'POST', url:'https://api.trello.com/1/cards', authentication:'predefinedCredentialType', nodeCredentialType:'trelloApi', sendBody:true, specifyBody:'json', jsonBody:"={{ JSON.stringify({ idList: $('Finalize Advisory Results').first().json.route.destinationListId, idCardSource: $('Finalize Advisory Results').first().json.cardId, keepFromSource: 'all', pos: 'bottom' }) }}", options:{timeout:30000} },trelloCredential,{retryOnFail:true,maxTries:3,waitBetweenTries:5000}),
  http('verify','Verify Copied Card',[3080,300],{ method:'GET', url:'=https://api.trello.com/1/cards/{{ $json.id }}', authentication:'predefinedCredentialType', nodeCredentialType:'trelloApi', sendQuery:true, queryParameters:{parameters:[{name:'fields',value:'id,name,url,idBoard,idList'}]}, options:{timeout:30000} },trelloCredential,{retryOnFail:true,maxTries:3,waitBetweenTries:5000}),
  code('complete','Record Completed Event',[3300,300],completeCode),
];

const connections = {
  'Quentin Board Trigger': { main: [[{ node:'Gate Exact Vector Event', type:'main', index:0 }]] },
  'Gate Exact Vector Event': { main: [[{ node:'Get Source Card', type:'main', index:0 }]] },
  'Get Source Card': { main: [[{ node:'Prepare Card Context', type:'main', index:0 }]] },
  'Prepare Card Context': { main: [[{ node:'Download image.png', type:'main', index:0 }]] },
  'Download image.png': { main: [[{ node:'Build Vision Proposal', type:'main', index:0 }]] },
  'Build Vision Proposal': { main: [[{ node:'Read Supplier Drawing', type:'main', index:0 }]] },
  'Read Supplier Drawing': { main: [[{ node:'Plan Safe Field Operations', type:'main', index:0 }]] },
  'Plan Safe Field Operations': { main: [[{ node:'Update Backboard Fields', type:'main', index:0 }]] },
  'Update Backboard Fields': { main: [[{ node:'Finalize Advisory Results', type:'main', index:0 }]] },
  'Finalize Advisory Results': { main: [[{ node:'Set Price Deviation Title', type:'main', index:0 }]] },
  'Set Price Deviation Title': { main: [[{ node:'Warning Comment Needed?', type:'main', index:0 }]] },
  'Warning Comment Needed?': { main: [[{ node:'Add One Warning Comment', type:'main', index:0 }],[{ node:'Copy Normalized Card Once', type:'main', index:0 }]] },
  'Add One Warning Comment': { main: [[{ node:'Copy Normalized Card Once', type:'main', index:0 }]] },
  'Copy Normalized Card Once': { main: [[{ node:'Verify Copied Card', type:'main', index:0 }]] },
  'Verify Copied Card': { main: [[{ node:'Record Completed Event', type:'main', index:0 }]] },
};

const workflow = { name:'NEONTRIP Quentin Vector Normalize + Route v1.0', nodes, connections, settings:{ executionOrder:'v1', timezone:'Europe/Berlin', saveDataErrorExecution:'all', saveDataSuccessExecution:'all', saveExecutionProgress:true, executionTimeout:180 } };
fs.writeFileSync(path.join(outDir, 'quentin-vector-normalize-route-v1.json'), JSON.stringify(workflow, null, 2) + '\n');
console.log(`Generated ${nodes.length} nodes`);
