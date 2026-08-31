import { NextRequest } from "next/server";
import { handleEmailBouncePost } from "@/lib/ops/email-bounce-recovery-route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleEmailBouncePost(request);
}
