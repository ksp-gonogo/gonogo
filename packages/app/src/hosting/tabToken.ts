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

/**
 * The token this tab claims the host role with: kept in `sessionStorage`, so a
 * reload keeps it and the mod takes the role straight back.
 *
 * A duplicated tab is handed a copy of `sessionStorage`, and with it the token,
 * and the mod would let both copies hold the role. So the tab holds a Web Lock
 * named for its token for as long as it is open: a tab that finds the lock held
 * is the copy, and mints a token of its own. A reload lets go of the lock as the
 * old page goes, so the reloaded page takes it again.
 */
export async function acquireTabToken(
  storage: Storage | undefined = globalThis.sessionStorage,
  locks: TabLocks | undefined = globalThis.navigator?.locks,
): Promise<TabToken> {
  let releaseLock: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  let token = readStored(storage) ?? mintToken();
  if (locks && !(await holdLock(locks, token, released))) {
    token = mintToken();
    await holdLock(locks, token, released);
  }
  store(storage, token);
  return { token, release: releaseLock };
}
