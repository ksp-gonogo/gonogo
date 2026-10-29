import { renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { useRetained } from "./CommcastContext";

describe("useRetained", () => {
  it("keeps the last defined value while the reading blinks to undefined", () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string | undefined }) => useRetained(v),
      { initialProps: { v: undefined as string | undefined } },
    );
    expect(result.current).toBeUndefined();
    rerender({ v: "cove" });
    expect(result.current).toBe("cove");
    rerender({ v: undefined });
    expect(result.current).toBe("cove");
    rerender({ v: "rim" });
    expect(result.current).toBe("rim");
  });
});
