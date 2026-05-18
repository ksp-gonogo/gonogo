import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TelemachusAntennaBanner } from "./TelemachusAntennaBanner";

function primeSource(): MockDataSource {
  const source = new MockDataSource({
    id: "data",
    keys: [{ key: "p.paused" }],
    affectedBySignalLoss: false,
  });
  registerDataSource(source);
  source.setStatus("connected");
  return source;
}

describe("TelemachusAntennaBanner", () => {
  beforeEach(() => {
    clearRegistry();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders nothing on cold start (no confirmed p.paused=0 yet)", () => {
    const source = primeSource();
    render(<TelemachusAntennaBanner />);
    act(() => {
      source.emit("p.paused", 2); // antenna missing, but never saw a good
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders nothing when p.paused === 0", () => {
    const source = primeSource();
    render(<TelemachusAntennaBanner />);
    act(() => {
      source.emit("p.paused", 0);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders nothing for game-paused (p.paused === 1)", () => {
    const source = primeSource();
    render(<TelemachusAntennaBanner />);
    act(() => {
      source.emit("p.paused", 0);
      source.emit("p.paused", 1);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders nothing outside the flight scene (p.paused === 5)", () => {
    const source = primeSource();
    render(<TelemachusAntennaBanner />);
    act(() => {
      source.emit("p.paused", 0);
      source.emit("p.paused", 5);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    [2, /no power|offline/i],
    [3, /off/i],
    [4, /missing/i],
  ])("flashes the warning banner for p.paused === %i", (code, copyPattern) => {
    const source = primeSource();
    render(<TelemachusAntennaBanner />);
    // Separate act() blocks so the setHasConfirmedGood effect from
    // emit(0) flushes before emit(<code>) lands; otherwise React
    // batches both inside one render cycle and the banner gate sees
    // hasConfirmedGood=false when paused=code, returning null.
    act(() => {
      source.emit("p.paused", 0); // confirm-good guard
    });
    act(() => {
      source.emit("p.paused", code);
    });
    // role="status" — what assistive tech announces. There's only one
    // status banner in this isolated render, so we identify the
    // element by role then assert its visible copy.
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(copyPattern);
  });

  it("clears when p.paused returns to 0", () => {
    const source = primeSource();
    render(<TelemachusAntennaBanner />);
    act(() => {
      source.emit("p.paused", 0);
    });
    act(() => {
      source.emit("p.paused", 2);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => {
      source.emit("p.paused", 0);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
