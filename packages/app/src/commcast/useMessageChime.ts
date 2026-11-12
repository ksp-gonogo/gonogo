import { useEffect, useRef } from "react";
import { playMessageChime } from "./messageChime";
import type { CommcastEntry } from "./useCommcastFeed";

/**
 * Chimes once for each text message from someone else that lands after mount.
 * Messages the screen had already received before the widget mounted
 * (`alreadyHeard`, called once) are seeded as heard, so a reload or a remount
 * replays nothing even though the feed lands them a frame later. Group membership changes and this
 * screen's own words, including their settled echoes, never chime.
 */
export function useMessageChime(
  log: readonly CommcastEntry[],
  alreadyHeard: () => readonly string[],
  enabled: boolean,
): void {
  const heard = useRef<Set<string> | null>(null);
  if (heard.current === null) heard.current = new Set(alreadyHeard());
  useEffect(() => {
    const seen = heard.current ?? new Set<string>();
    let fresh = false;
    for (const entry of log) {
      if (seen.has(entry.msg.id)) continue;
      seen.add(entry.msg.id);
      if (!entry.out && entry.msg.kind === "text") fresh = true;
    }
    heard.current = seen;
    if (fresh && enabled) playMessageChime();
  }, [log, enabled]);
}
