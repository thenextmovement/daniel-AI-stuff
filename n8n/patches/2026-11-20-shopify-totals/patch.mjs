import { readFileSync } from 'node:fs';
// Pass a freshly fetched workflow; credential references are inherited, never exported.
export function buildOperations(workflow) {
 if(workflow.id !== 'm6VJ0hvDT7I40xy0') throw Error('Wrong workflow');
 const audit=workflow.nodes.find(n=>n.name==='Record Verified Sync');
 const node=structuredClone(audit);
 node.id='refresh-shopify-customer-totals';node.name='Refresh Verified Customer Totals';
 node.position=[audit.position[0]+260,audit.position[1]];
 node.parameters.url='https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/refresh_shopify_customer_totals_v1';
 node.parameters.headerParameters.parameters=node.parameters.headerParameters.parameters.filter(h=>h.name!=='Prefer');
 node.parameters.jsonBody="={{ JSON.stringify({ p_observed_at: $('Verify Mirror Write').first().json.metadata.observed_at, p_expected_count: $('Verify Mirror Write').first().json.metadata.source_count }) }}";
 return [
 {type:'updateNode',nodeId:'map',updates:{'parameters.jsCode':readFileSync(new URL('./mapping.js',import.meta.url),'utf8')}},
 {type:'addNode',node},
 {type:'addConnection',source:audit.name,target:node.name}
 ];
}
