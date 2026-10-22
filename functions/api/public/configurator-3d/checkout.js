import {parseCheckout3DRequest,blockedCheckout3D} from '../../../../deploy/3d-konfigurator/checkout-contract.js';

const LIMIT=128_000;
const json=(body,status)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export async function onRequest({request}){
 if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return json({error:{code:'INVALID_CONTENT_TYPE'}},415);
 if(Number(request.headers.get('content-length'))>LIMIT)return json({error:{code:'PAYLOAD_TOO_LARGE'}},413);
 const reader=request.body?.getReader();if(!reader)return json({error:{code:'INVALID_3D_CART'}},400);
 let size=0;const chunks=[];
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();return json({error:{code:'PAYLOAD_TOO_LARGE'}},413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  parseCheckout3DRequest(JSON.parse(new TextDecoder().decode(bytes)));
 }catch{return json({error:{code:'INVALID_3D_CART'}},400);}
 // No provider adapter, database writes, credentials or feature flag here.
 return json(blockedCheckout3D(),409);
}
