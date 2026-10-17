/**
 * Which of the mod's recent log lines have not been forwarded yet. Each reply
 * to `system.log.recent` carries the newest lines and the running count of
 * every line the mod has kept, which numbers the last of them, so the lines
 * past the count already seen are new. A different `bootId` means the game
 * restarted and its count began again.
 */
export class ModLogCursor {
  private seen: number | undefined;
  private bootId: string | undefined;

  /**
   * The lines in `lines` not returned before, oldest first, and how many new
   * lines the mod let go of before they could be read. The first reply's
   * lines are all new.
   */
  take(
    lines: readonly string[],
    total: number,
    bootId: string | undefined,
  ): { fresh: string[]; missed: number } {
    const restarted =
      this.seen === undefined || bootId !== this.bootId || total < this.seen;
    const newCount = restarted ? total : total - (this.seen ?? 0);
    this.seen = total;
    this.bootId = bootId;
    const fresh = lines.slice(Math.max(0, lines.length - newCount));
    return { fresh, missed: Math.max(0, newCount - lines.length) };
  }
}
