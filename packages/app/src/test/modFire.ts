/**
 * The simulation's fire notice for one alarm, as `alarm.scet.fired` carries it.
 *
 * Publishing it on the stream is how any alarm fires, whatever its kind: the
 * simulation judges every alarm and this side only hears the verdict. A test
 * about what a fire DOES uses this and names no trigger kind.
 */
export function modFireNotice(
  id: string,
  firedAtUt: number,
): { topic: string; record: unknown } {
  return {
    topic: "alarm.scet.fired",
    record: { id, firedAtUt, vantage: "" },
  };
}
