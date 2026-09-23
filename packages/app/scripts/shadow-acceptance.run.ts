import { expect, it } from "vitest";
import { runShadowAcceptance } from "../src/alarms/shadowAcceptanceRun";

/**
 * The shadow comparison's acceptance run, against a live mod. Needs a running
 * game and a stream to reach, so only `vitest.shadow-acceptance.config.ts`
 * collects it:
 *
 *   ssh -f -N -L 8090:127.0.0.1:8090 deck
 *   SHADOW_SECONDS=900 pnpm --filter @ksp-gonogo/app shadow-acceptance
 *
 * `SITREP_HOST` and `SITREP_PORT` override the default `127.0.0.1:8090`.
 * `SHADOW_LAPS` is how many laps the scenario flies, each of which every armed
 * alarm must agree on. `SHADOW_WARP_INDEX` is the `time.setWarpIndex` rung to
 * hold for the run -- the mod cancels warp itself on every command-vantage
 * alarm fire, so a lap scenario needs this re-applied or it stalls to the
 * orbit's real-time period after the first crossing. The run fails unless the
 * verdict is PASS, so the exit code is the verdict.
 */

const seconds = Number(process.env.SHADOW_SECONDS ?? 900);
const host = process.env.SITREP_HOST ?? "127.0.0.1";
const port = Number(process.env.SITREP_PORT ?? 8090);
const laps =
  process.env.SHADOW_LAPS === undefined
    ? undefined
    : Number(process.env.SHADOW_LAPS);
const warpIndex =
  process.env.SHADOW_WARP_INDEX === undefined
    ? undefined
    : Number(process.env.SHADOW_WARP_INDEX);

it(
  `shadow acceptance over ${seconds}s`,
  async () => {
    const { verdict, unread } = await runShadowAcceptance({
      host,
      port,
      observeMs: seconds * 1000,
      laps,
      warpIndex,
      write: (line) => console.info(line),
    });
    console.info(JSON.stringify(verdict, null, 2));
    expect(unread, "alarms whose reading never resolved").toEqual([]);
    expect(verdict.verdict).toBe("PASS");
  },
  seconds * 1000 + 60_000,
);
