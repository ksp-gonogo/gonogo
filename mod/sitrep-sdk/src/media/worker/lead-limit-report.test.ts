import { describe, expect, it } from "vitest";
import { DEFAULT_PACING_MAX_LEAD_SECONDS } from "../frame-delay";
import { tickReportingLeadLimit } from "./lead-limit-report";
import { PresentationPacer } from "./presentation-pacer";

describe("tickReportingLeadLimit", () => {
  it("posts the pacer's own lead limit when a long burst gap raises it, and only then", () => {
    const pacer = new PresentationPacer<string>({
      onPresent: () => {},
      maxBacklogSeconds: 0.5,
      maxLeadSeconds: DEFAULT_PACING_MAX_LEAD_SECONDS,
    });
    const posted: number[] = [];
    const tick = tickReportingLeadLimit(
      "p",
      {
        tickPacing: (wall) => pacer.tick(wall),
        leadLimitSeconds: () => pacer.leadLimitSeconds(),
      },
      (message) => posted.push(message.seconds),
    );

    pacer.submit({ ut: 0, data: "a" });
    tick(0);
    for (let wall = 0.1; wall < 0.5; wall += 0.1) tick(wall);
    pacer.submit({ ut: 1, data: "b" });
    tick(0.5);
    expect(posted).toEqual([]);

    // A burst eight seconds after the last one, with the caller ticking throughout.
    for (let wall = 0.6; wall < 8.5; wall += 0.1) tick(wall);
    pacer.submit({ ut: 9, data: "c" });
    tick(8.5);

    expect(posted).toEqual([pacer.leadLimitSeconds()]);
    expect(posted[0]).toBeCloseTo(1.25 * 8, 5);
  });
});
