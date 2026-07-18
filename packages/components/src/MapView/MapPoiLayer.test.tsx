import {
  clearMapPoiProviders,
  type MapPoi,
  registerMapPoiProvider,
} from "@ksp-gonogo/core";
import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { MapPoiLayer } from "./MapPoiLayer";

afterEach(() => clearMapPoiProviders());

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

describe("MapPoiLayer", () => {
  it("renders a marker only for a provider whose requires gate is satisfied", () => {
    registerMapPoiProvider({
      id: "gated",
      requires: "fake-domain",
      usePois: () => [makePoi({ id: "gated-poi", label: "Gated POI" })],
    });
    registerMapPoiProvider({
      id: "ungated",
      usePois: () => [makePoi({ id: "ungated-poi", label: "Ungated POI" })],
    });

    render(
      <MapPoiLayer
        bodyId="Kerbin"
        project={project}
        width={400}
        height={200}
      />,
    );

    expect(screen.queryByRole("button", { name: "Gated POI" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Ungated POI" }),
    ).toBeInTheDocument();
  });

  it("shows label, detail and formatted coordinates in a hover card on marker hover", () => {
    registerMapPoiProvider({
      id: "vanilla:test",
      usePois: () => [
        makePoi({
          id: "poi-1",
          label: "Runway",
          detail: "Launch pad",
          lat: -0.0486,
          lon: -74.72,
        }),
      ],
    });

    render(
      <MapPoiLayer
        bodyId="Kerbin"
        project={project}
        width={400}
        height={200}
      />,
    );

    expect(screen.queryByText("Launch pad")).toBeNull();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Runway" }));

    expect(screen.getByText("Runway")).toBeInTheDocument();
    expect(screen.getByText("Launch pad")).toBeInTheDocument();
    expect(screen.getByText(/-0\.05.*-74\.72/)).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole("button", { name: "Runway" }));
    expect(screen.queryByText("Launch pad")).toBeNull();
  });

  it("renders every meta entry as a key/value row in the hover card", () => {
    registerMapPoiProvider({
      id: "vanilla:test",
      usePois: () => [
        makePoi({
          id: "poi-1",
          label: "Recover the flag",
          kind: "contractTarget",
          status: "active",
          meta: { agent: "Kerbin Space Agency", fundsAdvance: 1000 },
        }),
      ],
    });

    render(
      <MapPoiLayer
        bodyId="Kerbin"
        project={project}
        width={400}
        height={200}
      />,
    );

    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Recover the flag" }),
    );

    expect(screen.getByText("Kerbin Space Agency")).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
  });

  it("dispatches a POI's action when its hover-card button is clicked", () => {
    const run = vi.fn();
    registerMapPoiProvider({
      id: "vanilla:test",
      usePois: () => [
        makePoi({
          id: "poi-1",
          label: "Runway",
          actions: [{ id: "set-target", label: "Set as Target", run }],
        }),
      ],
    });

    render(
      <MapPoiLayer
        bodyId="Kerbin"
        project={project}
        width={400}
        height={200}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Runway" }));
    fireEvent.click(screen.getByRole("button", { name: "Set as Target" }));

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back to a neutral style for an unrecognised kind instead of throwing", () => {
    registerMapPoiProvider({
      id: "third-party",
      usePois: () => [
        makePoi({ id: "mystery", label: "Mystery", kind: "third-party-thing" }),
      ],
    });

    render(
      <MapPoiLayer
        bodyId="Kerbin"
        project={project}
        width={400}
        height={200}
      />,
    );

    expect(screen.getByRole("button", { name: "Mystery" })).toBeInTheDocument();
  });

  it("renders nothing extra when no providers are registered", () => {
    const { container } = render(
      <MapPoiLayer
        bodyId="Kerbin"
        project={project}
        width={400}
        height={200}
      />,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelectorAll("*").length).toBeGreaterThan(0);
  });

  it("a11y smoke: markers + open hover card have no violations", async () => {
    registerMapPoiProvider({
      id: "vanilla:test",
      usePois: () => [
        makePoi({
          id: "poi-1",
          label: "Runway",
          detail: "Launch pad",
          actions: [
            { id: "set-target", label: "Set as Target", run: () => {} },
          ],
        }),
      ],
    });

    const { container } = render(
      <MapPoiLayer
        bodyId="Kerbin"
        project={project}
        width={400}
        height={200}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Runway" }));

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
