import { useEffect, useState } from "react";

export type LocalUplinkState = "waiting" | "built" | "failed";

/** What the dev server knows about one Uplink named with `--uplink`. */
export interface LocalUplinkStatus {
  id: string;
  name: string;
  path: string;
  state: LocalUplinkState;
  /** The first line of the last build error, while `state` is `failed`. */
  error: string | null;
  builtAt: string | null;
  version: string | null;
  apiVersion: string | null;
  uiKitVersion: string | null;
}

/**
 * The Uplinks named with `--uplink`, read once from the dev server.
 *
 * A page reload follows every rebuild, so there is nothing to poll. Empty in any
 * build that is not the dev server, and when the dev server names none: the
 * endpoint answers with the app shell then, which is not a list.
 */
export function useLocalUplinks(): LocalUplinkStatus[] {
  const [local, setLocal] = useState<LocalUplinkStatus[]>([]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let current = true;
    fetch(`${import.meta.env.BASE_URL}__gonogo/local-uplinks.json`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((body: unknown) => {
        if (current && Array.isArray(body)) {
          setLocal(body as LocalUplinkStatus[]);
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  return local;
}
