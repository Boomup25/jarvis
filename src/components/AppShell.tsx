"use client";

import { useEffect } from "react";

/**
 * Sets --app-h to the VISUAL viewport height.
 *
 * `100dvh` accounts for the browser's collapsing address bar but NOT for the
 * on-screen keyboard — so on iOS a bottom-anchored composer ends up behind it.
 * visualViewport is the only thing that reports the real usable height, and
 * this is why the input used to jump around on the phone.
 */
export function ViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;

    const apply = () => {
      const height = vv?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-h", `${Math.round(height)}px`);
      // iOS also scrolls the layout viewport when the keyboard opens; this
      // keeps our shell pinned to what's actually visible.
      document.documentElement.style.setProperty("--app-top", `${Math.round(vv?.offsetTop ?? 0)}px`);
    };

    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", apply);

    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  return null;
}
