import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import { act, renderHook } from "@ksp-gonogo/test-utils";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useMapViewActions } from "./actions";
import {
  type Camera,
  fitCamera,
  type ViewMode,
  WORLD_H,
  WORLD_W,
  zoomBounds,
} from "./camera";

const INSTANCE = "map-actions";
const BASE_ZOOM = 0.25;
const CONTAINER = { w: 800, h: 400 };

function wrapper({ children }: { children: ReactNode }) {
  return (
    <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
      {children}
    </DashboardItemContext.Provider>
  );
}

/** The map's own camera and view-mode state, wired to the actions the way the widget wires them. */
function mountActions(initial?: { viewMode?: ViewMode; zoom?: number }) {
  return renderHook(
    () => {
      const [viewMode, setViewMode] = useState<ViewMode>(
        initial?.viewMode ?? "global",
      );
      const [camera, setCamera] = useState<Camera>({
        zoom: initial?.zoom ?? BASE_ZOOM,
        panX: 100,
        panY: 100,
      });
      useMapViewActions({
        viewMode,
        setViewMode,
        setCamera,
        baseZoom: BASE_ZOOM,
        containerSize: CONTAINER,
      });
      return { viewMode, camera };
    },
    { wrapper },
  );
}

function press(actionId: string, value = true): unknown {
  let result: unknown;
  act(() => {
    result = dispatchAction(INSTANCE, actionId, { kind: "button", value });
  });
  return result;
}

describe("MapView actions", () => {
  afterEach(() => {
    clearActionHandlers();
  });

  describe("toggle-follow", () => {
    it("switches between the global view and follow, and reports which", () => {
      const { result } = mountActions();

      expect(press("toggle-follow")).toEqual({ follow: true });
      expect(result.current.viewMode).toBe("follow");

      expect(press("toggle-follow")).toEqual({ follow: false });
      expect(result.current.viewMode).toBe("global");
    });
  });

  describe("zoom-in", () => {
    it("magnifies the map by one step", () => {
      const { result } = mountActions();
      press("zoom-in");
      expect(result.current.camera.zoom).toBeCloseTo(BASE_ZOOM * 1.3);
    });

    it("stops at the closest zoom the map allows", () => {
      const { max } = zoomBounds(BASE_ZOOM);
      const { result } = mountActions({ zoom: max * 0.9 });
      press("zoom-in");
      expect(result.current.camera.zoom).toBe(max);
    });
  });

  describe("zoom-out", () => {
    it("pulls the map back by one step", () => {
      const { result } = mountActions({ zoom: BASE_ZOOM * 4 });
      press("zoom-out");
      expect(result.current.camera.zoom).toBeCloseTo((BASE_ZOOM * 4) / 1.3);
    });

    it("stops at the widest zoom the map allows", () => {
      const { min } = zoomBounds(BASE_ZOOM);
      const { result } = mountActions({ zoom: min * 1.1 });
      press("zoom-out");
      expect(result.current.camera.zoom).toBe(min);
    });
  });

  describe("reset-view", () => {
    it("fits the whole map to its container and leaves follow", () => {
      const { result } = mountActions({
        viewMode: "follow",
        zoom: BASE_ZOOM * 8,
      });

      press("reset-view");

      expect(result.current.viewMode).toBe("global");
      expect(result.current.camera).toEqual(
        fitCamera(CONTAINER.w, CONTAINER.h),
      );
      expect(result.current.camera.panX).toBe(WORLD_W / 2);
      expect(result.current.camera.panY).toBe(WORLD_H / 2);
    });
  });

  it("ignores the release of every button", () => {
    const { result } = mountActions({ viewMode: "follow" });
    const before = result.current.camera;

    for (const id of ["toggle-follow", "zoom-in", "zoom-out", "reset-view"]) {
      expect(press(id, false)).toBeUndefined();
    }

    expect(result.current.viewMode).toBe("follow");
    expect(result.current.camera).toBe(before);
  });
});
