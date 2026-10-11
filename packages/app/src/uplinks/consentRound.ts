import type { ConsentInfo } from "./consent";

/**
 * One load's part in a {@link ConsentRound}. Every load reports exactly once:
 * `ask` when it reaches the consent gate with a question, `pass` when it gets
 * past the gate without one (a local build) or stops before reaching it. A
 * second report from the same load is ignored, so a load can call `pass` in a
 * `finally` without tracking whether it already asked.
 */
export interface ConsentSlot {
  ask(info: ConsentInfo): Promise<boolean>;
  pass(): void;
}

/**
 * Collects the consent questions of a set of loads running side by side, and
 * asks them all at once when every load has reported, so an operator answers
 * one page rather than one dialog per Uplink. Nothing is asked until the last
 * load reports, which is why each load must report on every path.
 */
export class ConsentRound {
  private readonly waiting: {
    info: ConsentInfo;
    resolve: (granted: boolean) => void;
    reject: (err: unknown) => void;
  }[] = [];
  private reported = 0;

  constructor(
    private readonly expected: number,
    private readonly resolveAll: (
      infos: readonly ConsentInfo[],
    ) => Promise<boolean[]>,
  ) {}

  slot(): ConsentSlot {
    let done = false;
    const report = () => {
      if (done) return false;
      done = true;
      this.reported += 1;
      return true;
    };
    return {
      ask: (info) =>
        new Promise<boolean>((resolve, reject) => {
          if (!report()) {
            reject(new Error("a load asked for consent twice"));
            return;
          }
          this.waiting.push({ info, resolve, reject });
          this.flushIfComplete();
        }),
      pass: () => {
        if (report()) this.flushIfComplete();
      },
    };
  }

  private flushIfComplete(): void {
    if (this.reported < this.expected || this.waiting.length === 0) return;
    const asked = this.waiting.splice(0);
    this.resolveAll(asked.map((entry) => entry.info)).then(
      (answers) => {
        asked.forEach((entry, n) => {
          entry.resolve(answers[n] === true);
        });
      },
      (err: unknown) => {
        for (const entry of asked) entry.reject(err);
      },
    );
  }
}
