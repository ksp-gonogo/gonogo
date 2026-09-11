import {
  useObservedVantage,
  useViewClockOptional,
} from "@ksp-gonogo/sitrep-client";
import type { TimeContext } from "@ksp-gonogo/ui-kit";
import { useCallback, useSyncExternalStore } from "react";
import { useTelemetry } from "./useTelemetry";

/**
 * The gap at which the two clocks stop rendering as the same string.
 *
 * `<MissionDate>` prints whole seconds, so below one second SCET and the
 * received time ARE the same readout and a qualifier on them says nothing an
 * operator can check. The rule is "show it only when they differ", and the
 * honest reading of "differ" is at the resolution the thing is drawn at: a
 * LAN session reports 0, a craft in low orbit a few milliseconds, and neither
 * should put a label on every instant on the screen.
 */
const VISIBLE_GAP_SECONDS = 1;

/** The two qualifiers for the current screen, and the gap behind them. */
export interface TimeContexts {
  /**
   * One-way light time from the craft to the observing vantage, seconds, as
   * the view clock itself is offset by. 0 on a LAN session, when no stream is
   * mounted, and when the vantage is the craft.
   *
   * Exposed because a caller that must CONVERT between the clocks needs the
   * number and not just the label: a warp target computed as a SCET fires on
   * the view clock one light-time earlier.
   */
  owltSeconds: number;
  /**
   * Qualifier for an instant on the craft's own clock, or `undefined` when the
   * two clocks coincide and the bare time is the whole truth.
   */
  scet: TimeContext | undefined;
  /** The same, for an instant on the observing vantage's arrival clock. */
  received: TimeContext | undefined;
}

/**
 * The decision itself, with nothing to mount: given a one-way delay and the
 * name of the vantage observing, which qualifiers apply.
 *
 * Split from the hook so the rule can be tested as arithmetic rather than
 * through a provider, and so the one place that decides "do these differ"
 * stays one place.
 */
export function deriveTimeContexts(
  owltSeconds: number,
  vantage: string | undefined,
): TimeContexts {
  const owlt =
    Number.isFinite(owltSeconds) && owltSeconds > 0 ? owltSeconds : 0;
  if (owlt < VISIBLE_GAP_SECONDS) {
    return { owltSeconds: owlt, scet: undefined, received: undefined };
  }
  return {
    owltSeconds: owlt,
    scet: { frame: "scet" },
    received: { frame: "received", vantage },
  };
}

/**
 * Which clock the instants on this screen are on, ready to hand to
 * `<MissionDate context=...>`.
 *
 * ```tsx
 * const { scet, received } = useTimeContexts();
 * <MissionDate value={apoapsisUt} context={scet} />
 * ```
 *
 * Both halves come from what the stream is ACTUALLY doing rather than from a
 * setting: the delay is the one the view clock is offset by (so it holds
 * through a blackout, the same as every other delayed readout does), and the
 * vantage is `useObservedVantage`, the centre the arriving frames are stamped
 * from. On a station those frames are relayed from a host session it does not
 * own, so its own selection would name the wrong centre.
 *
 * **Not for a `TrueNow` value.** Funds, the research queue and every `rp1.*`
 * completion date are ground-side bookkeeping the command centre knows without
 * any link, so their SCET and their received time are one instant and there is
 * nothing to qualify. Reach for this where a DELAYED channel's instant is
 * drawn, or where the app computes one from delayed telemetry.
 */
export function useTimeContexts(): TimeContexts {
  const clock = useViewClockOptional();
  const owltSeconds = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => clock?.onFrame(onChange) ?? (() => {}),
      [clock],
    ),
    useCallback(() => clock?.delaySeconds() ?? 0, [clock]),
  );
  const vantage = useObservedVantageName();
  return deriveTimeContexts(owltSeconds, vantage);
}

/**
 * The observed vantage as an operator reads it: the roster's display name for
 * the centre the frames are stamped from, falling back to the raw id.
 *
 * A stale roster is still the roster (it is ground-side and declared
 * unmodellable, so nothing but never-arrived leaves it empty), which is the
 * same branch `VantageControl` takes over the same read and for the same
 * reason.
 */
function useObservedVantageName(): string | undefined {
  const observed = useObservedVantage();
  const rosterReading = useTelemetry("commandCentre.roster");
  if (observed === undefined) return undefined;
  const roster =
    rosterReading.state === "observed" || rosterReading.state === "stale"
      ? rosterReading.value
      : undefined;
  return roster?.find((c) => c.id === observed)?.displayName ?? observed;
}
