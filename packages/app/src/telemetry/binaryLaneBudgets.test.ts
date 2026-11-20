import { bodyTextureTopic } from "@ksp-gonogo/data";
import { afterEach, describe, expect, it } from "vitest";
import {
  recordBinaryLaneBytes,
  SITREP_BINARY_BYTES_BUDGET,
  SITREP_BODY_MAP_BYTES_BUDGET,
} from "./binaryLaneBudgets";

/* PNG sizes of the stock maps as the mod sent them on the Steam Deck. */
const STOCK_MAPS: Record<string, number> = {
  Sun: 0,
  Moho: 3_963_256,
  Eve: 4_380_333,
  Gilly: 1_353_892,
  Kerbin: 4_512_066,
  Mun: 8_883_519,
  Minmus: 2_945_025,
  Duna: 7_578_540,
  Ike: 1_548_384,
  Dres: 1_036_576,
  Jool: 5_841_866,
  Laythe: 567_408,
  Vall: 5_681_204,
  Tylo: 5_861_140,
  Bop: 6_257_068,
  Pol: 1_873_136,
  Eeloo: 5_622_213,
};

afterEach(() => {
  SITREP_BINARY_BYTES_BUDGET.reset();
  SITREP_BODY_MAP_BYTES_BUDGET.reset();
});

describe("binary-lane byte budgets", () => {
  it("a whole stock set of body maps landing within one second stays under the body-map budget and off the radio budget", () => {
    const now = 1_000_000;
    for (const [body, bytes] of Object.entries(STOCK_MAPS)) {
      recordBinaryLaneBytes(
        { topic: bodyTextureTopic(body), byteLength: bytes },
        now,
      );
    }

    expect(Object.keys(STOCK_MAPS)).toHaveLength(17);
    expect(SITREP_BODY_MAP_BYTES_BUDGET.windowTotal(now)).toBeGreaterThan(
      60_000_000,
    );
    expect(SITREP_BODY_MAP_BYTES_BUDGET.getExceedanceCount()).toBe(0);
    expect(SITREP_BINARY_BYTES_BUDGET.windowTotal(now)).toBe(0);
  });

  it("a stock set sent twice within one second goes over the body-map budget", () => {
    const now = 1_000_000;
    for (let pass = 0; pass < 2; pass++) {
      for (const [body, bytes] of Object.entries(STOCK_MAPS)) {
        recordBinaryLaneBytes(
          { topic: bodyTextureTopic(body), byteLength: bytes },
          now,
        );
      }
    }

    expect(SITREP_BODY_MAP_BYTES_BUDGET.getExceedanceCount()).toBeGreaterThan(
      0,
    );
    SITREP_BODY_MAP_BYTES_BUDGET.reset();
  });

  it("a radio-rate stream stays under the radio budget, and raw PCM goes over it", () => {
    /* 200 ms batches at the 4338 B/s firefox was measured sending, for ten seconds. */
    for (let i = 0; i < 50; i++) {
      recordBinaryLaneBytes(
        { topic: "commcast.radio", byteLength: 868 },
        1_000_000 + i * 200,
      );
    }
    expect(SITREP_BINARY_BYTES_BUDGET.getExceedanceCount()).toBe(0);

    /* int16 at 16 kHz is 32 kB/s, so one talker plus a second goes over. */
    for (let i = 0; i < 10; i++) {
      recordBinaryLaneBytes(
        { topic: "commcast.radio", byteLength: 12_800 },
        1_020_000 + i * 200,
      );
    }
    expect(SITREP_BINARY_BYTES_BUDGET.getExceedanceCount()).toBeGreaterThan(0);
    SITREP_BINARY_BYTES_BUDGET.reset();
  });
});
