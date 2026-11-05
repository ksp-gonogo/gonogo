import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* The fields this test reads from the channels it replays; a channel's value is null when nothing is held. */
interface Emit {
  channel: string;
  value: { kerbalsKilled?: string[]; kerbals?: { name: string }[] } | null;
}

function replay(name: string): Emit[] {
  const url = new URL(`./__fixtures__/crash/${name}.json`, import.meta.url);
  const fixture: { emits: Emit[] } = JSON.parse(readFileSync(url, "utf8"));
  return fixture.emits;
}

function lastCrashKilled(emits: Emit[]): string[] {
  const reports = emits.filter(
    (e) => e.channel === "crash.lastCrash" && e.value !== null,
  );
  return reports.at(-1)?.value?.kerbalsKilled ?? [];
}

function onEva(emits: Emit[]): string[] {
  return emits
    .filter((e) => e.channel === "eva.crew" && e.value !== null)
    .flatMap((e) => e.value?.kerbals ?? [])
    .map((k) => k.name);
}

/*
 * Wire recorded from a running game. What the game itself reported dying is
 * stated per scenario: its flight results and astronaut roster.
 */
describe("a crash that leaves crew alive", () => {
  it("names nobody killed when a separated pod lands under its parachute", () => {
    for (const name of [
      "crash-separated-pod",
      "crash-separated-pod-pod-root",
    ]) {
      expect(lastCrashKilled(replay(name)), name).toEqual([]);
    }
  });

  it("names only the kerbal who died when another is on EVA", () => {
    const emits = replay("crash-eva");

    expect(lastCrashKilled(emits)).toEqual(["Jebediah Kerman"]);
    expect(onEva(emits)).toContain("Kathlas Kerman");
    for (const name of onEva(emits)) {
      expect(lastCrashKilled(emits)).not.toContain(name);
    }
  });
});
