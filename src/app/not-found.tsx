import Link from "next/link";
import { ArcReactor } from "@/components/Icons";

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <ArcReactor className="size-14 text-arc/60" />
      <p className="text-[0.95rem]">I have no record of that, sir.</p>
      <Link href="/" className="rounded-full border border-edge px-5 py-2 text-[0.8rem] text-mist hover:text-frost">
        Back to the brief
      </Link>
    </main>
  );
}
