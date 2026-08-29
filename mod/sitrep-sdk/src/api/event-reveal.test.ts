import { afterEach, describe, expect, it } from "vitest";
import type { EventOccurrence } from "../event-timeline";
import {
  clearRevealedEventSources,
  readRevealedEvents,
  registerRevealedEventSource,
} from "./event-reveal";

const at = (ut: number): EventOccurrence => ({ kind: "edge", ut }) as never;

afterEach(() => {
  clearRevealedEventSources();
});

describe("revealed event sources", () => {
  it("reads nothing for a topic no source registered", () => {
    expect(readRevealedEvents("nobody.events", 100)).toEqual([]);
  });

  it("reads a registered source's occurrences for its own topic only", () => {
    registerRevealedEventSource({
      id: "a",
      topic: "a.events",
      revealedEvents: () => [at(1)],
    });
    expect(readRevealedEvents("a.events", 100)).toEqual([at(1)]);
    expect(readRevealedEvents("b.events", 100)).toEqual([]);
  });

  /*
   * Two Uplinks may both feed one Topic. Picking a winner would silently drop
   * an alarm, so the read concatenates.
   */
  it("concatenates every source feeding the same topic", () => {
    registerRevealedEventSource({
      id: "first",
      topic: "shared.events",
      revealedEvents: () => [at(1)],
    });
    registerRevealedEventSource({
      id: "second",
      topic: "shared.events",
      revealedEvents: () => [at(2)],
    });
    expect(readRevealedEvents("shared.events", 100)).toEqual([at(1), at(2)]);
  });

  it("hands the source the view UT it was asked for", () => {
    const seen: (number | null | undefined)[] = [];
    registerRevealedEventSource({
      id: "spy",
      topic: "spy.events",
      revealedEvents: (viewUt) => {
        seen.push(viewUt);
        return [];
      },
    });
    readRevealedEvents("spy.events", 42);
    readRevealedEvents("spy.events", null);
    expect(seen).toEqual([42, null]);
  });
});
