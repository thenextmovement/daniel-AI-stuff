const fs=require('node:fs'), assert=require('node:assert/strict');
const code=fs.readFileSync(process.argv[2]||__dirname+'/validate-and-gate.js','utf8');
function run(desc, options={}) {
 const decision={product_type:'Unknown',line_style:'unclear',factory_instructions:[],quote_split_recommended:false,quote_count:1,customer_text_empty_or_trivial:true,simple_case:false,contradiction:false,hard_blockers:['Product requires human clarification'],confidence:{overall:25,product_type:30,line_style:20,requirements_completeness:20},mockup_setting:'Example Cookies – Cookie-Stores; modern und lebendig.',mockup_setting_confidence:98,mockup_setting_evidence:['Original logo'],...options.decision};
 const source={approval:{correlation_id:'fixture',previous_change_log:[]},card:{id:'fixture',name:options.name||'Example Customer | manuelle Anfrage',desc,customFieldItems:[],idLabels:[]},attachment_count:options.attachments??2,unreadable_files:[],read_files:['logo.png'],body:{}};
 const result=new Function('$input','$',code)({first:()=>({json:{output_text:JSON.stringify(decision)}})},()=>({isExecuted:true,first:()=>({json:source})}))[0].json;
 return result;
}
let count=0,failed=0;
function test(name, f){count++;try{f();console.log('PASS '+name)}catch(e){failed++;console.log('FAIL '+name+': '+e.message)}}
const size=r=>(r.new_desc.match(/^Size:[ \t]*([^\r\n]*)/im)||[])[1];
test('manual request without size completes and keeps business blockers',()=>{const d='Customer notes stay intact.\nRequest-ID: fixture';const r=run(d);assert.equal(size(r),'As Logo');assert.ok(r.new_desc.includes(d));assert.equal(r.auto_eligible,false);assert.ok(r.hard_blockers.includes('Product requires human clarification'));assert.equal(r.band,'UNDER_80');});
test('empty size preserves the next field',()=>{const r=run('Size:\nColor: Warm White\nNachricht: Original text');assert.equal(size(r),'As Logo');assert.ok(r.new_desc.includes('Color: Warm White'));assert.ok(r.new_desc.includes('Nachricht: Original text'));});
test('blank size preserves CRLF following fields',()=>{const r=run('Size: \t\r\nColor: RGB\r\nBackboard: Clear');assert.equal(size(r),'As Logo');assert.ok(r.new_desc.includes('Color: RGB\r\nBackboard: Clear'));});
test('existing regular size is replaced once',()=>{const r=run('Size: 40cm+60cm\nColor: Red');assert.equal(size(r),'As Logo');assert.equal((r.new_desc.match(/^Size:/gim)||[]).length,1);assert.ok(r.new_desc.includes('Color: Red'));});
test('missing size without attachment follows smallest-size policy',()=>assert.equal(size(run('Notes', {attachments:0})),'Smallest Size'));
test('explicit customer size kept with attachments',()=>assert.equal(size(run('Angefragte Größe: 120 cm\nNachricht: Bitte 120 cm breit.')),'Smallest Size + 120cm'));
test('3D request uses exact requested size',()=>assert.equal(size(run('Angefragte Größe: 120 cm\nSize: old\nColor: Red',{decision:{product_type:'3D Frontlit',line_style:'not applicable'}})),'120cm'));
test('budget route keeps 40+50+customer formula without size line',()=>assert.equal(size(run('Angefragte Größe: 80 cm',{decision:{product_type:'LED Neon Flex',line_style:'single line',budget_route_recommended:true,budget_route_confidence:99,budget_evidence:['Private wedding','low budget']}})),'40cm+50cm+80cm'));
test('empty description completes safely',()=>assert.equal(size(run('')),'As Logo'));
test('key customer marker survives',()=>assert.ok(run('Notes',{name:'KEY KUNDE | Example Customer | manuelle Anfrage'}).new_name.startsWith('KEY KUNDE | ')));
test('reprocessing does not duplicate size',()=>{const first=run('Notes');const second=run(first.new_desc,{name:first.new_name});assert.equal((second.new_desc.match(/^Size:/gim)||[]).length,1);assert.equal(size(second),'As Logo');});
test('invalid product still stops processing',()=>assert.throws(()=>run('Size: 40cm',{decision:{product_type:'Invalid'}}),/Invalid product or line style/));
console.log(JSON.stringify({tests:count,passed:count-failed,failed}));
process.exitCode=failed?1:0;
