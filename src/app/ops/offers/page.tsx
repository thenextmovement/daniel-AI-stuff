import { redirect } from "next/navigation";

export const metadata = {
  title: "Angebote - NEONTRIP Ops",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function OpsOffersRedirectPage() {
  redirect("https://angebote.neontrip.de/admin/offers");
}
