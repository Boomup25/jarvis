"use client";

import { useCallback, useEffect, useState } from "react";
import { SearchSheet } from "./SearchSheet";
import { FOCUS_COMPOSER, OPEN_SEARCH, isTypingTarget, focusComposer } from "./commandBus";

/**
 * Owns the search sheet and the app-wide keyboard shortcuts.
 *
 * Mounted once in the root layout so Cmd/Ctrl+K works on every route rather
 * than only where a search button happens to be rendered.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_SEARCH, onOpen);
    return () => window.removeEventListener(OPEN_SEARCH, onOpen);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K — open search from anywhere, including mid-typing.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (isTypingTarget(e.target)) return;

      // "/" focuses the composer, the way every chat app does it.
      if (e.key === "/") {
        e.preventDefault();
        focusComposer();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <SearchSheet open={open} onClose={close} />;
}

export { FOCUS_COMPOSER };
