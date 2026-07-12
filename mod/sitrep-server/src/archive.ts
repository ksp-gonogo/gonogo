/**
 * Archive is the single per-vessel SCET-stamped history the Courier reads
 * through. There is ONE archive per vessel (per topic within it); each
 * Vantage (observer) is a monotonic read-cursor into that archive at its own
 * delay offset. That split — one shared history, many independent cursors —
 * is what makes delay honest (every vantage sees its own light-lagged scene
 * of the same underlying truth) and what powers "freeze-on-recession": if a
 * vantage's delay grows faster than time advances (the observer recedes),
 * the cursor holds its last position rather than rewinding to an earlier
 * sample.
 */

interface Sample {
  value: unknown;
  validAt: number;
}

export class Archive {
  // topic -> samples, kept ascending by validAt.
  private readonly samplesByTopic = new Map<string, Sample[]>();
  // topic -> vantage -> last clamped sceneUt used for that cursor.
  private readonly cursors = new Map<string, Map<string, number>>();

  /**
   * Ascending per-topic sample list (by validAt). Returns a fresh copy (not
   * a reference to the internal array), so callers can't mutate archive
   * state through it. Empty array for a topic with no recorded samples.
   */
  samples(topic: string): ReadonlyArray<{ value: unknown; validAt: number }> {
    const list = this.samplesByTopic.get(topic);
    return list ? [...list] : [];
  }

  /** Record a SCET-stamped sample for `topic`, valid as of `validAtUt`. */
  record(topic: string, value: unknown, validAtUt: number): void {
    let list = this.samplesByTopic.get(topic);
    if (!list) {
      list = [];
      this.samplesByTopic.set(topic, list);
    }

    const sample: Sample = { value, validAt: validAtUt };

    // Common case: appended in ascending order already.
    if (list.length === 0 || validAtUt >= list[list.length - 1].validAt) {
      list.push(sample);
      return;
    }

    // Out-of-order record: insert to keep the list ascending by validAt.
    let insertAt = list.length;
    while (insertAt > 0 && list[insertAt - 1].validAt > validAtUt) {
      insertAt--;
    }
    list.splice(insertAt, 0, sample);
  }

  /**
   * Read `topic` through `vantage`'s cursor. sceneUt = nowUt - delaySeconds,
   * clamped to be monotonic non-decreasing per (topic, vantage) so the scene
   * never rewinds even if delaySeconds grows faster than nowUt advances
   * (freeze-on-recession). Returns the latest sample with validAt <= scene,
   * or undefined if nothing has "arrived" yet at that vantage.
   */
  readAtVantage(
    topic: string,
    vantage: string,
    delaySeconds: number,
    nowUt: number,
  ): { value: unknown; validAt: number } | undefined {
    const rawScene = nowUt - delaySeconds;
    const lastScene = this.cursors.get(topic)?.get(vantage);
    const scene =
      lastScene === undefined ? rawScene : Math.max(rawScene, lastScene);

    let byVantage = this.cursors.get(topic);
    if (!byVantage) {
      byVantage = new Map<string, number>();
      this.cursors.set(topic, byVantage);
    }
    byVantage.set(vantage, scene);

    const list = this.samplesByTopic.get(topic);
    if (!list || list.length === 0) {
      return undefined;
    }

    let found: Sample | undefined;
    for (const sample of list) {
      if (sample.validAt > scene) {
        break;
      }
      found = sample;
    }

    if (!found) {
      return undefined;
    }

    return { value: found.value, validAt: found.validAt };
  }
}
