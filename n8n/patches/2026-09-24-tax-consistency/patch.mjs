import {readFileSync,writeFileSync} from 'node:fs';
export function patchFixture(input) {
 const result=structuredClone(input);
 const createBefore='  taxes_included: !taxExempt,\n  tax_lines:';
 const createAfter='  taxes_included: !taxExempt,\n  total_tax: (totalsCents.vatAmount / 100).toFixed(2),\n  tax_lines:';
 const syncBefore='total_tax: Number(order.total_tax) || 0,';
 const syncAfter='total_tax: Number(order.current_total_tax ?? order.total_tax) || 0,';
 for(const [key,before,after] of [['create',createBefore,createAfter],['sync',syncBefore,syncAfter]]) {
   if(result[key].split(before).length!==2)throw new Error('Unexpected live node state: '+key);
   result[key]=result[key].replace(before,after);
 }
 return result;
}
if(process.argv[2]&&process.argv[3]) writeFileSync(process.argv[3],JSON.stringify(patchFixture(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));
