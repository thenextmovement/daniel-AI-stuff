import { BillingPortalClient } from "./portal-client";

export const metadata = { title: "Rechnung – NEONTRIP", robots: { index: false, follow: false } };

export default async function BillingPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <BillingPortalClient token={token} />;
}
