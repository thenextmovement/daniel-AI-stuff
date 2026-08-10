import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'generated');
fs.mkdirSync(outDir, { recursive: true });

const trelloCredential = { trelloApi: { id: '96DRckmFxj423JUR', name: 'Trello account' } };
const outlookCredential = { microsoftOutlookOAuth2Api: { id: 'CTEmJD5CjYu9hawu', name: 'Microsoft Outlook support@neontrip.de' } };
const code = (id, name, position, jsCode, extra = {}) => ({ id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position, parameters: { jsCode }, ...extra });
const http = (id, name, position, parameters, extra = {}) => ({ id, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.3, position, parameters, credentials: trelloCredential, ...extra });

const buildEmergencyAlert = `
const ctx = $input.first().json || {};
const exec = ctx.execution || {};
const err = exec.error || ctx.error || {};
const raw = [err.message, err.description, err.stack].filter(Boolean).join(' ');
const match = raw.match(/https:\/\/trello\.com\/c\/[A-Za-z0-9_-]+(?:\/[^\s<>"']*)?/i);
const cardUrl = match ? match[0] : 'https://trello.com/b/9QNAfkv4/quentin-neon-signs';
const executionUrl = String(exec.url || '');
const failedNode = String(exec.lastNodeExecuted || err.node?.name || 'Unbekannt');
const errorMessage = String(err.message || err.description || 'Unbekannter Fehler').slice(0, 2000);
function esc(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const body = '<div style="font-family:Arial,sans-serif;line-height:1.5">' +
  '<h2 style="color:#b42318">Quentin Board Vector file uploaded fehlgeschlagen</h2>' +
  '<p><strong>Trello-Karte/Board:</strong> <a href="' + esc(cardUrl) + '">' + esc(cardUrl) + '</a></p>' +
  '<p><strong>Workflow:</strong> ' + esc(ctx.workflow?.name || '') + '<br>' +
  '<strong>Node:</strong> ' + esc(failedNode) + '<br><strong>Fehler:</strong> ' + esc(errorMessage) + '</p>' +
  (executionUrl ? '<p><a href="' + esc(executionUrl) + '">n8n-Ausfuehrung oeffnen</a></p>' : '') +
  '<p>Der unabhaengige Watchdog prueft die Trello-Historie und holt eine fehlende Zielkarte automatisch nach.</p></div>';
return [{ json: { emailTo: 'support@neontrip.de', emailSubject: 'Quentin Board Vector file uploaded fehlgeschlagen', emailHtml: body } }];`;

const errorNodes = [
  { id:'error-trigger', name:'Error Trigger', type:'n8n-nodes-base.errorTrigger', typeVersion:1, position:[0,300], parameters:{} },
  code('build-emergency-alert','Build Emergency Alert',[240,300],buildEmergencyAlert),
  { id:'send-emergency-email', name:'Send Emergency Email', type:'n8n-nodes-base.microsoftOutlook', typeVersion:2, position:[480,300],
    parameters:{resource:'message',operation:'send',toRecipients:'={{ $json.emailTo }}',subject:'={{ $json.emailSubject }}',bodyContent:'={{ $json.emailHtml }}',additionalFields:{bodyContentType:'HTML'}},
    credentials:outlookCredential,retryOnFail:true,maxTries:6,waitBetweenTries:60000,onError:'continueRegularOutput' },
];
const errorConnections = {
  'Error Trigger': { main: [[{node:'Build Emergency Alert',type:'main',index:0}]] },
  'Build Emergency Alert': { main: [[{node:'Send Emergency Email',type:'main',index:0}]] },
};
const errorWorkflow = {
  name:'NEONTRIP Quentin Vector Routing Error Alert v1.0',
  nodes:errorNodes,
  connections:errorConnections,
  settings:{executionOrder:'v1',timezone:'Europe/Berlin',saveDataErrorExecution:'all',saveDataSuccessExecution:'all'},
};

const buildMissingEvents = `
const flatten = name => {
  const value = $(name).first().json;
  const raw = value && typeof value.raw === 'string' ? value.raw : value;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed : [parsed];
};
const moves = flatten('Fetch Quentin List Moves');
const copies = [...flatten('Fetch Management Copies'), ...flatten('Fetch Abdul Copies')];
const now = Date.now();
const delayMs = 5 * 60 * 1000;
const horizonMs = 24 * 60 * 60 * 1000;
const QUENTIN_BOARD = '62bae9b97705e7419ed64593';
const VECTOR_LIST = '6421a75cc602d9d540d59f2d';
const ABDUL_LIST = '6421a72719c7af9056e6d16b';
const QUOTE_LIST = '659ffc4e5f8bffd67fe38265';
function destination(title) {
  const value = String(title || '').toLowerCase().replace(/[‐‑‒–—−_]/g, '-');
  if (/\\b(?:led\\s*-?\\s*neon(?:\\s*-?\\s*flex)?|neon\\s*-?\\s*flex)\\b/i.test(value)) return ABDUL_LIST;
  if (/\\b(?:3d|(?:3d\\s*-?\\s*)?back\\s*-?\\s*lit|(?:3d\\s*-?\\s*)?front\\s*-?\\s*lit|(?:3d\\s*-?\\s*)?non\\s*-?\\s*lit|light\\s*-?\\s*box|ultra\\s*-?\\s*thin\\s+acrylic|neon\\s*-?\\s*halo|full\\s*-?\\s*glow|marquee?)\\b/i.test(value)) return QUOTE_LIST;
  return ABDUL_LIST;
}
const state = $getWorkflowStaticData('global');
state.processing = state.processing && typeof state.processing === 'object' ? state.processing : {};
for (const [key, timestamp] of Object.entries(state.processing)) {
  if (now - Number(timestamp || 0) > 15 * 60 * 1000) delete state.processing[key];
}
const output = [];
const seenCards = new Set();
for (const action of moves.sort((a,b) => Date.parse(b.date || '') - Date.parse(a.date || ''))) {
  const data = action?.data || {};
  const time = Date.parse(action?.date || '');
  if (action?.type !== 'updateCard' || data.board?.id !== QUENTIN_BOARD || data.listAfter?.id !== VECTOR_LIST) continue;
  const cardId = String(data.card?.id || '');
  if (!Number.isFinite(time) || now - time < delayMs || now - time > horizonMs || !action.id || !cardId || seenCards.has(cardId)) continue;
  seenCards.add(cardId);
  const expectedListId = destination(data.card?.name || '');
  const matched = copies.some(copy => copy?.type === 'copyCard' && copy?.data?.cardSource?.id === cardId && copy?.data?.list?.id === expectedListId && Date.parse(copy.date || '') >= time);
  if (matched || state.processing[action.id]) continue;
  state.processing[action.id] = now;
  const key = String(data.card?.shortLink || cardId);
  output.push({json:{eventId:String(action.id),eventDate:String(action.date),cardId,cardName:String(data.card?.name || ''),cardUrl:'https://trello.com/c/' + key,expectedListId} });
}
return output;`;

const prepareFallback = `
const event = $('Build Missing Events').item.json;
const card = $json;
return {json:{...event,cardName:String(card.name || event.cardName),cardUrl:String(card.url || event.cardUrl)} };`;

const recordRescue = `
const event = $('Prepare Fallback Copy').item.json;
const copied = $json;
if (!copied?.id || String(copied.idList || '') !== String(event.expectedListId)) throw new Error('Fallback verification failed for ' + event.cardUrl);
const state = $getWorkflowStaticData('global');
if (state.processing) delete state.processing[event.eventId];
state.rescued = state.rescued && typeof state.rescued === 'object' ? state.rescued : {};
state.rescued[event.eventId] = new Date().toISOString();
function esc(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const body = '<div style="font-family:Arial,sans-serif;line-height:1.5">' +
  '<h2 style="color:#b54708">Quentin-Routing wurde automatisch nachgeholt</h2>' +
  '<p>Fuenf Minuten nach dem Listenwechsel fehlte die erwartete Zielkarte. Der Watchdog hat eine Fallback-Kopie erstellt. Bitte Custom Fields und Preispruefung kontrollieren.</p>' +
  '<p><strong>Quellkarte:</strong> <a href="' + esc(event.cardUrl) + '">' + esc(event.cardUrl) + '</a><br>' +
  '<strong>Zielkarte:</strong> <a href="' + esc(copied.url) + '">' + esc(copied.url) + '</a><br>' +
  '<strong>Trello-Event:</strong> ' + esc(event.eventId) + '</p></div>';
return {json:{...event,copiedCardId:copied.id,copiedCardUrl:copied.url,emailTo:'support@neontrip.de',emailSubject:'Quentin Board Vector file uploaded fehlgeschlagen',emailHtml:body,commentText:'❗ Routing-Watchdog: Die regulaere Zielkarte fehlte und wurde automatisch nachgeholt: ' + copied.url + ' — interne Fehler-E-Mail wurde erstellt.'} };`;

const buildFallbackFailure = `
let event = {};
try { event = $('Prepare Fallback Copy').item.json || {}; } catch (error) {}
if (!event.eventId) {
  try { event = $('Build Missing Events').item.json || {}; } catch (error) {}
}
const state = $getWorkflowStaticData('global');
if (state.processing && event.eventId) delete state.processing[event.eventId];
const message = String($json.error?.message || $json.message || 'Fallback konnte nicht erstellt werden').slice(0, 1800);
function esc(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const cardUrl = String(event.cardUrl || 'https://trello.com/b/9QNAfkv4/quentin-neon-signs');
const body = '<div style="font-family:Arial,sans-serif;line-height:1.5"><h2 style="color:#b42318">Quentin-Routing und Fallback fehlgeschlagen</h2>' +
  '<p><strong>Sofort manuell bearbeiten:</strong> <a href="' + esc(cardUrl) + '">' + esc(cardUrl) + '</a></p>' +
  '<p><strong>Fehler:</strong> ' + esc(message) + '</p></div>';
return {json:{...event,cardUrl,emailTo:'support@neontrip.de',emailSubject:'Quentin Board Vector file uploaded fehlgeschlagen',emailHtml:body,commentText:'❗ Routing-Watchdog fehlgeschlagen. Bitte diese Karte sofort manuell weiterleiten. Fehler: ' + message} };`;

const actionRequest = (id,name,position,boardId,filter) => http(id,name,position,{
  method:'GET',url:'https://api.trello.com/1/boards/' + boardId + '/actions',authentication:'predefinedCredentialType',nodeCredentialType:'trelloApi',
  sendQuery:true,queryParameters:{parameters:[{name:'filter',value:filter},{name:'limit',value:'1000'}]},options:{response:{response:{responseFormat:'text',outputPropertyName:'raw'}},timeout:30000},
},{retryOnFail:true,maxTries:3,waitBetweenTries:5000});

const watchdogNodes = [
  {id:'schedule',name:'Every 2 Minutes',type:'n8n-nodes-base.scheduleTrigger',typeVersion:1.3,position:[0,300],parameters:{rule:{interval:[{field:'cronExpression',expression:'*/2 * * * *'}]}}},
  actionRequest('fetch-moves','Fetch Quentin List Moves',[220,300],'62bae9b97705e7419ed64593','updateCard:idList'),
  actionRequest('fetch-management','Fetch Management Copies',[440,300],'63d10c34105771f01ccf4296','copyCard'),
  actionRequest('fetch-abdul','Fetch Abdul Copies',[660,300],'6421a7000117c14498ccb6d0','copyCard'),
  code('build-missing','Build Missing Events',[880,300],buildMissingEvents),
  http('get-source','Get Missing Source Card',[1100,300],{method:'GET',url:'=https://api.trello.com/1/cards/{{ $json.cardId }}',authentication:'predefinedCredentialType',nodeCredentialType:'trelloApi',sendQuery:true,queryParameters:{parameters:[{name:'fields',value:'id,name,url'}]},options:{timeout:30000}},{retryOnFail:true,maxTries:3,waitBetweenTries:5000,onError:'continueErrorOutput'}),
  code('prepare-fallback','Prepare Fallback Copy',[1320,300],prepareFallback,{parameters:{mode:'runOnceForEachItem',jsCode:prepareFallback}}),
  http('copy-fallback','Copy Missing Card',[1540,300],{method:'POST',url:'https://api.trello.com/1/cards',authentication:'predefinedCredentialType',nodeCredentialType:'trelloApi',sendBody:true,specifyBody:'json',jsonBody:"={{ JSON.stringify({ idList: $json.expectedListId, idCardSource: $json.cardId, keepFromSource: 'all', pos: 'bottom' }) }}",options:{timeout:30000}},{retryOnFail:true,maxTries:3,waitBetweenTries:5000,onError:'continueErrorOutput'}),
  http('verify-fallback','Verify Fallback Card',[1760,300],{method:'GET',url:'=https://api.trello.com/1/cards/{{ $json.id }}',authentication:'predefinedCredentialType',nodeCredentialType:'trelloApi',sendQuery:true,queryParameters:{parameters:[{name:'fields',value:'id,name,url,idList'}]},options:{timeout:30000}},{retryOnFail:true,maxTries:3,waitBetweenTries:5000,onError:'continueErrorOutput'}),
  code('record-rescue','Record Rescue and Alert',[1980,300],recordRescue,{parameters:{mode:'runOnceForEachItem',jsCode:recordRescue}}),
  code('build-failure','Build Fallback Failure Alert',[1980,560],buildFallbackFailure,{parameters:{mode:'runOnceForEachItem',jsCode:buildFallbackFailure}}),
  {id:'send-watchdog-email',name:'Send Watchdog Email',type:'n8n-nodes-base.microsoftOutlook',typeVersion:2,position:[2220,260],parameters:{resource:'message',operation:'send',toRecipients:'={{ $json.emailTo }}',subject:'={{ $json.emailSubject }}',bodyContent:'={{ $json.emailHtml }}',additionalFields:{bodyContentType:'HTML'}},credentials:outlookCredential,retryOnFail:true,maxTries:6,waitBetweenTries:60000,onError:'continueRegularOutput'},
  http('comment-source','Comment Source Card',[2220,420],{method:'POST',url:'=https://api.trello.com/1/cards/{{ $json.cardId }}/actions/comments',authentication:'predefinedCredentialType',nodeCredentialType:'trelloApi',sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify({ text: $json.commentText }) }}',options:{timeout:30000}},{retryOnFail:true,maxTries:3,waitBetweenTries:3000,onError:'continueRegularOutput'}),
];

const watchdogConnections = {
  'Every 2 Minutes':{main:[[{node:'Fetch Quentin List Moves',type:'main',index:0}]]},
  'Fetch Quentin List Moves':{main:[[{node:'Fetch Management Copies',type:'main',index:0}]]},
  'Fetch Management Copies':{main:[[{node:'Fetch Abdul Copies',type:'main',index:0}]]},
  'Fetch Abdul Copies':{main:[[{node:'Build Missing Events',type:'main',index:0}]]},
  'Build Missing Events':{main:[[{node:'Get Missing Source Card',type:'main',index:0}]]},
  'Get Missing Source Card':{main:[[{node:'Prepare Fallback Copy',type:'main',index:0}],[{node:'Build Fallback Failure Alert',type:'main',index:0}]]},
  'Prepare Fallback Copy':{main:[[{node:'Copy Missing Card',type:'main',index:0}]]},
  'Copy Missing Card':{main:[[{node:'Verify Fallback Card',type:'main',index:0}],[{node:'Build Fallback Failure Alert',type:'main',index:0}]]},
  'Verify Fallback Card':{main:[[{node:'Record Rescue and Alert',type:'main',index:0}],[{node:'Build Fallback Failure Alert',type:'main',index:0}]]},
  'Record Rescue and Alert':{main:[[{node:'Send Watchdog Email',type:'main',index:0},{node:'Comment Source Card',type:'main',index:0}]]},
  'Build Fallback Failure Alert':{main:[[{node:'Send Watchdog Email',type:'main',index:0},{node:'Comment Source Card',type:'main',index:0}]]},
};
const watchdogWorkflow = {
  name:'NEONTRIP Quentin Vector Routing Watchdog v1.0',
  nodes:watchdogNodes,
  connections:watchdogConnections,
  settings:{executionOrder:'v1',timezone:'Europe/Berlin',saveDataErrorExecution:'all',saveDataSuccessExecution:'all',saveExecutionProgress:true,executionTimeout:600},
};

fs.writeFileSync(path.join(outDir,'quentin-vector-routing-error-alert-v1.json'),JSON.stringify(errorWorkflow,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'quentin-vector-routing-watchdog-v1.json'),JSON.stringify(watchdogWorkflow,null,2)+'\n');
console.log('Generated error alert (' + errorNodes.length + ' nodes) and watchdog (' + watchdogNodes.length + ' nodes)');
