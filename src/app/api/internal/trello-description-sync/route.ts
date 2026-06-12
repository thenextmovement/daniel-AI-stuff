import { NextRequest } from "next/server";
import { handleTrelloDescriptionSyncPost } from "@/lib/ops/trello-description-sync-route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleTrelloDescriptionSyncPost(request);
}
