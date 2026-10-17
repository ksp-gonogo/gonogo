import type { Value } from "@ksp-gonogo/sitrep-sdk";

/**
 * Which of the mod's recent log lines have not been forwarded yet. Each reply
 * to `system.log.recent` carries the newest lines and the running count of
 * every line the mod has kept, which numbers the last of them, so the lines
 * past the count already seen are new. A different `bootId` means the game
 * restarted and its count began again.
 */
export class ModLogCursor {
  private seen: Value<"count"> | undefined;
  private bootId: string | undefined;

  /**
   * The lines in `lines` not returned before, oldest first, and how many new
   * lines the mod let go of before they could be read. The first reply's
   * lines are all new.
   */
  take(
    lines: readonly string[],
    total: Value<"count">,
    bootId: string | undefined,
  ): { fresh: string[]; missed: Value<"count"> } {
    const seen = this.seen;
    let unread =
      seen === undefined || bootId !== this.bootId || total.lessThan(seen)
        ? total
        : total.minus(seen);
    this.seen = total;
    this.bootId = bootId;
    const fresh: string[] = [];
    for (let i = lines.length - 1; i >= 0 && unread.isPositive(); i--) {
      fresh.unshift(lines[i] ?? "");
      unread = unread.minus(1);
    }
    return { fresh, missed: unread };
  }
}
