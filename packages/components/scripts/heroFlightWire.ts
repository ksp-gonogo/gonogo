/**
 * The modelled flight of `heroFlightModel.ts` as the frames the mod would send:
 * one `stream-data` line per Topic that changed, grouped by the instant they
 * were sent. The committed fixture is these lines serialised, so a replay of it
 * drives every widget of the hero dashboard off one flight on one clock, and a
 * recorded flight from the real game can stand in for it unchanged.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Elements,
  type FlightSample,
  KERBIN_MU,
  KERBIN_RADIUS,
  LAUNCH_UT,
  LF_FRACTION,
  STAGES,
  simulateFlight,
} from "./heroFlightModel";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");

export const HERO_FLIGHT_FIXTURE = join(HERE, "fixtures/hero-flight.jsonl");

/** What the mod puts on the socket for one Topic's update. */
export interface WireLine {
  type: "stream-data";
  topic: string;
  payload: unknown;
  meta: {
    source: string;
    validAt: number;
    seq: number;
    deliveredAt: number;
    vantage: string;
    /** OnRails is 0 and Loaded is 1. */
    quality: number;
    active: boolean;
    staleness: number;
    timelineEpoch: number;
  };
}

/** Every line sent at one instant. */
export interface HeroFrame {
  ut: number;
  lines: WireLine[];
}

const SOURCE = "hero-flight-model";
const SIT = { PreLaunch: 2, Orbiting: 3, Flying: 5, SubOrbital: 6 } as const;
const SAS_PROGRADE = 1;
const SAS_STABILITY = 0;
const G_SURFACE = 9.81;
const LF_UNIT_TONNES = 0.005;

/** Seconds of game time between frames while the craft climbs, and while it coasts. */
const ASCENT_STEP = 2;
const COAST_STEP = 24;
/** Seconds of the circularisation burn's tail carried at the ascent's rate. */
const ASCENT_TAIL = 14;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function loadFixtureEmit(
  folder: string,
  scene: string,
  channel: string,
): { value: Record<string, unknown> } {
  const raw: unknown = JSON.parse(
    readFileSync(join(SRC, folder, "__fixtures__", `${scene}.json`), "utf8"),
  );
  const emits =
    isRecord(raw) && isRecord(raw._stream) ? raw._stream.emits : null;
  if (!Array.isArray(emits))
    throw new Error(`${folder}/${scene} has no _stream`);
  for (const e of emits) {
    if (isRecord(e) && e.channel === channel && isRecord(e.value))
      return { value: e.value };
  }
  throw new Error(`${folder}/${scene} has no ${channel}`);
}

/** Kerbin, the Mun and Minmus under the sun, with Kerbin as the ground track's fixture states it. */
function bodiesPayload(): unknown {
  const system = loadFixtureEmit(
    "SystemView",
    "kerbin-mun-encounter",
    "system.bodies",
  ).value as { bodies: Record<string, unknown>[] };
  const kerbin = loadFixtureEmit(
    "GroundTrack",
    "kerbin-lko-equator",
    "system.bodies",
  ).value as { bodies: Record<string, unknown>[] };
  const groundKerbin = kerbin.bodies.find((b) => b.name === "Kerbin") ?? {};
  return {
    bodies: system.bodies.map((b) =>
      b.name === "Kerbin" ? { ...b, ...groundKerbin } : b,
    ),
  };
}

function round(x: number, digits = 4): number {
  if (!Number.isFinite(x)) return x;
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}

function situationOf(s: FlightSample): number {
  if (s.t < 1) return SIT.PreLaunch;
  if (s.altitude < 70_000) return SIT.Flying;
  return s.elements.periapsisAlt > 70_000 ? SIT.Orbiting : SIT.SubOrbital;
}

/** Seconds from `ut` until the descending branch of the conic returns to the surface, for an orbit that cuts it. */
function impactAfter(el: Elements): number | null {
  if (el.periapsisAlt >= 0 || el.ecc < 1e-6) return null;
  const p = el.sma * (1 - el.ecc ** 2);
  const cosNu = (p / KERBIN_RADIUS - 1) / el.ecc;
  if (Math.abs(cosNu) > 1) return null;
  const nu = 2 * Math.PI - Math.acos(cosNu);
  const eccAnomaly =
    2 *
    Math.atan2(
      Math.sqrt(1 - el.ecc) * Math.sin(nu / 2),
      Math.sqrt(1 + el.ecc) * Math.cos(nu / 2),
    );
  const meanAnomaly =
    (((eccAnomaly - el.ecc * Math.sin(eccAnomaly)) % (2 * Math.PI)) +
      2 * Math.PI) %
    (2 * Math.PI);
  const n = (2 * Math.PI) / el.period;
  const delta =
    (((meanAnomaly - el.meanAnomaly) % (2 * Math.PI)) + 2 * Math.PI) %
    (2 * Math.PI);
  return delta / n;
}

function orbitPayload(s: FlightSample) {
  const el = s.elements;
  const horizon = { kind: 1, trajectoryKind: 1 };
  const impact = impactAfter(el);
  const elements = {
    sma: round(el.sma, 1),
    ecc: round(el.ecc, 7),
    inc: round(el.inc, 4),
    lan: round(el.lan, 4),
    argPe: round(el.argPe, 4),
    meanAnomalyAtEpoch: round(el.meanAnomaly, 6),
    epoch: s.ut,
  };
  return {
    referenceBodyIndex: 1,
    ...elements,
    mu: KERBIN_MU,
    horizon,
    patches: [
      {
        ...elements,
        period: round(el.period, 2),
        startUt: s.ut,
        endUt: round(s.ut + (impact ?? el.period), 2),
        patchStartTransition: 0,
        patchEndTransition: impact === null ? 1 : 3,
        peA: round(el.periapsisAlt, 1),
        apA: round(el.apoapsisAlt, 1),
        semiLatusRectum: round(el.sma * (1 - el.ecc ** 2), 1),
        semiMinorAxis: round(el.sma * Math.sqrt(1 - el.ecc ** 2), 1),
        referenceBody: "Kerbin",
        referenceBodyIndex: 1,
        mu: KERBIN_MU,
      },
    ],
  };
}

function flightPayload(s: FlightSample) {
  const alt = Math.max(s.altitude, 0);
  return {
    latitude: round(s.latitude, 5),
    longitude: round(s.longitude, 5),
    altitudeAsl: round(s.altitude, 1),
    altitudeTerrain: round(s.altitude, 1),
    verticalSpeed: round(s.verticalSpeed, 2),
    surfaceSpeed: round(s.surfaceSpeed, 2),
    orbitalSpeed: round(s.orbitalSpeed, 2),
    gForce: round(s.gForce, 3),
    dynamicPressureKPa: round(s.dynamicPressure, 3),
    mach: round(s.mach, 3),
    atmDensity: round(s.density, 4),
    externalTemperature: round(Math.max(4, 300 - alt * 0.006), 1),
    atmosphericTemperature: round(Math.max(4, 300 - alt * 0.006), 1),
  };
}

function attitudePayload(s: FlightSample) {
  const a = {
    heading: round(s.heading, 2),
    pitch: round(s.pitch, 2),
    roll: round(s.roll, 2),
  };
  return {
    ...a,
    headingRootFrame: a.heading,
    pitchRootFrame: a.pitch,
    rollRootFrame: a.roll,
  };
}

function controlPayload(s: FlightSample) {
  return {
    sas: s.sas,
    sasMode: s.t > 40 ? SAS_PROGRADE : SAS_STABILITY,
    rcs: s.rcs,
    gear: false,
    brakes: false,
    lights: s.t > 1,
    abort: false,
    precisionControl: false,
    throttle: round(s.throttle, 3),
    actionGroups: [
      { index: 1, name: "Fairing", state: s.groups[0] },
      { index: 2, name: "Panels", state: s.groups[1] },
    ],
  };
}

interface StageResources {
  LiquidFuel: { current: number; max: number; active: boolean };
  Oxidizer: { current: number; max: number; active: boolean };
  MonoPropellant: { current: number; max: number; active: boolean };
  XenonGas: { current: number; max: number; active: boolean };
  ElectricCharge: { current: number; max: number; active: boolean };
}

function resourcesOf(
  fuelTonnes: number,
  maxTonnes: number,
  active: boolean,
): StageResources {
  const lf = (fuelTonnes * LF_FRACTION) / LF_UNIT_TONNES;
  const ox = (fuelTonnes * (1 - LF_FRACTION)) / LF_UNIT_TONNES;
  const lfMax = (maxTonnes * LF_FRACTION) / LF_UNIT_TONNES;
  const oxMax = (maxTonnes * (1 - LF_FRACTION)) / LF_UNIT_TONNES;
  return {
    LiquidFuel: { current: round(lf, 1), max: round(lfMax, 1), active },
    Oxidizer: { current: round(ox, 1), max: round(oxMax, 1), active },
    MonoPropellant: { current: 30, max: 30, active: true },
    XenonGas: { current: 0, max: 0, active: false },
    ElectricCharge: { current: 400, max: 400, active: true },
  };
}

function stageEntries(s: FlightSample) {
  const entries = [];
  const pressure = Math.exp(-Math.max(s.altitude, 0) / 5600);
  for (let i = s.active; i < STAGES.length; i++) {
    const spec = STAGES[i];
    let start = 0;
    for (let j = i; j < STAGES.length; j++)
      start += STAGES[j].dryMass + s.fuel[j];
    const fuel = s.fuel[i];
    const end = start - fuel;
    const dv = (isp: number) =>
      end > 0 && start > end ? isp * 9.80665 * Math.log(start / end) : 0;
    const ispActual = spec.ispVac + (spec.ispAsl - spec.ispVac) * pressure;
    const thrustActual =
      spec.thrustVac + (spec.thrustAsl - spec.thrustVac) * pressure;
    const flow = spec.thrustVac / (spec.ispVac * 9.80665);
    entries.push({
      stage: spec.stage,
      dryMass: round(spec.dryMass, 3),
      fuelMass: round(fuel, 3),
      startMass: round(start, 3),
      endMass: round(end, 3),
      burnTime: round(fuel / flow, 1),
      dvVac: round(dv(spec.ispVac), 1),
      dvAsl: round(dv(spec.ispAsl), 1),
      dvActual: round(dv(ispActual), 1),
      twrVac: round(spec.thrustVac / (start * G_SURFACE), 3),
      twrAsl: round(spec.thrustAsl / (start * G_SURFACE), 3),
      twrActual: round(thrustActual / (start * G_SURFACE), 3),
      thrustVac: spec.thrustVac,
      thrustAsl: spec.thrustAsl,
      thrustActual: round(thrustActual, 1),
      resources: resourcesOf(fuel, spec.fuelMass, i === s.active),
    });
  }
  return entries;
}

function totalsOf(s: FlightSample) {
  let lf = 0;
  let ox = 0;
  let lfMax = 0;
  let oxMax = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (i < s.active) continue;
    lf += (s.fuel[i] * LF_FRACTION) / LF_UNIT_TONNES;
    ox += (s.fuel[i] * (1 - LF_FRACTION)) / LF_UNIT_TONNES;
    lfMax += (STAGES[i].fuelMass * LF_FRACTION) / LF_UNIT_TONNES;
    oxMax += (STAGES[i].fuelMass * (1 - LF_FRACTION)) / LF_UNIT_TONNES;
  }
  return {
    LiquidFuel: { current: round(lf, 1), max: round(lfMax, 1), active: true },
    Oxidizer: { current: round(ox, 1), max: round(oxMax, 1), active: true },
    MonoPropellant: { current: 30, max: 30, active: true },
    XenonGas: { current: 0, max: 0, active: false },
    ElectricCharge: { current: 400, max: 400, active: true },
  };
}

function dvTopics(s: FlightSample) {
  const stages = stageEntries(s);
  const sum = (k: "dvVac" | "dvAsl" | "dvActual" | "burnTime") =>
    round(
      stages.reduce((m, e) => m + e[k], 0),
      1,
    );
  const thrustNow =
    s.active < STAGES.length
      ? (STAGES[s.active].thrustVac +
          (STAGES[s.active].thrustAsl - STAGES[s.active].thrustVac) *
            Math.exp(-Math.max(s.altitude, 0) / 5600)) *
        s.throttle
      : 0;
  const dry = STAGES.slice(s.active).reduce((m, st) => m + st.dryMass, 0);
  return {
    "dv.stages": stages,
    "dv.summary": {
      stageCount: stages.length,
      totalDvVac: sum("dvVac"),
      totalDvAsl: sum("dvAsl"),
      totalDvActual: sum("dvActual"),
      totalBurnTime: sum("burnTime"),
    },
    "vessel.resources": { resources: totalsOf(s) },
    "vessel.structure": {
      currentStage: s.currentStage,
      partCount: 24 - 6 * Math.min(s.active, 2),
    },
    "vessel.propulsion": {
      totalMass: round(s.mass, 3),
      dryMass: round(dry, 3),
      currentThrust: round(thrustNow, 1),
      availableThrust:
        s.active < STAGES.length ? STAGES[s.active].thrustVac : 0,
    },
  } as Record<string, unknown>;
}

/** The seconds-since-lift-off each frame is taken at: closely through the climb and burn, then by the half minute round the orbit. */
function frameTimes(samples: readonly FlightSample[]): number[] {
  const orbitAt =
    samples.find((s) => s.elements.periapsisAlt > 80_000 && s.altitude > 70_000)
      ?.t ?? 0;
  const times: number[] = [];
  const ascentEnd = orbitAt + ASCENT_TAIL;
  for (let t = 0; t <= ascentEnd; t += ASCENT_STEP) times.push(t);
  const last = samples[samples.length - 1].t;
  for (let t = ascentEnd + COAST_STEP; t <= last; t += COAST_STEP)
    times.push(t);
  return times;
}

/** Every frame of the flight: each Topic on every frame, apart from the body catalogue, which is sent once. */
export function buildHeroFrames(): HeroFrame[] {
  const samples = simulateFlight();
  const bodies = bodiesPayload();
  const frames: HeroFrame[] = [];
  const previous = new Map<string, string>();
  let seq = 0;
  for (const t of frameTimes(samples)) {
    const s = samples[Math.min(samples.length - 1, Math.round(t))];
    const ut = round(LAUNCH_UT + s.t, 3);
    const quality = s.throttle > 0 || s.altitude < 70_000 ? 1 : 0;
    const topics: Record<string, unknown> = {
      "vessel.flight": flightPayload(s),
      "vessel.attitude": attitudePayload(s),
      "vessel.control": controlPayload(s),
      "vessel.orbit": orbitPayload(s),
      "vessel.identity": {
        vesselId: "hero-flight-1",
        name: "Pathfinder 1",
        vesselType: 0,
        situation: situationOf(s),
        parentBodyIndex: 1,
        launchUt: LAUNCH_UT,
      },
      "time.warp": { paused: false },
      "comms.link": { connected: true },
      "vessel.comms": { connected: true, signalStrength: 1, controlState: 4 },
      "system.bodies": bodies,
      ...dvTopics(s),
    };
    const lines: WireLine[] = [];
    for (const [topic, payload] of Object.entries(topics)) {
      // The mod re-confirms a Topic on every frame, so a reading that has not changed is still current. Only the body catalogue, which never changes, is sent once.
      const key = JSON.stringify(payload);
      if (topic === "system.bodies" && previous.get(topic) === key) continue;
      previous.set(topic, key);
      seq += 1;
      lines.push({
        type: "stream-data",
        topic,
        payload,
        meta: {
          source: SOURCE,
          validAt: ut,
          seq,
          deliveredAt: ut,
          vantage: "fixture",
          quality: topic === "vessel.orbit" ? quality : 0,
          active: true,
          staleness: 0,
          timelineEpoch: 0,
        },
      });
    }
    frames.push({ ut, lines });
  }
  return frames;
}

function isWireLine(v: unknown): v is WireLine {
  return (
    isRecord(v) &&
    v.type === "stream-data" &&
    typeof v.topic === "string" &&
    isRecord(v.meta) &&
    typeof v.meta.validAt === "number"
  );
}

/** The fixture's text: one line per update, frames in order, an instant's lines adjacent. */
export function serialiseHeroFrames(frames: readonly HeroFrame[]): string {
  return `${frames.flatMap((f) => f.lines.map((l) => JSON.stringify(l))).join("\n")}\n`;
}

/** The committed fixture read back into frames, grouped by the instant each line was sent. */
export function readHeroFrames(
  text = readFileSync(HERO_FLIGHT_FIXTURE, "utf8"),
): HeroFrame[] {
  const frames: HeroFrame[] = [];
  for (const row of text.split("\n")) {
    if (!row) continue;
    const parsed: unknown = JSON.parse(row);
    if (!isWireLine(parsed)) throw new Error(`Not a stream-data line: ${row}`);
    const line = parsed;
    const tail = frames[frames.length - 1];
    if (tail && tail.ut === line.meta.validAt) tail.lines.push(line);
    else frames.push({ ut: line.meta.validAt, lines: [line] });
  }
  return frames;
}
