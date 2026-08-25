import { headers } from "next/headers";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { DunningOpsClient } from "./page-client";

export const metadata = { title: "Mahnwesen - NEONTRIP Ops", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DunningOpsPage() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  const opsEnabled = isOpsPortalConfigured(host);
  const localMode = isOpsPortalBypassed(host);
  return <DunningOpsClient initialHasSession={opsEnabled ? await hasOpsSession(host, headerStore) : false} opsEnabled={opsEnabled} localMode={localMode} />;
}
