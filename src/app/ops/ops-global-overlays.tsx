"use client";

import { usePathname } from "next/navigation";
import { OpsCopilotChat } from "./ops-copilot-chat";
import { OpsTaskNotifier } from "./ops-task-notifier";

const BLIND_GOLD_REVIEW_PATH = "/ops/customer-records/gold-review";

export function OpsGlobalOverlays() {
  const pathname = usePathname();
  if (pathname === BLIND_GOLD_REVIEW_PATH || pathname.startsWith(`${BLIND_GOLD_REVIEW_PATH}/`)) {
    return null;
  }
  return (
    <>
      <OpsCopilotChat />
      <OpsTaskNotifier />
    </>
  );
}
