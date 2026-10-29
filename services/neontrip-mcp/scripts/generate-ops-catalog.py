"""Generate the fixed Ops operation inventory; review the diff before release."""
import hashlib,json,re
from pathlib import Path
root=Path(__file__).resolve().parents[3]
excluded={
 'customer-records/offers/[offerId]/admin':'Browser-only redirect; use offers_get/editor tools to read and edit the offer directly.',
 'session':'Browser login/logout; not a business action. MCP uses its own authenticated identity.',
 'design/worker/jobs':'Worker lease/claim protocol; use design jobs/generate/queue operator actions.',
 'design/worker/callback':'Provider callback evidence; never fabricate worker completion.',
 'voice-copilot/session':'Browser live-call lifecycle; transcript-enabled sessions require the browser x-voice-session-token. Complete/cancel in the connected Voice Copilot UI. Read records with voice_copilot_transcript_get; this is not phone team registration.',
 'voice-copilot/realtime-session':'WebRTC/SDP audio transport requires a connected microphone client.',
 'voice-copilot/transcription-session':'WebRTC/SDP audio transport and ephemeral credentials; use transcript/session tools for records.',
 'voice-phone':'Physical phone enrollment and browser device cookies; no server-side device impersonation.',
 'voice-phone/token':'Short-lived browser phone credential, not a business record.',
 'voice-phone/calls':'Personal phone device session required; use customer-records/calls for call records.',
 'voice-phone/captures':'Personal phone recording device and consent session required.',
 'voice-phone/incoming':'Personal phone device session required to accept or reject a live call.',
 'voice-phone/mobile':'Personal enrolled mobile device session required.',
 'voice-phone/transfers':'Personal phone device session required for live audio transfer.',
 'voice-phone/ai-handoffs':'Personal phone device session required; voice-platform provides operator queue management.',
 'billing':'Covered by guarded billing_list_cases.',
 'billing/[caseId]':'Covered by guarded billing_get_case.',
 'billing/[caseId]/actions':'Covered by guarded billing action tools; do not bypass fingerprints or notification policy.',
}
excluded_methods={
 'voice-copilot/transcript': {
  'POST':'Browser transcript capture requires x-voice-session-token from the consent-bound live session. Use the connected Voice Copilot UI for capture; GET remains available for stored records. Never fabricate transcripts or bypass session consent.'
 }
}
ops=[];inventory=[]
for p in sorted((root/'src/app/api/ops').rglob('route.ts')):
 s=p.read_text(); rel=str(p.parent.relative_to(root/'src/app/api/ops'))
 methods=re.findall(r'export\s+(?:(?:async\s+)?function\s+|(?:const|let)\s+)(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b',s)
 query=sorted(set(re.findall(r'(?:searchParams|params)\.get\("([^"]+)"\)',s)))
 fields=sorted(set(re.findall(r'\b(?:body|input|b)\.(\w+)',s)))
 actions=sorted(set(re.findall(r'\b(?:body|input|b)\.(?:action|actionKey)\s*===?\s*"([^"]+)"',s)))
 actions=sorted(set(actions+re.findall(r'\b(?:action|actionKey)\s*===?\s*"([^"]+)"',s)))
 # Explicit request interfaces are documentation, not the validation authority.
 types=re.findall(r'type\s+(?:\w*(?:Body|Input))\s*=\s*\{[\s\S]*?\n\};',s)
 row={'source':str(p.relative_to(root)),'sha256':hashlib.sha256(s.encode()).hexdigest(),'methods':methods}
 if rel in excluded:row['coverage']=excluded[rel]
 else:
  row['coverage']='ops_catalog'
  if rel in excluded_methods:row['excludedMethods']=excluded_methods[rel]
  for method in methods:
   if method in excluded_methods.get(rel,{}):continue
   opid=re.sub(r'[^A-Za-z0-9]+','_',rel.replace('[','').replace(']','')).strip('_')+'_'+method.lower()
   ops.append({'id':opid,'path':'/api/ops/'+rel,'method':method,
     'pathParameters':re.findall(r'\[([^]]+)\]',rel),'queryParameters':query,
     'bodyFields':fields if method!='GET' else [],'actionValues':actions if method!='GET' else [],
     'requestTypes':types if method!='GET' else [],
     'source':row['source'],'readOnly':method=='GET' and rel!='company-brain/resolve',
     'notes':'Canonical Ops route validates input and applies its existing role, version, approval, payment and idempotency guards. Non-GET may send messages, publish, create paid jobs or change production state. No automatic retry after an uncertain result.'})
  row['operations']=[x['id'] for x in ops if x['source']==row['source']]
 inventory.append(row)
out={'operations':ops,'coverage':inventory}
(root/'services/neontrip-mcp/src/ops-catalog.generated.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(f'{len(ops)} fixed Ops operations, {len(inventory)} routes accounted for.')
