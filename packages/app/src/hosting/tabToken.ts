const TOKEN_KEY = "gonogo.host.tabToken";
const LOCK_PREFIX = "gonogo.host.tab.";

/**
 * The slice of the Web Locks API this needs, so a test can stand in for it.
 * `ifAvailable` hands the callback `null` when another tab of this browser
 * holds the lock.
 */
export interface TabLocks {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
}

function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readStored(storage: Storage | undefined): string | undefined {
  try {
    return storage?.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function store(storage: Storage | undefined, token: string): void {
  try {
    storage?.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode: the token lasts as long as the page */
  }
}

/**
 * Hold the lock named for `token` until `released` settles. Resolves true once
 * it is held, false when another tab holds it.
 */
function holdLock(
  locks: TabLocks,
  token: string,
  released: Promise<void>,
): Promise<boolean> {
  return new Promise((resolve) => {
    void locks.request(
      `${LOCK_PREFIX}${token}`,
      { ifAvailable: true },
      async (lock) => {
        resolve(lock !== null);
        if (lock !== null) await released;
      },
    );
  });
}

/** This tab's host token, and the release of the lock that keeps it this tab's own. */
export interface TabToken {
  token: string;
  release(): void;
}

/** Acquisitions still in flight, by token, and how many askers share each. */
const acquiring = new Map<string, { asks: number; tab: Promise<TabToken> }>();

/**
 * The token this tab claims the host role with: kept in `sessionStorage`, so a
 * reload keeps it and the mod takes the role straight back.
 *
 * A duplicated tab is handed a copy of `sessionStorage`, and with it the token,
 * and the mod would let both copies hold the role. So the tab holds a Web Lock
 * named for its token for as long as it is open: a tab that finds the lock held
 * is the copy, and mints a token of its own. A reload lets go of the lock as the
 * old page goes, so the reloaded page takes it again.
 *
 * Asking again for a token this page is still acquiring (an effect that runs
 * twice) joins that acquisition rather than meeting its lock: the lock lets go
 * once every asker has released.
 */
export async function acquireTabToken(
  storage: Storage | undefined = globalThis.sessionStorage,
  locks: TabLocks | undefined = globalThis.navigator?.locks,
): Promise<TabToken> {
  const stored = readStored(storage);
  const joined = stored ? acquiring.get(stored) : undefined;
  if (joined) {
    joined.asks += 1;
    return share(await joined.tab, joined);
  }
  const entry = { asks: 1, tab: acquireFresh(storage, locks, stored) };
  const key = stored;
  if (key) {
    acquiring.set(key, entry);
    void entry.tab.finally(() => acquiring.delete(key));
  }
  return share(await entry.tab, entry);
}

/** A handle on `tab` that gives its lock up once every asker has let go. */
function share(tab: TabToken, entry: { asks: number }): TabToken {
  let letGo = false;
  return {
    token: tab.token,
    release() {
      if (letGo) return;
      letGo = true;
      entry.asks -= 1;
      if (entry.asks === 0) tab.release();
    },
  };
}

async function acquireFresh(
  storage: Storage | undefined,
  locks: TabLocks | undefined,
  stored: string | undefined,
): Promise<TabToken> {
  let releaseLock: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  let token = stored ?? mintToken();
  if (locks && !(await holdLock(locks, token, released))) {
    token = mintToken();
    await holdLock(locks, token, released);
  }
  store(storage, token);
  return { token, release: releaseLock };
}
