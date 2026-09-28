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
 * What `undefined` means at MapPoiLayer's two absence gates: the
 * `<domain>.available` presence gate on a provider's markers, and the provider
 * contract's `if (!pois)`, where a provider's pending state collapses onto
 * empty.
 */

// Unmount each tree before clearMapPoiProviders(), which would re-render a mounted layer outside act().
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

/** Bare layer, no stream provider, for the gates that are not about telemetry. */
function renderLayer() {
  const view = render(
    <MapPoiLayer bodyId="Kerbin" project={project} width={400} height={200} />,
  );
  renderedTrees.push(view.unmount);
  return view;
}

/** Layer inside a real stream fixture, so `<domain>.available` can be emitted or deliberately withheld. */
function renderLayerOnStream() {
  const fixture = setupStreamFixture({ suspendFrames: true });
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

    const { fixture } = renderLayerOnStream();
    await flushFrames();

    // Undefined means domain not present; the ungated sibling proves the layer rendered, so this is the gate firing.
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

  it("a TOMBSTONED availability topic RELEASES the gate: the confirmed-absent domain renders its markers", async () => {
    registerMapPoiProvider({
      id: "gated",
      requires: "fake-domain",
      usePois: () => [makePoi({ id: "gated-poi", label: "Gated POI" })],
    });

    const { fixture } = renderLayerOnStream();
    await flushFrames();
    expect(screen.queryByRole("button", { name: "Gated POI" })).toBeNull();

    act(() => {
      // A confirmed tombstone: the strongest "this domain is not here".
      fixture.emit("fake-domain.available", null);
    });
    await flushFrames();

    // `=== undefined` lets null through, inverting the store's meanings: never arrived hides the provider, confirmed absent shows it.
    expect(
      screen.getByRole("button", { name: "Gated POI" }),
    ).toBeInTheDocument();
  });

  it("a provider whose usePois is still pending renders no marker, while a loaded sibling does", () => {
    registerMapPoiProvider({ id: "pending", usePois: () => undefined });
    registerMapPoiProvider({
      id: "loaded",
      usePois: () => [makePoi({ id: "loaded-poi", label: "Loaded POI" })],
    });

    renderLayer();

    // Named-element absence beside a named-element presence, so an empty render cannot pass.
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

    // undefined and [] both take a no-markers path; nothing reports "still loading".
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.firstElementChild).not.toBeNull();
  });

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

    // An absent contract term is filtered out, so no agent and an agent not yet arrived look alike.
    expect(screen.queryByText("agent")).toBeNull();
    // A null term is not filtered, and `String(null)` reaches the card.
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

    // Both regions omitted, asserted against the card that is there by its own accessible name.
    const card = screen.getByRole("group", { name: "Runway details" });
    expect(card).toBeInTheDocument();
    expect(visibleText(card)).toBe("Runway-0.05°, -74.70°");
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

    // The layer forwards the absence and leaves each provider to decide.
    expect(seenBodyId).toBeUndefined();
    expect(screen.getByRole("button", { name: "Runway" })).toBeInTheDocument();
  });
});
