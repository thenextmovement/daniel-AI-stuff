import { headers } from "next/headers";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { EuSupplierQuotesClient } from "./page-client";
export const metadata={title:"EU Supplier 3D Schilder - NEONTRIP Ops",robots:{index:false,follow:false}};
export const dynamic="force-dynamic";
export default async function Page(){const store=await headers(),host=store.get("x-forwarded-host")||store.get("host");const opsEnabled=isOpsPortalConfigured(host),localMode=isOpsPortalBypassed(host);return <EuSupplierQuotesClient initialHasSession={opsEnabled?await hasOpsSession(host,store):false} opsEnabled={opsEnabled} localMode={localMode}/>;}
