import { describe, expect, it } from "vitest";
import { acquireTabToken, type TabLocks } from "./tabToken";

/** One browser's Web Locks: a name is held until its callback's promise settles. */
function browserLocks(): TabLocks {
  const held = new Set<string>();
  return {
    async request(name, _options, callback) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

function sessionStorageCopy(from?: Storage): Storage {
  const map = new Map<string, string>();
  if (from) {
    for (let i = 0; i < from.length; i++) {
      const key = from.key(i);
      if (key) map.set(key, from.getItem(key) ?? "");
    }
  }
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("the token a tab claims the host role with", () => {
  it("is kept across a reload of the same tab", async () => {
    const locks = browserLocks();
    const storage = sessionStorageCopy();
    const first = await acquireTabToken(storage, locks);
    first.release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const reloaded = await acquireTabToken(storage, locks);

    expect(reloaded.token).toBe(first.token);
  });

  it("is minted afresh in a duplicated tab, whose copied token the first tab still holds", async () => {
    const locks = browserLocks();
    const original = sessionStorageCopy();
    const first = await acquireTabToken(original, locks);

    const copy = sessionStorageCopy(original);
    const duplicate = await acquireTabToken(copy, locks);

    expect(duplicate.token).not.toBe(first.token);
    expect(copy.getItem("gonogo.host.tabToken")).toBe(duplicate.token);
  });

  it("is kept when two acquisitions race and the first is let go, as a strict-mode effect does", async () => {
    const locks = browserLocks();
    const storage = sessionStorageCopy();
    const stored = await acquireTabToken(storage, locks);
    stored.release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const first = acquireTabToken(storage, locks);
    const second = acquireTabToken(storage, locks);
    void first.then((tab) => tab.release());

    expect((await second).token).toBe(stored.token);
  });
});
