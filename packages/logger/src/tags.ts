/**
 * Verbose logging gate. When on, tagged `debug` lines print to the console
 * for every subsystem; when off they are only buffered and sent. Enable at
 * runtime via `localStorage.LOG_TAGS = '*'` and reload, or through the
 * Diagnostics switch.
 *
 * Only `debug` on tagged logs is gated. `info`, `warn` and `error` always
 * pass: a serious problem should surface even with verbose logging off.
 * Any stored value other than `*` counts as off.
 */

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

export class TagRegistry {
  // null = not yet resolved from storage
  private verbose: boolean | null = null;

  /** Runtime override, so the diagnostics UI can flip it without a reload. */
  setVerbose(on: boolean): void {
    this.verbose = on;
  }

  clearOverride(): void {
    this.verbose = null;
  }

  isVerbose(): boolean {
    if (this.verbose === null) this.verbose = this.resolve();
    return this.verbose;
  }

  private resolve(): boolean {
    const raw = readLocalStorage("LOG_TAGS") ?? readEnv("LOG_TAGS");
    return raw?.trim() === "*";
  }
}

export const tagRegistry = new TagRegistry();
