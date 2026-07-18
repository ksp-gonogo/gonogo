import { cleanup, renderHook } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kerbcastSource } from "../KerbcastDataSource";
import { useKerbcastMainConnect } from "./useKerbcastMainConnect";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useKerbcastMainConnect", () => {
  it("connects the shared kerbcastSource on mount", () => {
    const connectSpy = vi.spyOn(kerbcastSource, "connect").mockResolvedValue();
    renderHook(() => useKerbcastMainConnect());
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it("disconnects on unmount", () => {
    vi.spyOn(kerbcastSource, "connect").mockResolvedValue();
    const disconnectSpy = vi
      .spyOn(kerbcastSource, "disconnect")
      .mockImplementation(() => {});
    const { unmount } = renderHook(() => useKerbcastMainConnect());
    unmount();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
