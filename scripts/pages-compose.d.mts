export const OWNED_PATHS: Record<"rc" | "release", string[]>;
export const SPA_ROUTES: string[];
export const API_PAGE_PATHS: Record<"rc" | "root", string>;
export const REDIRECTS: [from: string, to: string][];
export const SPACEDOCK_SLOT: string;
export function spacedockLink(modId?: string): string;
export function redirectPage(fallback: string, message?: string): string;
export function compose(
  channel: "rc" | "release",
  dist: string,
  apiPage: string,
  site: string,
  spacedockModId?: string,
): void;
