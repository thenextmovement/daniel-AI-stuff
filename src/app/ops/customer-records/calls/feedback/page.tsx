import { headers } from "next/headers";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { CallFeedbackClient } from "./page-client";
export const dynamic = "force-dynamic";
export const metadata = { title: "Anrufergebnis – NEONTRIP Ops", robots: { index: false, follow: false } };
export default async function CallFeedbackPage({ searchParams }: {
  searchParams: Promise<{ requestId?: string; action?: string }>;
}) {
  const [params, headerStore] = await Promise.all([searchParams, headers()]);
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  const enabled = isOpsPortalConfigured(host);
  return <CallFeedbackClient requestId={params.requestId || ""} initialAction={params.action || ""}
    enabled={enabled} initialHasSession={isOpsPortalBypassed(host) || (enabled && await hasOpsSession(host, headerStore))} />;
}
