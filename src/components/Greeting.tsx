"use client";

import { useEffect, useState } from "react";

const CACHE_KEY = "jarvis:greeting";

/** The written line on the dashboard.
 *
 *  Loads after paint so a rate-limited model never blocks the rest of the brief,
 *  and caches for the hour — otherwise every visit to the home tab spends a
 *  model call just to say good morning. */
export function Greeting({ fallback }: { fallback: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const hourStamp = Math.floor(Date.now() / 3_600_000);

    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "null");
      if (cached?.hour === hourStamp && cached.text) {
        setText(cached.text);
        return;
      }
    } catch {
      /* storage blocked — just fetch */
    }

    fetch("/api/briefing")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.greeting) {
          setText(data.greeting);
          try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ hour: hourStamp, text: data.greeting }));
          } catch {
            /* ignore */
          }
        } else {
          setFailed(true);
        }
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
    };
  }, []);

  if (text) return <p className="text-[0.95rem] leading-relaxed text-frost/90 rise">{text}</p>;
  if (failed) return <p className="text-[0.95rem] leading-relaxed text-frost/90">{fallback}</p>;
  return <p className="h-11 animate-pulse rounded-md bg-panel/70" aria-hidden />;
}
