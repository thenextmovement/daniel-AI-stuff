import { OpsTaskNotifier } from "./ops-task-notifier";

export default function OpsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {children}
      <OpsTaskNotifier />
    </>
  );
}
