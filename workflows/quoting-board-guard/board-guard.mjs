export const WORKFLOW_ID = 'EtEpzMp10EmaqXIS';
export const ALERT_WORKFLOW_ID = 'ArT3LN25Mb1PAuBE';

export function guardCode(failure = false) {
  const source = failure ? 'Prepare Description Failure Status' : 'Select Eligible Candidate';
  return `const candidate=$('${source}').first().json||{};
const response=$input.first().json;
const live=response?.body;
const cardId=String(candidate.card_id||'');
const context=${failure ? "': '+String(candidate.failure_message||'Unknown original failure').slice(0,240)" : "''"};
if(response?.statusCode!==200||!/^[a-f0-9]{24}$/.test(cardId)||!live||Array.isArray(live)||live.id!==cardId||typeof live.idBoard!=='string'||typeof live.idList!=='string'||typeof live.closed!=='boolean'){
  throw new Error('QUOTE_CARD_CONTEXT_UNCONFIRMED '+cardId+context);
}
if(live.closed||live.idBoard!=='63d10c34105771f01ccf4296'||live.idList!=='64ca588f8bd547afc087a6ea'){
  throw new Error('QUOTE_CARD_MOVED_OR_CLOSED '+cardId+context);
}
return [{json:candidate,pairedItem:{item:0}}];`;
}

export function patchWorkflow(input) {
  if(input.id!==WORKFLOW_ID)throw new Error('Unexpected quoting workflow');
  if(input.settings?.errorWorkflow && input.settings.errorWorkflow!==ALERT_WORKFLOW_ID)throw new Error('Existing alert route differs');
  const w=structuredClone(input);
  const get=(id,name)=>{
    const found=w.nodes.filter(n=>n.id===id&&n.name===name);
    if(found.length!==1)throw new Error('Expected node missing or ambiguous: '+name);
    return found[0];
  };
  get('candidate','Select Eligible Candidate');
  get('description-failure-status-prepare','Prepare Description Failure Status');
  get('description-processing-label-remove-failure','Trello: Remove Description Processing Label on Failure');
  const clear=get('description-failed-label-clear','Trello: Clear Description Failed Label');
  const add=get('description-processing-label-add','Trello: Add Description Processing Label');
  if(!clear.credentials?.trelloApi?.id||add.onError!=='continueErrorOutput'||add.alwaysOutputData!==true)throw new Error('Label-path baseline differs');
  const specs=[
    ['initial','Select Eligible Candidate','Trello: Read Initial Label Context','Guard Initial Label Context','Trello: Clear Description Failed Label',[700,-400],false],
    ['failure','Prepare Description Failure Status','Trello: Read Failure Label Context','Guard Failure Label Context','Trello: Remove Description Processing Label on Failure',[2240,864],true],
  ];
  for(const [key,from,readName,guardName,to,pos,failure] of specs){
    const expected={main:[[{node:to,type:'main',index:0}]]};
    if(JSON.stringify(w.connections[from])!==JSON.stringify(expected))throw new Error('Unexpected outgoing edge: '+from);
    const readId='quote-'+key+'-label-context-read',guardId='quote-'+key+'-label-context-guard';
    if(w.nodes.some(n=>[readId,guardId].includes(n.id)||[readName,guardName].includes(n.name)))throw new Error('Guard already exists');
    w.nodes.push({
      id:readId,name:readName,type:'n8n-nodes-base.httpRequest',typeVersion:4.3,position:pos,
      parameters:{method:'GET',url:"=https://api.trello.com/1/cards/{{ $('"+from+"').first().json.card_id }}",
        authentication:'predefinedCredentialType',nodeCredentialType:'trelloApi',sendQuery:true,
        queryParameters:{parameters:[{name:'fields',value:'id,idBoard,idList,closed'}]},
        options:{response:{response:{responseFormat:'json',fullResponse:true}},timeout:20000}},
      credentials:structuredClone(clear.credentials),retryOnFail:true,maxTries:3,waitBetweenTries:2000,
      // Route a failed GET only to a guard that always throws on unconfirmed data.
      // This preserves the original processing error on the failure branch.
      onError:'continueRegularOutput'
    },{
      id:guardId,name:guardName,type:'n8n-nodes-base.code',typeVersion:2,
      position:[pos[0]+200,pos[1]],parameters:{jsCode:guardCode(failure)}
    });
    w.connections[from]={main:[[{node:readName,type:'main',index:0}]]};
    w.connections[readName]={main:[[{node:guardName,type:'main',index:0}]]};
    w.connections[guardName]={main:[[{node:to,type:'main',index:0}]]};
  }
  add.alwaysOutputData=false;
  w.settings={...w.settings,errorWorkflow:ALERT_WORKFLOW_ID};
  return w;
}
