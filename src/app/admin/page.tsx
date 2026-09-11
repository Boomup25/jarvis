import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/session";
import { isOwner } from "@/lib/users";
import { AdminPanel } from "@/components/AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  // Members have no business here, and a redirect leaks less than a 403 page.
  if (!isOwner(user)) redirect("/");

  return (
    <main className="h-full overflow-y-auto overscroll-contain px-4 pb-10 page-top lg:px-8 lg:page-top-wide">
      <div className="mx-auto w-full max-w-lg md:max-w-2xl lg:max-w-5xl">
        <Link href="/" className="readout hover:text-frost">
          ← Brief
        </Link>
        <h1 className="mt-3 text-xl font-semibold">People</h1>
        <p className="mt-1 text-[0.8rem] text-mist">
          Invites, quotas and what everyone has used this month.
        </p>
        <AdminPanel />
      </div>
    </main>
  );
}
