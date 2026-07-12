import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneChangeBanner } from "../components/SceneChangeBanner";

describe("SceneChangeBanner", () => {
  beforeEach(() => {
    clearRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("stays hidden on the first scene sample (initial state, not a transition)", () => {
    const src = new MockDataSource({
      id: "data",
      keys: [{ key: "kc.scene" }],
    });
    registerDataSource(src);
    src.setStatus("connected");

    const { container } = render(<SceneChangeBanner />);

    act(() => {
      src.emit("kc.scene", "SpaceCenter");
    });
    expect(container.textContent).toBe("");
  });

  it("surfaces a from→to banner when the scene changes", () => {
    const src = new MockDataSource({
      id: "data",
      keys: [{ key: "kc.scene" }],
    });
    registerDataSource(src);
    src.setStatus("connected");

    render(<SceneChangeBanner />);

    act(() => {
      src.emit("kc.scene", "SpaceCenter");
    });
    act(() => {
      src.emit("kc.scene", "Flight");
    });

    expect(screen.getByText("Space Center")).toBeInTheDocument();
    expect(screen.getByText("Flight")).toBeInTheDocument();
  });

  it("auto-hides after the visible window expires", () => {
    const src = new MockDataSource({
      id: "data",
      keys: [{ key: "kc.scene" }],
    });
    registerDataSource(src);
    src.setStatus("connected");

    const { container } = render(<SceneChangeBanner />);

    act(() => {
      src.emit("kc.scene", "SpaceCenter");
    });
    act(() => {
      src.emit("kc.scene", "Flight");
    });
    expect(container.textContent).not.toBe("");

    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(container.textContent).toBe("");
  });
});
