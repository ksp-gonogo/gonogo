export const OWNED_PATHS: Record<"rc" | "release", string[]>;
export const SPA_ROUTES: string[];
export const REDIRECTS: [from: string, to: string][];
export function redirectPage(fallback: string, message?: string): string;
export function compose(
  channel: "rc" | "release",
  dist: string,
  site: string,
): void;
