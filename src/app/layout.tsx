import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";
import { ViewportHeight } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "JARVIS",
  description: "A personal AI assistant that remembers you.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "JARVIS" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#05080f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/*
        A real flex shell instead of fixed-position bars. Everything that used
        to be `position: fixed` now participates in layout, which is what makes
        the keyboard behave on iOS.
      */}
      <body className="flex h-[var(--app-h,100dvh)] flex-col overflow-hidden antialiased">
        <ViewportHeight />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        <NavBar />
      </body>
    </html>
  );
}
