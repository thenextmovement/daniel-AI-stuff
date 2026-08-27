import { NextRequest } from "next/server";
import { handleKeyCustomerTitleSyncPost } from "@/lib/ops/key-customer-title-sync-route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleKeyCustomerTitleSyncPost(request);
}
