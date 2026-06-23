import { headers } from "next/headers";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { SupplierPriceReviewClient } from "./page-client";

export const metadata = {
  title: "Schildgrößen & Preise - Customer Records Ops - NEONTRIP",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SupplierPriceReviewPage() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  const opsEnabled = isOpsPortalConfigured(host);
  const localMode = isOpsPortalBypassed(host);

  return (
    <SupplierPriceReviewClient
      initialHasSession={opsEnabled ? await hasOpsSession(host, headerStore) : false}
      opsEnabled={opsEnabled}
      localMode={localMode}
    />
  );
}
