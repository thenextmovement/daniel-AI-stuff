import { OpsLoginPageClient } from "./page-client";

export const metadata = {
  title: "Ops Login - NEONTRIP",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function sanitizeNextPath(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const nextPath = String(raw || "/ops/customer-records").trim();
  if (!nextPath.startsWith("/ops/")) return "/ops/customer-records";
  if (nextPath.startsWith("//")) return "/ops/customer-records";
  return nextPath;
}

export default async function OpsLoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  return <OpsLoginPageClient nextPath={sanitizeNextPath(params.next)} />;
}
