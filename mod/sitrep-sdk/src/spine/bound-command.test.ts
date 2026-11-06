import { describe, expect, it, vi } from "vitest";
import { createFakeCommand } from "../testing/fake-command";
import { argsOf, commandSet, runSet } from "./bound-command";

describe("with and toArgs", () => {
  it("bind the arguments, or a function read at the press", () => {
    const fake = createFakeCommand<{ index: number }>();
    expect(argsOf(fake.handle.with({ index: 3 }))).toEqual({ index: 3 });
    let n = 1;
    const live = fake.handle.with(() => ({ index: n }));
    n = 5;
    expect(argsOf(live)).toEqual({ index: 5 });
  });

  it("turn an input's value into arguments, or into nothing to send", () => {
    const fake = createFakeCommand<{ on: boolean }>();
    const value = fake.handle.toArgs((on: boolean | null) =>
      on === null ? undefined : { on },
    );
    expect(value.toArgs(true)).toEqual({ on: true });
    expect(value.toArgs(null)).toBeUndefined();
  });
});

describe("commandSet", () => {
  it("leaves out a member that is false, null or undefined", () => {
    const a = createFakeCommand();
    const set = commandSet([a.handle.with(), false, null, undefined]);
    expect(set.members).toHaveLength(1);
  });

  it("reads as one handle: blocked if any member is, and the worst send status", () => {
    const a = createFakeCommand();
    const b = createFakeCommand();
    b.patch({ gate: { blocked: true, reason: "no" } as never });
    b.patch({
      sendStatus: {
        contact: { kind: "in-contact" },
        arrival: "likely-lost",
      },
    });
    const { handle } = commandSet([a.handle.with(), b.handle.with()]);
    expect(handle.gate?.blocked).toBe(true);
    expect(handle.sendStatus?.arrival).toBe("likely-lost");
  });

  it("is streamDown when any member is", () => {
    const a = createFakeCommand();
    const b = createFakeCommand();
    b.patch({ streamDown: true });
    expect(
      commandSet([a.handle.with(), b.handle.with()]).handle.streamDown,
    ).toBe(true);
  });
});

describe("runSet", () => {
  it("sends every member at once and reports the count", async () => {
    const a = createFakeCommand<{ n: number }>();
    const b = createFakeCommand<{ n: number }>();
    const onSettled = vi.fn();
    const set = commandSet([a.handle.with({ n: 1 }), b.handle.with({ n: 2 })], {
      onSettled,
    });
    await runSet(set.members ?? [], set.set ?? {});
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(onSettled).toHaveBeenCalledWith({
      total: 2,
      confirmed: 2,
      failed: 0,
    });
  });

  it("one at a time carries on past a refusal, and stops at the first when told to", async () => {
    const make = () => {
      const bad = createFakeCommand({ answer: "hold" });
      const good = createFakeCommand();
      return { bad, good };
    };
    const carry = make();
    const carried = commandSet(
      [carry.bad.handle.with(), carry.good.handle.with()],
      { order: "one-at-a-time" },
    );
    const carriedRun = runSet(carried.members ?? [], carried.set ?? {});
    await Promise.resolve();
    carry.bad.refuse("no");
    const result = await carriedRun;
    expect(carry.good.sent).toHaveLength(1);
    expect(result).toMatchObject({ total: 2, confirmed: 1, failed: 1 });

    const stop = make();
    const stopped = commandSet(
      [stop.bad.handle.with(), stop.good.handle.with()],
      { order: "one-at-a-time", stopAtFirstFailure: true },
    );
    const stoppedRun = runSet(stopped.members ?? [], stopped.set ?? {});
    await Promise.resolve();
    stop.bad.refuse("no");
    await stoppedRun;
    expect(stop.good.sent).toHaveLength(0);
  });
});
