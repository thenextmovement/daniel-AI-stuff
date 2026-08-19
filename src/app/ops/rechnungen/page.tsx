import { headers } from "next/headers";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { BillingOpsClient } from "./page-client";

export const metadata = { title: "Rechnungen – NEONTRIP Ops", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BillingOpsPage() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  const opsEnabled = isOpsPortalConfigured(host);
  const localMode = isOpsPortalBypassed(host);
  return <BillingOpsClient initialHasSession={opsEnabled ? await hasOpsSession(host, headerStore) : false} opsEnabled={opsEnabled} localMode={localMode} />;
}
