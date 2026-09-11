"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SearchSheet } from "./SearchSheet";
import { SearchIcon, PeopleIcon, LogoutIcon } from "./Icons";

export function DashboardHeaderActions({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <div className="mb-1 flex items-center justify-end gap-1">
        <button
          onClick={() => setSearchOpen(true)}
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

      <SearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
