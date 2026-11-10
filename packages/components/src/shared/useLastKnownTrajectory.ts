import {
  arcInOrbitPlane,
  buildElements,
  type OrbitTrajectory,
  orbitalPeriod,
  TrajectoryFrameKindLike,
  TrajectoryKindLike,
  type TrajectoryPoint,
  useLastKnownPath,
  type useOrbitTrajectory,
  useStream,
  useUtNow,
} from "@ksp-gonogo/sitrep-client";
import {
  PropagationCertification,
  type SystemUplinkHealth,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useMemo, useRef, useState } from "react";

/** How often the path is asked for again, in game seconds, so it follows the newest state this command centre has heard. */
const ASK_EVERY_UT_SECONDS = 30;

/** The least real time between asks, since under time warp game seconds pass far faster than a provider can answer. */
const LEAST_MS_BETWEEN_ASKS = 5000;

/**
 * How many times longer than the last ask took to wait before the next. An integrating
 * provider can take seconds per answer on a large system, and this keeps it to a small
 * share of a core there without slowing the small ones.
 */
const IDLE_TO_WORK_RATIO = 10;

/** How soon to ask again when the provider says it is still working. */
const RETRY_MS = 1000;

/** How far ahead to ask when the elements state no period, in game seconds. */
const OPEN_ORBIT_SPAN_SECONDS = 3600;

const PATH_POINTS = 128;

/**
 * Past the span a conic is vouched for, the integrated path from the state this
 * command centre last heard, in place of that conic. Under stock physics a conic has
 * no such span, so nothing is asked. A refusal leaves `trajectory` as it was.
 *
 * `inOrbitPlane` is for a diagram drawing the orbit's own plane flat, as
 * `useOrbitPlaneTrajectory` does; without it the arc stays in the body-centred frame.
 */
export function useLastKnownTrajectory(
  orbit: Parameters<typeof useOrbitTrajectory>[0],
  trajectory: OrbitTrajectory | null,
  { inOrbitPlane }: { inOrbitPlane: boolean },
): OrbitTrajectory | null {
  const { solve, reply, pending } = useLastKnownPath();
  const stopsAtHorizon =
    orbit !== undefined &&
    trajectory !== null &&
    ((trajectory.shape === "arc" && trajectory.farEnd === "horizon") ||
      (trajectory.shape === "withheld" &&
        trajectory.declined.reason === "beyond-horizon"));

  const utNow = useUtNow();
  const period =
    orbit === undefined ? null : orbitalPeriod(buildElements(orbit));
  const span = period ?? OPEN_ORBIT_SPAN_SECONDS;
  const bucket =
    utNow === undefined ? null : Math.floor(utNow / ASK_EVERY_UT_SECONDS);

  const lastAskedAt = useRef(Number.NEGATIVE_INFINITY);
  const lastAskTook = useRef(0);
  const [retry, setRetry] = useState(0);
  const stillWorking = reply?.solved === false && reply.stillWorking === true;

  useEffect(() => {
    if (!stillWorking) {
      return;
    }
    const timer = setTimeout(() => {
      lastAskedAt.current = Number.NEGATIVE_INFINITY;
      setRetry((n) => n + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [stillWorking]);

  // A provider that has just failed takes its path off the screen now rather than at the next ask.
  const health = useStream<SystemUplinkHealth>("system.uplinkHealth");
  const healthStates =
    health.state === "observed" || health.state === "held"
      ? health.value.uplinks.map((u) => `${u.id}:${u.health.state}`).join()
      : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of `healthStates` is the event this acts on
  useEffect(() => {
    lastAskedAt.current = Number.NEGATIVE_INFINITY;
    setRetry((n) => n + 1);
  }, [healthStates]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `retry` is what re-runs this after the provider asked for another try.
  useEffect(() => {
    if (!stopsAtHorizon || bucket === null || pending) {
      return;
    }
    const now = performance.now();
    const wait = Math.max(
      LEAST_MS_BETWEEN_ASKS,
      lastAskTook.current * IDLE_TO_WORK_RATIO,
    );
    if (now - lastAskedAt.current < wait) {
      return;
    }
    lastAskedAt.current = now;
    void solve({
      toUt: value("ut", bucket * ASK_EVERY_UT_SECONDS + span),
      maxPoints: value("count", PATH_POINTS),
      certification: PropagationCertification.CertifiedOnly,
    }).then(() => {
      lastAskTook.current = performance.now() - now;
    });
  }, [stopsAtHorizon, bucket, span, solve, pending, retry]);

  // The last path stays drawn while the provider works on the next one; a real refusal clears it.
  const lastPath = useRef<typeof reply | null>(null);
  if (reply != null && !stillWorking) {
    lastPath.current = reply.solved ? reply : null;
  }
  const answered = lastPath.current;

  return useMemo(() => {
    const path = answered?.solved ? answered.path : null;
    if (
      !stopsAtHorizon ||
      orbit === undefined ||
      !path ||
      path.kind !== TrajectoryKindLike.Integrated ||
      path.states.length < 2 ||
      path.reachedUt == null
    ) {
      return trajectory;
    }
    const points: TrajectoryPoint[] = path.states.map((s) => ({
      x: s.x.in("m").valueOf(),
      y: s.y.in("m").valueOf(),
      z: s.z.in("m").valueOf(),
      ut: s.ut.valueOf(),
    }));
    const toUt = path.reachedUt.valueOf();
    const arc: Extract<OrbitTrajectory, { shape: "arc" }> = {
      shape: "arc",
      points,
      fromUt: points[0].ut,
      toUt,
      frame: {
        kind: TrajectoryFrameKindLike.BodyCentredInertial,
        centreBodyIndex: path.centreBodyIndex.valueOf(),
        lengthsPulsate: false,
      },
      // A provider can stop short on a long ask, and that end is the provider's rather than the orbit's.
      farEnd: toUt < points[0].ut + span - 1 ? "horizon" : "revolution",
    };
    return inOrbitPlane ? (arcInOrbitPlane(arc, orbit) ?? trajectory) : arc;
  }, [answered, stopsAtHorizon, orbit, trajectory, inOrbitPlane, span]);
}
