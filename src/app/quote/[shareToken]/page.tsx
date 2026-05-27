import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { QuotePage } from "@/components/quotes/QuotePage";
import { getQuoteByShareToken, markQuoteViewed } from "@/lib/quotes/supabase-rest";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ shareToken: string }>;
};

export const metadata: Metadata = {
  title: "Ihr NEONTRIP Angebot",
  description: "Interaktives NEONTRIP Angebot mit Auswahl, Preisübersicht und Annahme.",
  robots: { index: false, follow: false },
};

export default async function PublicQuotePage({ params }: Props) {
  const { shareToken } = await params;
  const quote = await getQuoteByShareToken(shareToken);
  if (!quote) notFound();

  const headerList = await headers();
  await markQuoteViewed(quote, headerList.get("user-agent"));

  return <QuotePage quote={quote} />;
}
