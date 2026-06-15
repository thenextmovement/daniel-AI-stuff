import { headers } from "next/headers";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { InboundShippingClient } from "./page-client";

export const metadata = {
  title: "Wareneingang - NEONTRIP Ops",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function InboundShippingPage({
  searchParams,
}: {
  searchParams?: Promise<{ requestId?: string | string[] }>;
}) {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  const opsEnabled = isOpsPortalConfigured(host);
  const localMode = isOpsPortalBypassed(host);
  const resolvedSearchParams = await searchParams;
  const requestIdParam = resolvedSearchParams?.requestId;

  return (
    <InboundShippingClient
      initialHasSession={opsEnabled ? await hasOpsSession(host, headerStore) : false}
      initialRequestId={Array.isArray(requestIdParam) ? requestIdParam[0] || "" : requestIdParam || ""}
      opsEnabled={opsEnabled}
      localMode={localMode}
    />
  );
}
