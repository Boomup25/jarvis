import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";
import { SideNav } from "@/components/SideNav";
import { GlobalSearch } from "@/components/GlobalSearch";
import { ViewportHeight } from "@/components/AppShell";
import { currentUser } from "@/lib/session";

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
  // No maximumScale: pinch-zoom is an accessibility feature, and the layout
  // no longer depends on the viewport staying put.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en">
      {/*
        A real flex shell instead of fixed-position bars. Everything that used
        to be `position: fixed` now participates in layout, which is what makes
        the keyboard behave on iOS.

        Below lg it stacks: content above, tab bar below. From lg it becomes a
        row, with the sidebar taking the tab bar's job.
      */}
      <body className="flex h-[var(--app-h,100dvh)] flex-col overflow-hidden antialiased lg:flex-row">
        <ViewportHeight />
        <SideNav
          user={user ? { displayName: user.displayName, role: user.role } : null}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
        <NavBar />
        <GlobalSearch />
      </body>
    </html>
  );
}
