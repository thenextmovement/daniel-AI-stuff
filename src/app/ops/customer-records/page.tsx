import { headers } from "next/headers";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { CustomerRecordsClient } from "./page-client";

export const metadata = {
  title: "Kundenakte - NEONTRIP Ops",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CustomerRecordsPage() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  const opsEnabled = isOpsPortalConfigured(host);
  const localMode = isOpsPortalBypassed(host);

  return (
    <CustomerRecordsClient
      initialHasSession={opsEnabled ? await hasOpsSession(host, headerStore) : false}
      opsEnabled={opsEnabled}
      localMode={localMode}
      placetelTemplate={process.env.OPS_PLACETEL_CONTACT_URL_TEMPLATE || null}
    />
  );
}
