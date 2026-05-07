/**
 * Tag-based log gating. Tags name a subsystem ("peer", "camera", "serial"…)
 * and can be toggled independently of the numeric log level. Enable at
 * runtime via `localStorage.LOG_TAGS = 'peer,camera'` (or `'*'` for all)
 * and reload.
 *
 * Tag gating only affects `debug` and `info` on tagged logs. `warn` and
 * `error` always pass — a serious problem should surface even if you
 * forgot to enable the subsystem's tag beforehand.
 *
 * Legacy `DEBUG_PEER=1` / `DEBUG_FLIGHT=1` flags remain honoured so old
 * docs and muscle memory still work.
 */

const LEGACY_FLAGS: Record<string, string> = {
  peer: "DEBUG_PEER",
  flight: "DEBUG_FLIGHT",
};

function readLocalStorage(key: string): string | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function readEnv(key: string): string | null {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string> } })
      .process?.env;
    return env?.[key] ?? null;
  } catch {
    return null;
  }
}

function parseTags(raw: string | null): Set<string> | "all" | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "*") return "all";
  return new Set(
    trimmed
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  );
}

export class TagRegistry {
  // null = not yet resolved; "all" = wildcard; Set = explicit list
  private resolved: Set<string> | "all" | null | "none" = null;

  /**
   * Runtime override — called by the diagnostics UI so operators can flip
   * tags without reloading the page. Also resets the resolver cache so
   * subsequent `isEnabled` checks reflect the override.
   */
  setTags(tags: readonly string[] | "all"): void {
    if (tags === "all") {
      this.resolved = "all";
      return;
    }
    this.resolved = new Set(tags);
  }

  clearOverride(): void {
    this.resolved = null;
  }

  isEnabled(tag: string): boolean {
    if (this.resolved === null) this.resolved = this.resolve();
    if (this.resolved === "none") return this.isLegacyEnabled(tag);
    if (this.resolved === "all") return true;
    if (this.resolved.has(tag)) return true;
    // Colon-scoped tags like "peer:kos" inherit enablement from their base
    // ("peer") so `LOG_TAGS=peer` enables all peer sub-tags.
    const base = tag.split(":")[0];
    if (base !== tag && this.resolved.has(base)) return true;
    return this.isLegacyEnabled(tag);
  }

  snapshot(): { mode: "all" | "none" | "list"; tags: string[] } {
    if (this.resolved === null) this.resolved = this.resolve();
    if (this.resolved === "all") return { mode: "all", tags: [] };
    if (this.resolved === "none") return { mode: "none", tags: [] };
    return { mode: "list", tags: Array.from(this.resolved).sort() };
  }

  private resolve(): Set<string> | "all" | "none" {
    return (
      parseTags(readLocalStorage("LOG_TAGS")) ??
      parseTags(readEnv("LOG_TAGS")) ??
      "none"
    );
  }

  private isLegacyEnabled(tag: string): boolean {
    const base = tag.split(":")[0];
    const flag = LEGACY_FLAGS[base];
    if (!flag) return false;
    return readLocalStorage(flag) === "1" || readEnv(flag) === "1";
  }
}

export const tagRegistry = new TagRegistry();
