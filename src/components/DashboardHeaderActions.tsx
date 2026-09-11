"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { openSearch } from "./commandBus";
import { SearchIcon, PeopleIcon, LogoutIcon } from "./Icons";

/**
 * Compact account actions for the dashboard.
 *
 * Hidden from lg up, where the sidebar carries all three permanently — the
 * search sheet itself lives in the root layout now, so this only has to ask
 * for it.
 */
export function DashboardHeaderActions({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="mb-1 flex items-center justify-end gap-1 lg:hidden">
      <button
        onClick={openSearch}
        aria-label="Search everything"
        className="p-2 text-mist transition-colors hover:text-frost"
      >
        <SearchIcon className="size-[18px]" />
      </button>

      {isOwner && (
        <Link
          href="/admin"
          aria-label="People and invites"
          className="p-2 text-mist transition-colors hover:text-frost"
        >
          <PeopleIcon className="size-[18px]" />
        </Link>
      )}

      <button
        onClick={signOut}
        aria-label="Sign out"
        className="p-2 text-mist transition-colors hover:text-ember"
      >
        <LogoutIcon className="size-[18px]" />
      </button>
    </div>
  );
}
