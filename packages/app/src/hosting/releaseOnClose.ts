import type { HostRole } from "./HostRole";

/** The slice of the page's Navigation API this reads: the kind of each navigation. */
export interface NavigationEvents {
  addEventListener(
    type: "navigate",
    listener: (event: { navigationType?: string }) => void,
  ): void;
  removeEventListener(
    type: "navigate",
    listener: (event: { navigationType?: string }) => void,
  ): void;
}

/** The slice of `window` this listens on. */
export interface PageEvents {
  addEventListener(
    type: "pagehide",
    listener: (event: { persisted: boolean }) => void,
  ): void;
  removeEventListener(
    type: "pagehide",
    listener: (event: { persisted: boolean }) => void,
  ): void;
  navigation?: NavigationEvents;
}

/**
 * Give the host role up as this page closes, so the next screen does not wait
 * out the mod's grace. A reload keeps the role: the reloaded page claims it
 * back with the same token inside the grace, and a page entering the
 * back-forward cache is still alive.
 *
 * A reload is told from a close by the Navigation API's `navigate` event, which
 * fires before the page goes. A browser without it cannot tell the two, so
 * there the role is left to the grace and a close is let go when it runs out.
 * Returns the detach.
 */
export function releaseOnClose(
  role: HostRole,
  page: PageEvents | undefined = globalThis.window,
): () => void {
  const navigation = page?.navigation;
  if (!page || !navigation) return () => {};
  let reloading = false;
  const onNavigate = (event: { navigationType?: string }) => {
    reloading = event.navigationType === "reload";
  };
  const onPageHide = (event: { persisted: boolean }) => {
    if (event.persisted || reloading) return;
    role.release();
  };
  navigation.addEventListener("navigate", onNavigate);
  page.addEventListener("pagehide", onPageHide);
  return () => {
    navigation.removeEventListener("navigate", onNavigate);
    page.removeEventListener("pagehide", onPageHide);
  };
}
