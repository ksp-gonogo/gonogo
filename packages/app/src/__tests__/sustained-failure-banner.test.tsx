import { clearRegistry, MockDataSource, registerDataSource } from "@gonogo/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SustainedFailureBanner } from "../components/SustainedFailureBanner";

describe("SustainedFailureBanner", () => {
  beforeEach(() => {
    clearRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("stays hidden while sources are connected or transiently reconnecting", async () => {
    const src = new MockDataSource({ id: "a", name: "Alpha", keys: [] });
    registerDataSource(src);
    src.setStatus("connected");

    const { container } = render(<SustainedFailureBanner />);

    expect(container.textContent).toBe("");

    // Brief disconnect that recovers within the threshold — banner must
    // not appear.
    act(() => {
      src.setStatus("disconnected");
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    act(() => {
      src.setStatus("connected");
    });
    expect(container.textContent).toBe("");
  });

  it("surfaces a source that has been failing for longer than the threshold", () => {
    const src = new MockDataSource({ id: "a", name: "Alpha", keys: [] });
    registerDataSource(src);
    src.setStatus("connected");

    render(<SustainedFailureBanner />);

    act(() => {
      src.setStatus("error");
    });
    // Tick past the 15s sustained-failure threshold.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(screen.getByText(/SOURCE OFFLINE/)).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });

  it("clears once the source recovers", () => {
    const src = new MockDataSource({ id: "a", name: "Alpha", keys: [] });
    registerDataSource(src);
    src.setStatus("connected");

    const { container } = render(<SustainedFailureBanner />);

    act(() => {
      src.setStatus("error");
    });
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByText(/SOURCE OFFLINE/)).toBeInTheDocument();

    act(() => {
      src.setStatus("connected");
    });
    expect(container.textContent).toBe("");
  });
});
