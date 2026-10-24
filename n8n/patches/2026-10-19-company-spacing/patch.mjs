import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function patchCode(source) {
 const edits=[
  ["function bestIdentityMatch(order) {","function bestIdentityMatch(order, allowCompanySpacing = false) {"],
  ["          type = 'EXACT_NORMALIZED';\n        } else {",`          type = 'EXACT_NORMALIZED';
        } else if (
          allowCompanySpacing &&
          entry.field.endsWith('_company') &&
          payerTokens.join('').length >= 6 &&
          payerTokens.join('') === targetTokens.join('')
        ) {
          // Exact company spelling; only word separators differ.
          score = 100;
          type = 'EXACT_COMPANY_COMPACT';
        } else {`],
  ["primaryIdentity = bestIdentityMatch(primary);","primaryIdentity = bestIdentityMatch(primary, prevData?.fuzzyMatch === false);"]
 ];
 for(const [before,after] of edits) {
  if(source.split(before).length!==2) throw new Error('Affected source changed; review before applying');
  source=source.replace(before,after);
 }
 return source;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 if(!process.argv[2]||!process.argv[3]) throw new Error('Usage: node patch.mjs input-node.js output-node.js');
 writeFileSync(process.argv[3],patchCode(readFileSync(process.argv[2],'utf8')));
}
