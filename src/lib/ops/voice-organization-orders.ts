import { customerOrganizationEmailDomains } from "./customer-records";

export type OrganizationOrder = { id:string; name:string; email:string|null; createdAt:string; cancelledAt:string|null; test:boolean; displayFinancialStatus:string|null; currentTotalPriceSet:{shopMoney:{amount:string;currencyCode:string}} };
export type OrganizationOrders = { scope:"organization"|"contact"; domain:string|null; count:number; totals:Array<{currency:string;amount:number}>; orders:Array<{id:string;name:string;email:string|null;createdAt:string;cancelled:boolean;status:string|null;amount:number;currency:string;href:string}>; checkedAt:string };
const SHOP = "galaxybuzzdk.myshopify.com";
const normalize = (value:string|null|undefined) => value?.trim().toLowerCase() || "";
export function organizationOrderScope(email:string) {
  const normalized=normalize(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.endsWith(".invalid")) return null;
  const domain=customerOrganizationEmailDomains([normalized])[0] || null;
  return { email:normalized, domain };
}
export function summarizeOrganizationOrders(email:string, source:OrganizationOrder[], checkedAt:string):OrganizationOrders {
  const scope=organizationOrderScope(email);
  if(!scope) throw Error("organization_email_missing");
  const unique=new Map(source.map(order=>[order.id,order]));
  const orders=[...unique.values()].filter(order=>!order.test && (scope.domain ? normalize(order.email).split("@")[1]===scope.domain : normalize(order.email)===scope.email)).map(order=>({
    id:order.id,name:order.name,email:order.email,createdAt:order.createdAt,cancelled:!!order.cancelledAt,status:order.displayFinancialStatus,
    amount:Number(order.currentTotalPriceSet.shopMoney.amount),currency:order.currentTotalPriceSet.shopMoney.currencyCode,
    href:"https://admin.shopify.com/store/galaxybuzzdk/orders/"+order.id.split("/").at(-1),
  })).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const totals=new Map<string,number>();
  for(const order of orders) if(!order.cancelled) totals.set(order.currency,(totals.get(order.currency)||0)+Math.round(order.amount*100));
  return {scope:scope.domain?"organization":"contact",domain:scope.domain,count:orders.filter(order=>!order.cancelled).length,totals:[...totals].map(([currency,cents])=>({currency,amount:cents/100})),orders,checkedAt};
}
// A complete, short-lived snapshot avoids repeated full-store reads when switching customers.
// Never replace a failed/partial read with an empty order history.
export async function readVoiceShopifyOrders(fetcher:typeof fetch=fetch) {
  const domain=(process.env.SHOPIFY_SHOP_DOMAIN||process.env.SHOPIFY_STORE_DOMAIN||process.env.SHOPIFY_SHOP||"").replace(/^https?:\/\//," ").trim().replace(/\/+$/,"");
  const token=process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN||process.env.SHOPIFY_ADMIN_TOKEN||process.env.SHOPIFY_ADMIN_API_TOKEN||process.env.SHOPIFY_ACCESS_TOKEN;
  if(domain!==SHOP || !token) throw Error("organization_shopify_not_configured");
  const version=process.env.SHOPIFY_ADMIN_API_VERSION||"2026-01";
  if(!/^20\d{2}-\d{2}$/.test(version))throw Error("organization_shopify_version_invalid");
  const signal=AbortSignal.timeout(45000);
  async function query(query:string,variables:Record<string,unknown>={}) {
    for(let attempt=0;attempt<4;attempt++) {
      const response=await fetcher(`https://${SHOP}/admin/api/${version}/graphql.json`,{method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":token!},body:JSON.stringify({query,variables}),cache:"no-store",signal});
      const result=response.ok ? await response.json() : null;
      const throttled=response.status===429 || result?.errors?.some((error:{extensions?:{code?:string}})=>error.extensions?.code==="THROTTLED");
      if(throttled && attempt<3) {
        const delay=Math.min(5000,Math.max(1000,Number(response.headers.get("retry-after")||0)*1000,1000*2**attempt));
        await new Promise(resolve=>setTimeout(resolve,delay));
        signal.throwIfAborted();
        continue;
      }
      if(!response.ok)throw Error("organization_shopify_unavailable");
      if(result.errors?.length || !result.data)throw Error("organization_shopify_read_failed");
      return result.data;
    }
    throw Error("organization_shopify_read_failed");
  }
  const access=await query("{ shop { myshopifyDomain } currentAppInstallation { accessScopes { handle } } }");
  if(access.shop?.myshopifyDomain!==SHOP || !access.currentAppInstallation?.accessScopes?.some((s:{handle:string})=>s.handle==="read_all_orders"))throw Error("organization_shopify_history_permission_missing");
  const orders:OrganizationOrder[]=[];
  let after:string|null=null;
  const cursors=new Set<string>();
  for(let page=0;page<200;page++) {
    const data=await query(`query VoiceOrganizationOrders($after:String) { orders(first:250,after:$after) { nodes { id name email createdAt cancelledAt test displayFinancialStatus currentTotalPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage endCursor } } }`,{after});
    const connection=data.orders;
    if(!Array.isArray(connection?.nodes) || typeof connection?.pageInfo?.hasNextPage!=="boolean")throw Error("organization_shopify_invalid_page");
    for(const row of connection.nodes) {
      const money=row.currentTotalPriceSet?.shopMoney;
      if(!/^gid:\/\/shopify\/Order\/\d+$/.test(row.id||"") || typeof row.name!=="string" || !Number.isFinite(Date.parse(row.createdAt)) || typeof row.test!=="boolean" || (row.email!==null && typeof row.email!=="string") || !money || typeof money.amount!=="string" || !money.amount.trim() || !Number.isFinite(Number(money.amount)) || Number(money.amount)<0 || !/^[A-Z]{3}$/.test(money.currencyCode))throw Error("organization_shopify_invalid_order");
      orders.push(row);
    }
    if(!connection.pageInfo.hasNextPage)return {orders,checkedAt:new Date().toISOString()};
    after=connection.pageInfo.endCursor;
    if(!after || cursors.has(after))throw Error("organization_shopify_invalid_cursor");
    cursors.add(after);
  }
  throw Error("organization_shopify_history_incomplete");
}
let snapshot:Awaited<ReturnType<typeof readVoiceShopifyOrders>>|null=null;
let expires=0;
let pending:ReturnType<typeof readVoiceShopifyOrders>|null=null;
let retryAfter=0;
export async function loadOrganizationOrders(email:string) {
  if(!snapshot || Date.now()>=expires) {
    if(Date.now()<retryAfter)throw Error("organization_shopify_retry_later");
    pending??=readVoiceShopifyOrders().then(value=>{snapshot=value;expires=Date.now()+120000;return value;}).catch(error=>{retryAfter=Date.now()+15000;throw error;}).finally(()=>{pending=null;});
    await pending;
  }
  return summarizeOrganizationOrders(email,snapshot!.orders,snapshot!.checkedAt);
}
