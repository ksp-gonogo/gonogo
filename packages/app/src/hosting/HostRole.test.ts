import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeHostMod } from "../test/fakeHostMod";
import { HostRole } from "./HostRole";

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function open(mod: FakeHostMod, token: string) {
  const role = new HostRole(token);
  const connection = mod.connect();
  role.attach(connection);
  await settle();
  return { role, connection };
}

describe("a local screen's part in the host role", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits until the mod has answered, then hosts when nobody holds the role", async () => {
    const mod = new FakeHostMod();
    const role = new HostRole("tab-a");
    expect(role.state.kind).toBe("waiting");

    role.attach(mod.connect());
    await settle();

    expect(role.state).toMatchObject({ kind: "hosting", takeover: false });
    expect(role.state.kind === "hosting" && role.state.record.code).toBe(
      "ABC234",
    );
  });

  it("carries the mod's grant count in the hosting state, and moves it when the role is granted again", async () => {
    const mod = new FakeHostMod();
    const role = new HostRole("tab-a");
    role.attach(mod.connect());
    await settle();
    expect(role.state).toMatchObject({ kind: "hosting", generation: 1 });

    role.attach(mod.connect());
    await settle();

    expect(role.state).toMatchObject({ kind: "hosting", generation: 2 });
  });

  it("joins the holder when a second screen is refused, with the holder's code", async () => {
    const mod = new FakeHostMod();
    await open(mod, "tab-a");
    const { role } = await open(mod, "tab-b");

    expect(role.state.kind).toBe("joined");
    expect(role.state.kind === "joined" && role.state.record.code).toBe(
      "ABC234",
    );
  });

  it("keeps the role with a heartbeat at the interval the claim was answered with", async () => {
    const mod = new FakeHostMod();
    const { role } = await open(mod, "tab-a");

    await vi.advanceTimersByTimeAsync(60_000);
    mod.tick();
    await settle();

    expect(role.state.kind).toBe("hosting");
    expect(mod.sent.filter((s) => s.command === "host.heartbeat").length).toBe(
      12,
    );
  });

  it("takes over after the grace once the holder stops heartbeating, and says it took over", async () => {
    const mod = new FakeHostMod();
    const host = await open(mod, "tab-a");
    const joined = await open(mod, "tab-b");
    host.role.dispose();

    await vi.advanceTimersByTimeAsync(16_000);
    mod.tick();
    await settle();

    expect(joined.role.state).toMatchObject({
      kind: "hosting",
      takeover: true,
    });
    expect(
      joined.role.state.kind === "hosting" && joined.role.state.record.code,
    ).toBe("ABC234");
  });

  it("steps down when a heartbeat is answered that it no longer holds the role", async () => {
    const mod = new FakeHostMod();
    const host = await open(mod, "tab-a");
    const other = await open(mod, "tab-b");
    host.connection.close();
    await vi.advanceTimersByTimeAsync(16_000);
    mod.tick();
    await settle();
    expect(other.role.state.kind).toBe("hosting");

    const back = mod.connect();
    host.role.attach(back);
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();

    expect(host.role.state.kind).toBe("joined");
  });

  it("frees the role at once on release, so the next screen claims without waiting out the grace", async () => {
    const mod = new FakeHostMod();
    const host = await open(mod, "tab-a");
    const joined = await open(mod, "tab-b");

    host.role.release();
    await settle();

    expect(joined.role.state).toMatchObject({
      kind: "hosting",
      takeover: true,
    });
    expect(mod.sent.map((s) => s.command)).toContain("host.release");
  });

  it("claims at once when the holder's connection has closed, and says it took over from a host it never saw", async () => {
    const mod = new FakeHostMod();
    const host = await open(mod, "tab-a");
    host.connection.close();
    host.role.dispose();

    const fresh = await open(mod, "tab-b");

    expect(fresh.role.state).toMatchObject({
      kind: "hosting",
      takeover: true,
    });
  });

  it("does not say it took over when it is the first host the game has had", async () => {
    const mod = new FakeHostMod();

    const first = await open(mod, "tab-a");

    expect(first.role.state).toMatchObject({
      kind: "hosting",
      takeover: false,
    });
  });

  it("does not claim from a holder that is away when a joined screen reconnects", async () => {
    const mod = new FakeHostMod();
    const host = await open(mod, "tab-a");
    const joined = await open(mod, "tab-b");
    host.connection.close();

    joined.role.attach(mod.connect());
    await settle();

    expect(joined.role.state.kind).toBe("joined");
  });

  it("takes the role straight back on a reload inside the grace", async () => {
    const mod = new FakeHostMod();
    const host = await open(mod, "tab-a");
    await open(mod, "tab-b");
    host.connection.close();
    host.role.dispose();

    const reloaded = await open(mod, "tab-a");

    expect(reloaded.role.state).toMatchObject({
      kind: "hosting",
      takeover: false,
    });
  });

  it("checks, approves and revokes stations through the mod as the holder", async () => {
    const mod = new FakeHostMod();
    const { role } = await open(mod, "tab-a");

    expect(await role.checkStation("cred-1")).toMatchObject({
      approved: false,
    });
    expect(await role.approveStation("cred-1", "Flight")).toBe(true);
    await settle();
    const check = await role.checkStation("cred-1");
    expect(check).toMatchObject({ approved: true, name: "Flight" });
    expect(role.state.kind === "hosting" && role.state.record.stations).toEqual(
      [expect.objectContaining({ name: "Flight" })],
    );

    expect(await role.revokeStation(check?.stationId ?? "")).toBe(true);
    expect(await role.checkStation("cred-1")).toMatchObject({
      approved: false,
    });
  });

  it("is refused the holder's commands while it has joined", async () => {
    const mod = new FakeHostMod();
    await open(mod, "tab-a");
    const { role } = await open(mod, "tab-b");

    expect(await role.regenerateCode()).toBe(false);
    expect(await role.checkStation("cred-1")).toBeUndefined();
  });
});
