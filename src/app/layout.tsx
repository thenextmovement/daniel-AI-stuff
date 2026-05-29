import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEONTRIP - Custom LED Neon Leuchtreklame",
  description: "Premium LED Neon Schilder, 3D Buchstaben & Leuchtreklame aus Düsseldorf",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
