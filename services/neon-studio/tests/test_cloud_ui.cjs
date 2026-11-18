const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/cloud.js'),'utf8');
const code=source.slice(source.indexOf('async function cloudPoll()'),source.indexOf('function cloudPriceControls()'));
const ctx={cloud:{id:'test'},designNumber:1,state:{settings:{width:2180,hiddenPaths:['double:16']},drawing:{width:2180}},cloudSpec:{widths_mm:[2180]},sizesDirty:false,cloudSaving:false,defaults:{},setTimeout:f=>f(),cloudRequest:async()=>({id:'test',status:'ready',settings:{width:1270,hiddenPaths:['double:16']},spec:{widths_mm:[1270]}}),showSizeFields(){},renderReview(){},cloudLabel(){},commitHistory(){},updateControls(){},invalidateManufacturing(){},checkManufacturing:async()=>{},requestGeometry:async()=>{ctx.state.drawing.width=ctx.state.settings.width;},toast(){}};
vm.createContext(ctx);vm.runInContext(code,ctx);
ctx.cloudPoll().then(()=>{assert.equal(ctx.state.drawing.width,1270);assert.deepEqual(ctx.state.settings.hiddenPaths,['double:16']);console.log('Upload preview uses confirmed dimensions and preserves hidden paths');}).catch(e=>{console.error(e);process.exitCode=1});
