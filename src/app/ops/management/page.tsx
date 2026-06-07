import { headers } from "next/headers";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { ManagementKpisClient } from "./page-client";

export const metadata = {
  title: "Management KPIs - NEONTRIP Ops",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ManagementKpisPage() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  const opsEnabled = isOpsPortalConfigured(host);
  const localMode = isOpsPortalBypassed(host);

  return (
    <ManagementKpisClient
      initialHasSession={opsEnabled ? await hasOpsSession(host, headerStore) : false}
      opsEnabled={opsEnabled}
      localMode={localMode}
    />
  );
}
