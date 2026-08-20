import { OpsGlobalOverlays } from "./ops-global-overlays";

export default function OpsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {children}
      <OpsGlobalOverlays />
    </>
  );
}
