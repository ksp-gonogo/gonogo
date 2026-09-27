import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { resolveCurrency } from "./readingCurrency";

describe("resolveCurrency", () => {
  it("has nothing to say about a held reading that carries no number", () => {
    const resolved = resolveCurrency({
      state: "stale",
      reckoning: { status: "none" },
      asOfUt: value("ut", 1_000),
      grade: "held-stale",
    });
    expect(resolved.held).toBe(false);
    expect(resolved.caption).toBeNull();
  });

  it("marks and captions a held reading that carries one", () => {
    const resolved = resolveCurrency({
      state: "stale",
      reckoning: { status: "none" },
      value: value("m", 12),
      asOfUt: value("ut", 1_000),
      grade: "held-stale",
    });
    expect(resolved.held).toBe(true);
    expect(resolved.caption).toMatch(/^STALE/);
  });
});

describe("resolveCurrency for a consumer that draws the reckoning", () => {
  const drawsReckoning = { drawsReckoning: true } as const;
  function modelled(beyondReceived: boolean) {
    return {
      status: "available",
      atUt: value("ut", 1_240),
      beyondReceived,
      modelled: value("m", 20),
      basis: "linear-dead-reckoning",
    } as const;
  }

  it("draws the model's figure and marks it when the model carried it beyond the received edge", () => {
    const resolved = resolveCurrency(
      {
        state: "observed",
        value: value("m", 12),
        atUt: value("ut", 1_000),
        reckoning: modelled(true),
      },
      drawsReckoning,
    );
    expect(resolved.shown).toEqual(value("m", 20));
    expect(resolved.held).toBe(true);
    expect(resolved.caption).toBe("modelled to SCET");
  });

  it("draws the model's figure unmarked when there was no light-time to carry it across", () => {
    const resolved = resolveCurrency(
      {
        state: "observed",
        value: value("m", 12),
        atUt: value("ut", 1_000),
        reckoning: modelled(false),
      },
      drawsReckoning,
    );
    expect(resolved.shown).toEqual(value("m", 20));
    expect(resolved.held).toBe(false);
  });

  it("draws the model's figure on a held reading, under the held mark", () => {
    const resolved = resolveCurrency(
      {
        state: "stale",
        value: value("m", 12),
        asOfUt: value("ut", 1_000),
        grade: "held-stale",
        reckoning: modelled(true),
      },
      drawsReckoning,
    );
    expect(resolved.shown).toEqual(value("m", 20));
    expect(resolved.caption).toMatch(/^STALE/);
  });

  it("draws nothing for a reading with no observation, whatever is on offer", () => {
    const resolved = resolveCurrency(
      { state: "pending", reckoning: modelled(true) },
      drawsReckoning,
    );
    expect(resolved.shown).toBeNull();
    expect(resolved.held).toBe(false);
  });

  it("leaves a consumer drawing the observation exactly as it was", () => {
    const resolved = resolveCurrency({
      state: "observed",
      value: value("m", 12),
      atUt: value("ut", 1_000),
      reckoning: modelled(true),
    });
    expect(resolved.shown).toEqual(value("m", 12));
    expect(resolved.held).toBe(false);
  });
});
