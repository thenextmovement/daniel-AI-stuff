import {readFileSync,writeFileSync} from 'node:fs';
export function patchWorkflow(workflow) {
 const next=structuredClone(workflow);
 const names=['Validate & Extract','Collective: Route','Collective: Verify Bank'];
 const before=String.raw`(?:^|[^A-Z0-9])R?NEON[-_\s]*T?\s*#?\s*(\d{4})(?![A-Z0-9])`;
 const after=String.raw`(?:^|[^A-Z0-9])(?:PF[-_\s]*)?R?NEON[-_\s]*T?\s*#?\s*(\d{4})(?![A-Z0-9])`;
 for(const name of names) {
   const node=next.nodes.find(n=>n.name===name);
   if(!node || node.parameters.jsCode.split(before).length!==2) throw new Error('Unexpected parser state: '+name);
   node.parameters.jsCode=node.parameters.jsCode.replace(before,after);
   new Function('$input','$',node.parameters.jsCode);
 }
 return next;
}
if(process.argv[2] && process.argv[3]) writeFileSync(process.argv[3],JSON.stringify(patchWorkflow(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));
