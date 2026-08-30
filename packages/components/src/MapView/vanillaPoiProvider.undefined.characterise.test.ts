import { clearRegistry, getMapPoiProviders } from "@ksp-gonogo/core";
import { act, renderHook } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./vanillaPoiProvider";

/**
 * What `undefined` MEANS inside the vanilla POI provider today, ahead of
 * `useTelemetry` returning a `Reading`.
 *
 * This module is the one place in MapView that deliberately forwards a
 * three-state answer: `undefined` for "spaceCenter.pois has not arrived",
 * `[]` for "arrived, nothing here". `MapPoiLayer` then renders nothing for
 * either, so the distinction is only observable at this hook's return value,
 * which is what these tests read.
 */

function getProvider() {
  const provider = getMapPoiProviders().find(
    (p) => p.id === "vanilla:spaceCenter",
  );
  if (!provider) throw new Error("vanilla:spaceCenter provider not registered");
  return provider;
}

// Unmount BEFORE clearRegistry() notifies the DataSource-registry subscribers:
// useTelemetry keeps its legacy subscription wired unconditionally, so clearing
// on a still-mounted tree is a state update outside act(). Note this file does
// NOT clear the MapPoi registry, the provider under test registers itself once
// at module load.
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearRegistry();
});

function renderPois(
  bodyId: string | undefined,
  carriedChannels: string[] = ["spaceCenter.pois", "system.bodies"],
) {
  const fixture = setupStreamFixture({ carriedChannels, suspendFrames: true });
  const provider = getProvider();
  const { result, unmount } = renderHook(() => provider.usePois({ bodyId }), {
    wrapper: fixture.Provider,
  });
  renderedTrees.push(unmount);
  return { result, fixture };
}

async function flushFrames(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

describe("vanillaPoiProvider: what undefined telemetry means today", () => {
  // ── 1. Nothing has arrived at all ──────────────────────────────────────

  it("nothing emitted: undefined is forwarded as undefined, the provider's own PENDING signal", async () => {
    const { result } = renderPois("Kerbin");
    await flushFrames();

    // `raw === undefined ? undefined : []`: the one absence distinction this
    // file makes, and the only reason MapPoiLayer's `if (!pois)` has two
    // reachable inputs.
    expect(result.current).toBeUndefined();
  });

  it("nothing emitted AND no mapped body: still undefined, because the raw gate is checked before the body gate's fallback", async () => {
    const { result } = renderPois(undefined);
    await flushFrames();

    // `if (!raw || !ctx.bodyId) return raw === undefined ? undefined : []` is
    // one gate with two conditions and a return that only consults `raw`, so
    // an absent body cannot produce `[]` while the topic is still pending.
    expect(result.current).toBeUndefined();
  });

  // ── 2. Gates that test for absence ─────────────────────────────────────

  it("POIs arrived but the mapped body is undefined: reads as EMPTY, not as pending", async () => {
    const { result, fixture } = renderPois(undefined);
    act(() => {
      fixture.emit("system.bodies", { bodies: [{ index: 1, name: "Kerbin" }] });
      fixture.emit("spaceCenter.pois", [
        {
          id: "launchSite:Runway",
          kind: "ksc",
          bodyIndex: 1,
          latitude: -0.05,
          longitude: -74.7,
          label: "Runway",
        },
      ]);
    });
    await flushFrames();

    // The `!ctx.bodyId` half of the gate fires here and the return says `[]`,
    // so a real POI the operator could act on is reported as "no POIs on this
    // body" rather than "no body chosen yet".
    expect(result.current).toEqual([]);
  });

  it("POIs arrived but system.bodies never did: every POI is SILENTLY dropped, reported as an empty body", async () => {
    const { result, fixture } = renderPois("Kerbin");
    act(() => {
      fixture.emit("spaceCenter.pois", [
        {
          id: "launchSite:Runway",
          kind: "ksc",
          bodyIndex: 1,
          latitude: -0.05,
          longitude: -74.7,
          label: "Runway",
        },
      ]);
    });
    await flushFrames();

    // `useBodyNameByIndex` spells the absent body table as `?? []`, giving an
    // EMPTY index→name map, and the filter then matches nothing. There is no
    // gate for "the table has not arrived", so the pending state of one topic
    // is reported as a confirmed fact about another.
    expect(result.current).toEqual([]);
  });

  it("a system.bodies entry with no name is dropped from the index, taking its POIs with it", async () => {
    const { result, fixture } = renderPois("Kerbin");
    act(() => {
      // Body 1 arrived without a name, body 2 named. `if (body.name != null)`
      // silently skips the first, so its POI can never match any bodyId.
      fixture.emit("system.bodies", {
        bodies: [{ index: 1 }, { index: 2, name: "Mun" }],
      });
      fixture.emit("spaceCenter.pois", [
        {
          id: "launchSite:Runway",
          kind: "ksc",
          bodyIndex: 1,
          latitude: -0.05,
          longitude: -74.7,
          label: "Runway",
        },
      ]);
    });
    await flushFrames();

    expect(result.current).toEqual([]);
  });

  // ── 3. null versus undefined: this site DOES distinguish them ──────────

  it("a TOMBSTONED spaceCenter.pois reads as EMPTY, not pending: null and undefined mean different things here", async () => {
    const { result, fixture } = renderPois("Kerbin");
    await flushFrames();
    expect(result.current).toBeUndefined();

    act(() => {
      // A confirmed tombstone: the subject says there is no POI record.
      fixture.emit("spaceCenter.pois", null);
    });
    await flushFrames();

    // `!raw` is true for null, `raw === undefined` is false, so the tombstone
    // takes the `[]` branch. This is the CORRECT reading of the two: a
    // confirmed absence is a load that found nothing. It is the only site
    // across these three files that gets it this way round.
    expect(result.current).toEqual([]);
  });

  // ── 4. A partial payload: the record arrived, a field did not ──────────

  it("a POI entry missing any required field vanishes entirely rather than rendering partially", async () => {
    const { result, fixture } = renderPois("Kerbin");
    act(() => {
      fixture.emit("system.bodies", { bodies: [{ index: 1, name: "Kerbin" }] });
      fixture.emit("spaceCenter.pois", [
        {
          id: "complete",
          kind: "ksc",
          bodyIndex: 1,
          latitude: -0.05,
          longitude: -74.7,
          label: "Runway",
        },
        // Each of these trips one clause of `toMapPoi`'s six-way `== null`
        // gate. All of them return null and are filtered out, so a partially
        // populated POI is indistinguishable from one the server never sent.
        {
          id: "no-label",
          kind: "ksc",
          bodyIndex: 1,
          latitude: 0,
          longitude: 0,
        },
        {
          id: "no-latitude",
          kind: "ksc",
          bodyIndex: 1,
          longitude: 0,
          label: "A",
        },
        {
          id: "no-longitude",
          kind: "ksc",
          bodyIndex: 1,
          latitude: 0,
          label: "B",
        },
        { id: "no-kind", bodyIndex: 1, latitude: 0, longitude: 0, label: "C" },
        {
          kind: "ksc",
          bodyIndex: 1,
          latitude: 0,
          longitude: 0,
          label: "no id",
        },
      ]);
    });
    await flushFrames();

    expect(result.current?.map((poi) => poi.id)).toEqual(["complete"]);
  });

  it("a POI entry with no bodyIndex is dropped by the body filter, before toMapPoi ever sees it", async () => {
    const { result, fixture } = renderPois("Kerbin");
    act(() => {
      fixture.emit("system.bodies", { bodies: [{ index: 1, name: "Kerbin" }] });
      fixture.emit("spaceCenter.pois", [
        {
          id: "no-bodyIndex",
          kind: "ksc",
          latitude: 0,
          longitude: 0,
          label: "Orphan",
        },
      ]);
    });
    await flushFrames();

    // `entry.bodyIndex != null` in the filter: an unplaceable POI reads as
    // "not on this body" rather than as an error or a warning.
    expect(result.current).toEqual([]);
  });

  it("a contractTarget with no funds/agent fields still becomes a POI, carrying undefined meta values", async () => {
    const { result, fixture } = renderPois("Kerbin");
    act(() => {
      fixture.emit("system.bodies", { bodies: [{ index: 1, name: "Kerbin" }] });
      fixture.emit("spaceCenter.pois", [
        {
          id: "contract:bare",
          kind: "contractTarget",
          bodyIndex: 1,
          latitude: 5,
          longitude: 100,
          label: "Recover the flag",
        },
      ]);
    });
    await flushFrames();

    // The `== null` gate covers only the six positional/identity fields, so a
    // contract whose economics never arrived is still a marker, with its meta
    // bag's values undefined. MapPoiLayer then filters those rows out of the
    // hover card, so the operator sees a contract with no terms at all.
    expect(result.current).toHaveLength(1);
    expect(result.current?.[0].meta).toEqual({
      agent: undefined,
      fundsAdvance: undefined,
      fundsCompletion: undefined,
      deadline: undefined,
    });
  });
});
