#!/usr/bin/env node
import { resolve } from "node:path";
import { createReplayServer, loadFixtureFile } from "./server";

/**
 * gonogo-replay — drop-in Telemachus replacement that serves a recorded
 * flight fixture over the same wire format. Run alongside `pnpm dev` to
 * exercise the whole app against captured telemetry without KSP.
 *
 * Usage:
 *   pnpm --filter @ksp-gonogo/replay-server dev path/to/flight.fixture.json
 *   PORT=8085 RATE=2 pnpm replay path/to/flight.fixture.json
 *
 * Env:
 *   PORT     — listen port (default 8085, matching Telemachus)
 *   HOST     — bind address (default 0.0.0.0)
 *   RATE     — playback rate (1 = real time; default 1)
 *   TICK_MS  — replay tick interval in ms (default 250)
 */
async function main(): Promise<void> {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    console.error("usage: gonogo-replay <fixture.json>");
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? 8085);
  const host = process.env.HOST ?? "0.0.0.0";
  const rate = Number(process.env.RATE ?? 1);
  const tickMs = Number(process.env.TICK_MS ?? 250);

  const fixture = await loadFixtureFile(resolve(fixturePath));
  const server = await createReplayServer({
    fixture,
    rate,
    tickMs,
    logger: true,
  });

  await server.fastify.listen({ port, host });

  console.log("gonogo-replay running");
  console.log(`  vessel:   ${fixture.flight.vesselName}`);
  console.log(
    `  duration: ${fixture.flight.lastSampleAt - fixture.flight.launchedAt}ms`,
  );
  console.log(`  samples:  ${fixture.flight.sampleCount}`);
  console.log(`  ws://${host}:${port}/datalink`);

  // Graceful shutdown — Ctrl-C should stop the timer and close cleanly.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      await server.stop();
      process.exit(0);
    });
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
