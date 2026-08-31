import { describe, expect, it } from "vitest";
import {
  type MissionLogRow,
  type MissionLogSourceEntry,
  mergeLogRows,
  resolveLogSources,
} from "./sources";

const own = (key: string, ut: number, label = key): MissionLogRow => ({
  key,
  ut,
  label,
  badgeLabel: "LAUNCH",
  severity: "nominal",
});

describe("resolveLogSources", () => {
  it("says nothing at all when nobody contributes a source", () => {
    expect(resolveLogSources([])).toEqual([]);
  });

  /**
   * The three states the slot exists for, asserted against each other rather
   * than one at a time: the point is not that each renders SOMETHING, it is
   * that no two of them render the same thing.
   */
  it("gives a recording-but-quiet source, a switched-off one and an unread one three different sentences", () => {
    const [quiet, off, unread] = resolveLogSources([
      { id: "a", label: "A log", state: "recording", events: [] },
      { id: "b", label: "B log", state: "not-recording" },
      { id: "c", label: "C log", state: "unreadable" },
    ]);

    expect(quiet.note).toBe("A log: recording, nothing yet");
    expect(off.note).toBe("B log: not recording");
    expect(unread.note).toBe("C log: no data received");
    expect(new Set([quiet.note, off.note, unread.note]).size).toBe(3);
  });

  it("carries the contributor's own reason through on both unhappy states", () => {
    const [off, unread] = resolveLogSources([
      {
        id: "b",
        label: "B log",
        state: "not-recording",
        stateReason: "logging is off in this save",
      },
      {
        id: "c",
        label: "C log",
        state: "unreadable",
        stateReason: "channel has not reported",
      },
    ]);
    expect(off.note).toBe("B log: not recording (logging is off in this save)");
    expect(unread.note).toBe(
      "C log: no data received (channel has not reported)",
    );
  });

  it("stays quiet about a recording source that has rows, since the rows are the statement", () => {
    const [source] = resolveLogSources([
      {
        id: "a",
        label: "A log",
        state: "recording",
        events: [{ id: "1", ut: 10, label: "something" }],
      },
    ]);
    expect(source.note).toBeNull();
    expect(source.eventCount).toBe(1);
  });

  /**
   * A source that is not recording keeps whatever it recorded before it was
   * switched off, and those rows still belong on the timeline. The sentence is
   * about what the source can see NOW, so it is said either way.
   */
  it("still says a source is not recording when it handed over historical rows", () => {
    const [source] = resolveLogSources([
      {
        id: "b",
        label: "B log",
        state: "not-recording",
        events: [{ id: "1", ut: 10, label: "before it was switched off" }],
      },
    ]);
    expect(source.note).toBe("B log: not recording");
    expect(source.eventCount).toBe(1);
  });

  it("keeps the first of two sources claiming the same id", () => {
    const sources = resolveLogSources([
      { id: "a", label: "First", state: "recording", events: [] },
      { id: "a", label: "Second", state: "not-recording" },
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0].label).toBe("First");
  });
});

describe("mergeLogRows", () => {
  it("returns the widget's own rows untouched when nobody contributes", () => {
    expect(
      mergeLogRows([own("x", 20), own("y", 10)], []).map((r) => r.key),
    ).toEqual(["y", "x"]);
  });

  it("interleaves contributed rows with the widget's own by game time", () => {
    const entries: MissionLogSourceEntry[] = [
      {
        id: "rp1",
        label: "RP-1 career log",
        state: "recording",
        events: [
          { id: "late", ut: 30, label: "Contract completed" },
          { id: "early", ut: 5, label: "Contract accepted" },
        ],
      },
    ];
    expect(mergeLogRows([own("mine", 20)], entries).map((r) => r.key)).toEqual([
      "rp1:early",
      "mine",
      "rp1:late",
    ]);
  });

  it("keys a contributed row by its source, so two sources can share a row id", () => {
    const entries: MissionLogSourceEntry[] = [
      {
        id: "a",
        label: "A",
        state: "recording",
        events: [{ id: "1", ut: 10, label: "from A" }],
      },
      {
        id: "b",
        label: "B",
        state: "recording",
        events: [{ id: "1", ut: 11, label: "from B" }],
      },
    ];
    expect(mergeLogRows([], entries).map((r) => r.key)).toEqual(["a:1", "b:1"]);
  });

  it("upper-cases the contributor's chip and falls back to LOG without one", () => {
    const entries: MissionLogSourceEntry[] = [
      {
        id: "rp1",
        label: "RP-1 career log",
        state: "recording",
        events: [
          { id: "1", ut: 10, label: "named", kindLabel: "failure" },
          { id: "2", ut: 11, label: "unnamed" },
        ],
      },
    ];
    expect(mergeLogRows([], entries).map((r) => r.badgeLabel)).toEqual([
      "FAILURE",
      "LOG",
    ]);
  });

  it("maps the contributed severity vocabulary onto the host's own", () => {
    const entries: MissionLogSourceEntry[] = [
      {
        id: "rp1",
        label: "RP-1",
        state: "recording",
        events: [
          { id: "1", ut: 10, label: "a", severity: "critical" },
          { id: "2", ut: 11, label: "b" },
        ],
      },
    ];
    const rows = mergeLogRows([], entries);
    expect(rows[0].severity).toBe("critical");
    expect(rows[1].severity).toBeUndefined();
  });

  it("marks rows that share a group so a failure can be seen to belong to a launch", () => {
    const entries: MissionLogSourceEntry[] = [
      {
        id: "rp1",
        label: "RP-1",
        state: "recording",
        events: [
          { id: "launch", ut: 10, label: "Launched", groupId: "L-17" },
          { id: "failure", ut: 12, label: "Engine failed", groupId: "L-17" },
        ],
      },
    ];
    expect(mergeLogRows([], entries).map((r) => r.groupTag)).toEqual([
      "L-17",
      "L-17",
    ]);
  });

  it("drops a group marker no other row shares, since it joins to nothing", () => {
    const entries: MissionLogSourceEntry[] = [
      {
        id: "rp1",
        label: "RP-1",
        state: "recording",
        events: [{ id: "launch", ut: 10, label: "Launched", groupId: "L-18" }],
      },
    ];
    expect(mergeLogRows([], entries)[0].groupTag).toBeUndefined();
  });

  it("takes no rows from the second of two sources claiming the same id", () => {
    const entries: MissionLogSourceEntry[] = [
      {
        id: "a",
        label: "First",
        state: "recording",
        events: [{ id: "1", ut: 10, label: "kept" }],
      },
      {
        id: "a",
        label: "Second",
        state: "recording",
        events: [{ id: "2", ut: 11, label: "dropped" }],
      },
    ];
    expect(mergeLogRows([], entries).map((r) => r.label)).toEqual(["kept"]);
  });
});
