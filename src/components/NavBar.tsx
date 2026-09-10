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
  if (pathname === "/login") return null;

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 glass border-t border-edge">
      <ul className="mx-auto flex max-w-lg">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[0.68rem] tracking-wide transition-colors ${
                  active ? "text-arc" : "text-mist hover:text-frost"
                }`}
              >
                <Icon className={`size-5 ${active ? "drop-shadow-[0_0_6px_var(--color-arc)]" : ""}`} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
