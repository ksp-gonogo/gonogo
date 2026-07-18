import { renderHook } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CpuRegistryService } from "../shared/CpuRegistryService";
import { kosSource } from "./kos";
import { useKosMainWiring } from "./useKosMainWiring";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useKosMainWiring", () => {
  it("feeds onProcessorsChanged output into cpuRegistry.reportOnline", () => {
    const cpuRegistry = new CpuRegistryService("main", new MemoryStorage());
    const reportOnlineSpy = vi.spyOn(cpuRegistry, "reportOnline");
    let capturedCb: ((procs: { tag?: string }[]) => void) | undefined;
    vi.spyOn(kosSource, "onProcessorsChanged").mockImplementation((cb) => {
      capturedCb = cb;
      return () => {};
    });
    renderHook(() => useKosMainWiring(cpuRegistry));
    capturedCb?.([{ tag: "cpu-1" }, { tag: undefined }]);
    expect(reportOnlineSpy).toHaveBeenCalledWith(["cpu-1"]);
  });
});
