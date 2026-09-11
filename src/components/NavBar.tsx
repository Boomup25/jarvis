"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChatIcon, HomeIcon, LibraryIcon, BrainIcon } from "./Icons";

const TABS = [
  { href: "/", label: "Brief", Icon: HomeIcon },
  { href: "/chat", label: "JARVIS", Icon: ChatIcon },
  { href: "/pages", label: "Library", Icon: LibraryIcon },
  { href: "/memory", label: "Memory", Icon: BrainIcon },
];

export function NavBar() {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/signup") return null;

  // From lg the SideNav takes over, so this bar leaves the layout entirely.
  return (
    <nav className="safe-bottom shrink-0 border-t border-edge bg-abyss/85 backdrop-blur-xl lg:hidden">
      <ul className="mx-auto flex max-w-lg">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="relative flex-1">
              {active && (
                <span className="absolute inset-x-6 top-0 h-px bg-arc shadow-[0_0_8px_var(--color-arc)]" />
              )}
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[0.6rem] uppercase tracking-[0.12em] transition-colors ${
                  active ? "text-arc" : "text-mist/70 hover:text-frost"
                }`}
              >
                <Icon className="size-[18px]" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
