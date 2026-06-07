import { OpsCopilotChat } from "./ops-copilot-chat";
import { OpsIdeaBox } from "./ops-idea-box";
import { OpsTaskNotifier } from "./ops-task-notifier";

export default function OpsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {children}
      <OpsIdeaBox />
      <OpsCopilotChat />
      <OpsTaskNotifier />
    </>
  );
}
