/**
 * A two-event bus for things any part of the app can trigger.
 *
 * The alternative was threading state down through a server-rendered layout
 * into components that don't otherwise share a tree. A CustomEvent is less
 * machinery for the same result, and it means the sidebar, the dashboard
 * header and a keyboard shortcut can all open the same sheet without knowing
 * about each other.
 */
export const OPEN_SEARCH = "jarvis:open-search";
export const FOCUS_COMPOSER = "jarvis:focus-composer";

export const openSearch = () => window.dispatchEvent(new CustomEvent(OPEN_SEARCH));
export const focusComposer = () => window.dispatchEvent(new CustomEvent(FOCUS_COMPOSER));

/** True when the keystroke landed in a field the user is typing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Mac reports "MacIntel"; everything else gets Ctrl. Call after mount only. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
