import { useTelemetry } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SceneChangeBanner } from "./SceneChangeBanner";

/**
 * What `SceneChangeBanner` DOES today when `spaceCenter.scene` reads
 * `undefined`, recorded before `useTelemetry` starts returning a `Reading`.
 *
 * Two absence gates decide everything here, and they are chained:
 * `useTelemetry("spaceCenter.scene")?.scene` narrowed by
 * `typeof sceneRaw === "string" ? sceneRaw : null`, then `if (scene === null)
 * return` inside the effect. Between them, four different situations (nothing
 * arrived, a record with no `scene` field, a `scene: null` field, a whole-topic
 * tombstone) all collapse to the same one: skip, change nothing, keep the last
 * scene remembered.
 *
 * Consequence worth naming: the banner is announce-on-edge, so "skip" is not
 * neutral. A gap in the stream is silently absorbed, and the NEXT scene to
 * arrive is compared against the scene from before the gap. That is the
 * behaviour the migration reassigns, and it is recorded here rather than judged.
 */

const STORAGE_KEY = "gonogo.scene-banner.lastSeen";

/**
 * The raw read, so a test about which absence it got records which one.
 *
 * It used to print `undefined` vs the JSON payload, because `null` and `undefined`
 * were the only two things a read could answer with and the point was to catch which
 * arrived. That distinction now lives in the reading's ARM, and the arm says it
 * properly: `pending` for nothing-yet and `absent` for a confirmed tombstone, which
 * the old spelling could not tell apart at all.
 */
function SceneProbe() {
  const reading = useTelemetry("spaceCenter.scene");
  const detail =
    reading.state === "observed" || reading.state === "stale"
      ? JSON.stringify(reading.value)
      : "";
  return <p>{`scene:${reading.state}${detail}`}</p>;
}

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: ["spaceCenter.scene"],
    pinnedUt: 10,
  });
  const view = render(
    <fixture.Provider>
      <SceneChangeBanner />
      <SceneProbe />
    </fixture.Provider>,
  );
  return {
    ...fixture,
    ...view,
    emitScene: (payload: unknown) => {
      act(() => {
        fixture.emit("spaceCenter.scene", payload);
        fixture.store.beginFrame();
      });
    },
  };
}

/** The banner is the only `role="status"` in this tree. */
const banner = () => screen.queryByRole("status");

beforeEach(() => {
  vi.useFakeTimers();
  // `prevSceneRef` seeds from localStorage, so a leaked key from another test
  // would turn the first arriving sample into a transition.
  globalThis.localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.localStorage.removeItem(STORAGE_KEY);
});

describe("SceneChangeBanner: what undefined means for spaceCenter.scene today", () => {
  it("renders no banner element at all before any scene sample arrives", () => {
    const fixture = mount();

    expect(screen.getByText("scene:pending")).toBeInTheDocument();
    // Asserted as the named live region being absent rather than as an empty
    // container: the component returns `null` for this case, and an empty
    // container would also pass if it rendered the banner with no text.
    expect(banner()).toBeNull();
    expect(screen.queryByText("→")).toBeNull();

    fixture.unmount();
  });

  it("swallows a record whose scene field never arrived: it neither banners nor counts as the first scene", () => {
    const fixture = mount();

    // A partial payload: the record landed, the one field the widget reads did
    // not. `typeof undefined === "string"` is false, so the effect's gate fires
    // and NOTHING is remembered, not even as a bootstrap value.
    fixture.emitScene({});
    expect(screen.getByText("scene:observed{}")).toBeInTheDocument();
    expect(banner()).toBeNull();

    // Proof that the partial record was not remembered: the next real scene is
    // still treated as this device's first-ever sample (bootstrap, no banner)
    // rather than as a transition out of the partial one.
    fixture.emitScene({ scene: "Flight" });
    expect(banner()).toBeNull();
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe("Flight");

    // And the machinery is genuinely live: the sample after that does banner.
    fixture.emitScene({ scene: "SpaceCenter" });
    expect(banner()).toHaveTextContent("Flight");
    expect(banner()).toHaveTextContent("Space Center");

    fixture.unmount();
  });

  it("treats an explicit scene: null field as pending, holding the previous scene across it", () => {
    const fixture = mount();

    fixture.emitScene({ scene: "SpaceCenter" });
    fixture.emitScene({ scene: "Flight" });
    expect(banner()).toHaveTextContent("Flight");
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(banner()).toBeNull();

    // A field-level `null` is the store's confirmed "there is no scene". This
    // widget implements `null` as PENDING, not as a tombstone: the gate returns
    // early, so nothing is announced and `prevSceneRef` still holds "Flight".
    fixture.emitScene({ scene: null });
    expect(
      screen.getByText('scene:observed{"scene":null}'),
    ).toBeInTheDocument();
    expect(banner()).toBeNull();
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe("Flight");

    // Because the previous scene was held rather than cleared, Flight arriving
    // again after the gap is "no change" and stays silent.
    fixture.emitScene({ scene: "Flight" });
    expect(banner()).toBeNull();

    fixture.unmount();
  });

  /**
   * Recorded prior behaviour: "treats a whole-topic tombstone the same as pending".
   * It genuinely did, because both reached the widget as a falsy read. They are now
   * different arms, `absent` and `pending`, and the probe below shows the widget
   * being TOLD which one it has. What the banner does with them is unchanged and
   * deliberately so: neither is a scene, so neither is a transition to announce.
   */
  it("is told a tombstone apart from pending, and still banners across the gap", () => {
    const fixture = mount();

    fixture.emitScene({ scene: "SpaceCenter" });
    fixture.emitScene({ scene: "Flight" });
    act(() => {
      vi.advanceTimersByTime(11_000);
    });

    // `null` for the whole topic is the strongest absence the store can state.
    // The optional chain turns it into `undefined` before the widget ever sees
    // it, so it is indistinguishable from never-arrived: same silence, same
    // retained previous scene.
    fixture.emitScene(null);
    expect(screen.getByText("scene:absent")).toBeInTheDocument();
    expect(banner()).toBeNull();

    // The scene that arrives after the gap is compared against the scene from
    // BEFORE it, so the operator is told about a transition whose middle the
    // app never saw. Pinned as observed behaviour, not endorsed.
    fixture.emitScene({ scene: "TrackingStation" });
    expect(banner()).toHaveTextContent("Flight");
    expect(banner()).toHaveTextContent("Tracking Station");

    fixture.unmount();
  });

  it("banners on the very first arriving sample when localStorage already remembers a different scene", () => {
    // Pins what makes the never-arrived case above silent: it is the absence of
    // a remembered scene, NOT the absence of telemetry. With a stored scene, the
    // first sample of a reload is a transition and announces immediately.
    globalThis.localStorage.setItem(STORAGE_KEY, "SpaceCenter");
    const fixture = mount();

    expect(banner()).toBeNull();
    fixture.emitScene({ scene: "Flight" });
    expect(banner()).toHaveTextContent("Space Center");
    expect(banner()).toHaveTextContent("Flight");

    fixture.unmount();
  });
});
