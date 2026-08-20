import { headers } from "next/headers";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { SegmentGoldReviewPageClient } from "./page-client";

export const metadata = {
  title: "Blindes Segment-Gold-Review - NEONTRIP Ops",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SegmentGoldReviewPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SegmentGoldReviewPage({ searchParams }: SegmentGoldReviewPageProps) {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  const opsEnabled = isOpsPortalConfigured(host);
  const localMode = isOpsPortalBypassed(host);
  const resolvedSearchParams = (await searchParams) || {};
  const requestIdParam = resolvedSearchParams.requestId;
  const requestId = Array.isArray(requestIdParam) ? requestIdParam[0] || "" : requestIdParam || "";

  return (
    <SegmentGoldReviewPageClient
      requestId={requestId}
      initialHasSession={opsEnabled ? await hasOpsSession(host, headerStore) : false}
      opsEnabled={opsEnabled}
      localMode={localMode}
    />
  );
}
