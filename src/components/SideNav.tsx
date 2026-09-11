"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArcReactor,
  BrainIcon,
  ChatIcon,
  HomeIcon,
  LibraryIcon,
  LogoutIcon,
  PeopleIcon,
  SearchIcon,
} from "./Icons";
import { isMac, openSearch } from "./commandBus";

const TABS = [
  { href: "/", label: "Brief", Icon: HomeIcon },
  { href: "/chat", label: "JARVIS", Icon: ChatIcon },
  { href: "/pages", label: "Library", Icon: LibraryIcon },
  { href: "/memory", label: "Memory", Icon: BrainIcon },
];

/**
 * The desktop rail. Hidden below lg, where NavBar takes over.
 *
 * It carries the account actions that used to live only in the dashboard
 * header — on a wide screen there's room for them to be permanently visible
 * rather than hiding on one route.
 */
export function SideNav({ user }: { user: { displayName: string; role: string } | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [shortcut, setShortcut] = useState("Ctrl+K");

  // Read the platform after mount — doing it during render would mismatch
  // what the server produced.
  useEffect(() => setShortcut(isMac() ? "⌘K" : "Ctrl+K"), []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  if (!user || pathname === "/login" || pathname === "/signup") return null;

  return (
    <nav className="hidden w-60 shrink-0 flex-col border-r border-edge bg-abyss/60 backdrop-blur-xl lg:flex">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <ArcReactor className="size-7 text-arc" />
        <div className="min-w-0">
          <p className="text-[0.82rem] font-semibold tracking-[0.24em]">JARVIS</p>
          <p className="readout mt-0.5 flex items-center gap-1.5">
            <span className="live-dot size-1 rounded-full bg-jade" />
            Online
          </p>
        </div>
      </div>

      <div className="rule-fade mx-5" />

      <ul className="mt-4 space-y-0.5 px-3">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 px-3 py-2.5 text-[0.82rem] transition-colors ${
                  active
                    ? "bg-arc/[0.08] text-arc"
                    : "text-mist hover:bg-panel/50 hover:text-frost"
                }`}
              >
                {active && (
                  <span className="absolute inset-y-1 left-0 w-px bg-arc shadow-[0_0_8px_var(--color-arc)]" />
                )}
                <Icon className="size-[18px] shrink-0" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 px-3">
        <button
          onClick={openSearch}
          className="flex w-full items-center gap-3 border border-edge px-3 py-2.5 text-[0.8rem] text-mist transition-colors hover:border-arc/40 hover:text-frost"
        >
          <SearchIcon className="size-[17px] shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="readout border border-edge px-1.5 py-0.5">{shortcut}</kbd>
        </button>
      </div>

      <div className="flex-1" />

      <div className="rule-fade mx-5" />

      <div className="px-3 pb-5 pt-3">
        {user.role === "owner" && (
          <Link
            href="/admin"
            className={`flex items-center gap-3 px-3 py-2.5 text-[0.8rem] transition-colors ${
              pathname.startsWith("/admin")
                ? "text-arc"
                : "text-mist hover:bg-panel/50 hover:text-frost"
            }`}
          >
            <PeopleIcon className="size-[17px] shrink-0" />
            People
          </Link>
        )}

        <div className="mt-1 flex items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8rem]">{user.displayName}</p>
            <p className="readout mt-0.5">{user.role}</p>
          </div>
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="p-1.5 text-mist/60 transition-colors hover:text-ember"
          >
            <LogoutIcon className="size-[17px]" />
          </button>
        </div>
      </div>
    </nav>
  );
}
