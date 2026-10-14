#!/usr/bin/env tsx
/**
 * Writes `scripts/fixtures/hero-flight.jsonl`: the modelled ascent to orbit the
 * README's hero dashboard replays, as the `stream-data` lines the mod would
 * send. Every panel of the hero reads this one file, so they all show the same
 * flight.
 *
 * Run via `pnpm --filter @ksp-gonogo/components gen-hero-flight`. The fixture is
 * a pure function of `heroFlightModel.ts`, and `heroFlight.test.ts` fails when
 * the two drift.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildHeroFrames,
  HERO_FLIGHT_FIXTURE,
  serialiseHeroFrames,
} from "./heroFlightWire";

const frames = buildHeroFrames();
await mkdir(dirname(HERO_FLIGHT_FIXTURE), { recursive: true });
await writeFile(HERO_FLIGHT_FIXTURE, serialiseHeroFrames(frames));
console.log(
  `wrote ${HERO_FLIGHT_FIXTURE}: ${frames.length} frames, ${frames.reduce((n, f) => n + f.lines.length, 0)} lines`,
);
