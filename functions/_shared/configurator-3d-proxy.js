// Fixed upstream and explicit headers: never proxy arbitrary URLs or cookies.
export async function proxy3D(request,path){
 if(!['drafts','handoff'].includes(path))return new Response(null,{status:404});
 if(!(path==='drafts'?['GET','PUT']:['POST']).includes(request.method))return new Response(null,{status:405});
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)return new Response(null,{status:403});
 const headers=new Headers();
 for(const key of ['authorization','content-type','content-length','cf-connecting-ip'])if(request.headers.has(key))headers.set(key,request.headers.get(key));
 headers.set('Origin','https://anfrage.neontrip.de');
 try{
  const upstream=await fetch('https://angebote.neontrip.de/api/public/configurator-3d/'+path,{method:request.method,headers,body:['PUT','POST'].includes(request.method)?request.body:undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
  const outgoing={'Content-Type':upstream.headers.get('content-type')||'application/json','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
  if(upstream.headers.has('retry-after'))outgoing['Retry-After']=upstream.headers.get('retry-after');
  return new Response(upstream.body,{status:upstream.status,headers:outgoing});
 }catch{return Response.json({error:{code:'STORAGE_UNAVAILABLE'}},{status:503,headers:{'Cache-Control':'no-store'}});}
}
