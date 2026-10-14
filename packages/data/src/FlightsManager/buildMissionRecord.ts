import type { ReplayFixture } from "@ksp-gonogo/sitrep-client";
import type { MissionMeta, MissionRecord } from "../storage/MissionStore";

export function makeMissionId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `mission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Turns a finished `StreamRecorder` session into a saveable `MissionRecord`,
 * shared by `AutoRecordController` (auto-record on flight boundaries).
 * Returns `null` for an empty fixture: nothing was captured, so there is no
 * mission worth saving.
 *
 * `firstFrameUt`/`lastFrameUt` are read off each frame's `meta.deliveredAt`,
 * and `firstValidUt`/`lastValidUt` off its `meta.validAt`.
 */
export function buildMissionRecord(params: {
  vesselName: string;
  launchedAt: number;
  fixture: ReplayFixture;
  /** The mission this fixture is a later part of. Omitted, a new id is made. */
  id?: string;
}): MissionRecord | null {
  const { fixture } = params;
  if (fixture.frames.length === 0) return null;

  let firstFrameUt = Number.POSITIVE_INFINITY;
  let lastFrameUt = 0;
  let firstValidUt = Number.POSITIVE_INFINITY;
  let lastValidUt = Number.NEGATIVE_INFINITY;
  for (const raw of fixture.frames) {
    const parsed: unknown = JSON.parse(raw);
    const frameMeta: unknown =
      typeof parsed === "object" && parsed !== null
        ? Reflect.get(parsed, "meta")
        : undefined;
    if (typeof frameMeta !== "object" || frameMeta === null) continue;
    const deliveredAt: unknown = Reflect.get(frameMeta, "deliveredAt");
    if (typeof deliveredAt !== "number") continue;
    if (deliveredAt < firstFrameUt) firstFrameUt = deliveredAt;
    if (deliveredAt > lastFrameUt) lastFrameUt = deliveredAt;
    const validAt: unknown = Reflect.get(frameMeta, "validAt");
    if (typeof validAt !== "number") continue;
    if (validAt < firstValidUt) firstValidUt = validAt;
    if (validAt > lastValidUt) lastValidUt = validAt;
  }
  if (!Number.isFinite(firstFrameUt)) firstFrameUt = 0;

  const meta: MissionMeta = {
    id: params.id ?? makeMissionId(),
    vesselName: params.vesselName || "Unnamed vessel",
    launchedAt: params.launchedAt,
    firstFrameUt,
    lastFrameUt,
    ...(Number.isFinite(firstValidUt) ? { firstValidUt, lastValidUt } : {}),
    frameCount: fixture.frames.length,
  };
  return { meta, fixture };
}

/**
 * The size at which a recording in progress is stored as a part and carried
 * on, as the length of its frames' JSON text in characters: 16 MiB. One
 * part is one stored record and is held in memory whole until it is written,
 * so the limit bounds both. A dashboard showing an orbit alone records about
 * 2.2 kB for each second of game time, at 570 characters a frame.
 */
export const MISSION_PART_SIZE_LIMIT = 16 * 1024 * 1024;

/**
 * The page time, in seconds, after which a recording in progress is stored as
 * a part and carried on whatever its size. The part in hand lives only in
 * memory, so this is the most of a flight a closed or crashed tab can lose.
 */
export const MISSION_PART_SECONDS = 60;

/**
 * A mission's meta once a further part of its recording is counted: the span
 * of both, and the frames of both. `part` is the meta `buildMissionRecord`
 * gives for that part's own fixture.
 */
export function withMissionPart(
  mission: MissionMeta,
  part: MissionMeta,
): MissionMeta {
  const validFrom = [mission.firstValidUt, part.firstValidUt].filter(
    (ut): ut is number => ut !== undefined,
  );
  const validTo = [mission.lastValidUt, part.lastValidUt].filter(
    (ut): ut is number => ut !== undefined,
  );
  return {
    ...mission,
    firstFrameUt: Math.min(mission.firstFrameUt, part.firstFrameUt),
    lastFrameUt: Math.max(mission.lastFrameUt, part.lastFrameUt),
    ...(validFrom.length === 0 ? {} : { firstValidUt: Math.min(...validFrom) }),
    ...(validTo.length === 0 ? {} : { lastValidUt: Math.max(...validTo) }),
    frameCount: mission.frameCount + part.frameCount,
  };
}
