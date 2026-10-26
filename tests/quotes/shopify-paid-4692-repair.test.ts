import {execFileSync} from "node:child_process";
import {test} from "node:test";
test("Shopify #4692 repair guards and scoped workflow patch",()=>{
 execFileSync(process.execPath,["--test","workflows/billing-v2/shopify-4692-repair/shopify-repair.test.mjs","workflows/billing-v2/shopify-4692-repair/patch-workflow.test.mjs"],{cwd:process.cwd(),stdio:"pipe"});
});
