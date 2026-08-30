import {
  clearMapPoiProviders,
  type MapPoi,
  registerMapPoiProvider,
} from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MapPoiLayer } from "./MapPoiLayer";

/**
 * What `undefined` MEANS at MapPoiLayer's two absence gates today, ahead of
 * `useTelemetry` returning a `Reading`.
 *
 * The layer has exactly one telemetry read, `PoiProviderGate`'s
 * `useTelemetry("<domain>.available")`, and it is a pure presence gate:
 * `available === undefined` decides whether a whole provider's markers exist.
 * The second gate, `if (!pois)`, is on the provider contract rather than on
 * telemetry, but it is where a provider's own pending state lands and it
 * collapses pending onto empty, so it is pinned here too.
 */

// Unmount each rendered tree BEFORE clearMapPoiProviders(): clearing the
// registry re-renders a still-mounted layer, a state update outside act().
const renderedTrees: Array<() => void> = [];
afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearMapPoiProviders();
});

const project = (lat: number, lon: number) => ({ x: lat, y: lon });

function makePoi(overrides: Partial<MapPoi> = {}): MapPoi {
  return {
    id: "poi-1",
    bodyId: "Kerbin",
    lat: -0.05,
    lon: -74.7,
    kind: "ksc",
    label: "KSC",
    ...overrides,
  };
}

/** Bare layer, no stream provider mounted: for the gates that are not about
 *  telemetry. */
function renderLayer() {
  const view = render(
    <MapPoiLayer bodyId="Kerbin" project={project} width={400} height={200} />,
  );
  renderedTrees.push(view.unmount);
  return view;
}

/** Layer inside a real stream fixture, so `<domain>.available` can be emitted
 *  (or deliberately not) rather than being absent for want of a store. */
function renderLayerOnStream(carriedChannels: string[]) {
  const fixture = setupStreamFixture({ carriedChannels, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <MapPoiLayer bodyId="Kerbin" project={project} width={400} height={200} />
    </fixture.Provider>,
  );
  renderedTrees.push(view.unmount);
  return { ...view, fixture };
}

async function flushFrames(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

describe("MapPoiLayer: what undefined telemetry means today", () => {
  // ── 1 and 2. Nothing has arrived, and the gate that tests for it ────────

  it("a gated provider is hidden while its availability topic is undefined, and appears the moment it arrives", async () => {
    registerMapPoiProvider({
      id: "gated",
      requires: "fake-domain",
      usePois: () => [makePoi({ id: "gated-poi", label: "Gated POI" })],
    });
    registerMapPoiProvider({
      id: "ungated",
      usePois: () => [makePoi({ id: "ungated-poi", label: "Ungated POI" })],
    });

    const { fixture } = renderLayerOnStream(["fake-domain.available"]);
    await flushFrames();

    // `if (provider.requires && available === undefined) return null`: this is
    // the whole gate, and undefined here means DOMAIN NOT PRESENT. The
    // ungated sibling proves the layer itself is rendering, so the gated
    // marker's absence is the gate firing and not an empty render.
    expect(screen.queryByRole("button", { name: "Gated POI" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Ungated POI" }),
    ).toBeInTheDocument();

    act(() => {
      fixture.emit("fake-domain.available", { present: true });
    });
    await flushFrames();

    expect(
      screen.getByRole("button", { name: "Gated POI" }),
    ).toBeInTheDocument();
  });

  // ── 3. null versus undefined: this gate distinguishes them, backwards ───

  it("a TOMBSTONED availability topic RELEASES the gate: the confirmed-absent domain renders its markers", async () => {
    registerMapPoiProvider({
      id: "gated",
      requires: "fake-domain",
      usePois: () => [makePoi({ id: "gated-poi", label: "Gated POI" })],
    });

    const { fixture } = renderLayerOnStream(["fake-domain.available"]);
    await flushFrames();
    expect(screen.queryByRole("button", { name: "Gated POI" })).toBeNull();

    act(() => {
      // A confirmed tombstone: the subject says there is no availability
      // record, which is the strongest possible "this domain is not here".
      fixture.emit("fake-domain.available", null);
    });
    await flushFrames();

    // The gate is `=== undefined`, so null walks straight through it. The
    // meanings are INVERTED against the store's: "never arrived" hides the
    // provider, "confirmed absent" shows it. Pinning it because a faithful
    // migration must reproduce this, and a corrected one must be a deliberate
    // decision rather than a side effect.
    expect(
      screen.getByRole("button", { name: "Gated POI" }),
    ).toBeInTheDocument();
  });

  // ── 2 (continued). The provider-contract absence gate ──────────────────

  it("a provider whose usePois is still pending renders no marker, while a loaded sibling does", () => {
    registerMapPoiProvider({ id: "pending", usePois: () => undefined });
    registerMapPoiProvider({
      id: "loaded",
      usePois: () => [makePoi({ id: "loaded-poi", label: "Loaded POI" })],
    });

    renderLayer();

    // `if (!pois) return null` in PoiProviderMarkers. Named-element absence
    // beside a named-element presence, so this cannot pass on an empty render.
    expect(screen.queryByRole("button", { name: "KSC" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Loaded POI" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("pending and confirmed-empty providers are indistinguishable in the rendered layer", () => {
    registerMapPoiProvider({ id: "pending", usePois: () => undefined });
    registerMapPoiProvider({ id: "empty", usePois: () => [] });

    const { container } = renderLayer();

    // The provider contract's one honest distinction (undefined versus []) is
    // discarded here: both take a no-markers path, one through `if (!pois)`
    // and one through mapping an empty array. Nothing in the layer reports
    // "still loading", so the layer's root is the only thing left.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.firstElementChild).not.toBeNull();
  });

  // ── 4. A partial payload: the POI arrived, a field within it did not ────

  it("an undefined meta value is dropped from the hover card, while a null one is printed as the string null", () => {
    registerMapPoiProvider({
      id: "vanilla:test",
      usePois: () => [
        makePoi({
          label: "Recover the flag",
          kind: "contractTarget",
          status: "active",
          meta: {
            agent: undefined,
            fundsAdvance: 1000,
            deadline: null,
          },
        }),
      ],
    });

    const { container } = renderLayer();
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Recover the flag" }),
    );

    // `.filter(([, value]) => value !== undefined)`: an absent contract term
    // is silently removed, so the operator cannot tell a contract with no
    // agent from one whose agent has not arrived.
    expect(screen.queryByText("agent")).toBeNull();
    // A null term is NOT filtered, and `String(null)` reaches the card. This
    // is the same null-versus-undefined split as the availability gate above,
    // and it also treats null as the more present of the two.
    expect(visibleText(container)).toContain("deadlinenull");
    expect(screen.getByText("fundsAdvance")).toBeInTheDocument();
  });

  it("a POI with no detail and no actions still opens a hover card, with those regions absent rather than blank", () => {
    registerMapPoiProvider({
      id: "vanilla:test",
      usePois: () => [makePoi({ label: "Runway" })],
    });

    renderLayer();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Runway" }));

    // `poi.detail &&` and `poi.actions && poi.actions.length > 0`: both
    // regions are omitted. Asserted against the card that IS there, by its
    // own accessible name, so an entirely-unrendered card would fail this.
    const card = screen.getByRole("group", { name: "Runway details" });
    expect(card).toBeInTheDocument();
    expect(visibleText(card)).toBe("Runway-0.05°, -74.70°");
    // Only the marker button exists, no action button inside the card.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("an undefined bodyId is handed to every provider as undefined, and does not stop the layer rendering", () => {
    let seenBodyId: string | undefined | "not-called" = "not-called";
    registerMapPoiProvider({
      id: "vanilla:test",
      usePois: (ctx) => {
        seenBodyId = ctx.bodyId;
        return [makePoi({ label: "Runway" })];
      },
    });

    const view = render(
      <MapPoiLayer
        bodyId={undefined}
        project={project}
        width={400}
        height={200}
      />,
    );
    renderedTrees.push(view.unmount);

    // The layer has no gate of its own on bodyId: it forwards the absence and
    // leaves each provider to decide, which is what vanillaPoiProvider's own
    // `!ctx.bodyId` branch then does.
    expect(seenBodyId).toBeUndefined();
    expect(screen.getByRole("button", { name: "Runway" })).toBeInTheDocument();
  });
});
