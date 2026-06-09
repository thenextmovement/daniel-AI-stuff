import { redirect } from "next/navigation";

export const metadata = {
  title: "Interne Aufgaben - NEONTRIP Ops",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function CustomerRecordsTasksPage() {
  redirect("/ops/tasks");
}
