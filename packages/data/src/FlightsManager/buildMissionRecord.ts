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
 * `firstFrameUt`/`lastFrameUt` are read off each frame's `meta.deliveredAt`.
 */
export function buildMissionRecord(params: {
  vesselName: string;
  launchedAt: number;
  fixture: ReplayFixture;
}): MissionRecord | null {
  const { fixture } = params;
  if (fixture.frames.length === 0) return null;

  let firstFrameUt = Number.POSITIVE_INFINITY;
  let lastFrameUt = 0;
  for (const raw of fixture.frames) {
    const parsed: unknown = JSON.parse(raw);
    const frameMeta: unknown =
      typeof parsed === "object" && parsed !== null
        ? Reflect.get(parsed, "meta")
        : undefined;
    const deliveredAt: unknown =
      typeof frameMeta === "object" && frameMeta !== null
        ? Reflect.get(frameMeta, "deliveredAt")
        : undefined;
    if (typeof deliveredAt !== "number") continue;
    if (deliveredAt < firstFrameUt) firstFrameUt = deliveredAt;
    if (deliveredAt > lastFrameUt) lastFrameUt = deliveredAt;
  }
  if (!Number.isFinite(firstFrameUt)) firstFrameUt = 0;

  const meta: MissionMeta = {
    id: makeMissionId(),
    vesselName: params.vesselName || "Unnamed vessel",
    launchedAt: params.launchedAt,
    firstFrameUt,
    lastFrameUt,
    frameCount: fixture.frames.length,
  };
  return { meta, fixture };
}
