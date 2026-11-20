import { useTelemetry } from "@ksp-gonogo/core";
import {
  useTelemetryStoreOptional,
  useUtNow,
  useViewClockOptional,
} from "@ksp-gonogo/sitrep-client";
import {
  type GameLoaded,
  stillTrue,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { GAME_LOAD_NOTICE_SECONDS } from "@ksp-gonogo/sitrep-sdk/spine";
import { BannerRow } from "@ksp-gonogo/ui";
import { MissionDate, Unit } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useEffect, useRef, useState } from "react";
import styled from "styled-components";

const VISIBLE_MS = GAME_LOAD_NOTICE_SECONDS * 1000;

/** How far behind the view clock a load may be and still count as news. */
const STALE_AFTER_SECONDS = 10;

/**
 * The player-facing words for a finished quickload, written in one place so
 * their wording can be reviewed. `from` is the UT the screen last showed, which
 * the move is measured from; with none, the screen has no earlier UT to move
 * from and the sentence leaves the move out.
 */
export function QuickloadSentence({
  event,
  from = null,
}: {
  event: GameLoaded;
  from?: Value<"ut"> | null;
}): ReactNode {
  if (event.outcome === "failed") {
    return `Quickload failed: ${event.failReason ?? "unknown reason"}`;
  }
  if (event.outcome === "cancelled") {
    return "Quickload cancelled: the scene changed first";
  }
  const lead = event.requestedBy
    ? `Quickloaded by ${event.requestedBy}`
    : "Game loaded";
  if (from === null) {
    return (
      <span>
        {`${lead} \u00b7 `}
        <MissionDate value={event.saveUt} />
      </span>
    );
  }
  const behind = from.minus(event.saveUt);
  const movedBack = behind.greaterThan(value("s", 0));
  return (
    <span>
      {`${lead} \u00b7 `}
      <MissionDate value={event.saveUt} />
      {` (moved ${movedBack ? "\u2212" : "+"}`}
      <Unit value={movedBack ? behind : behind.times(-1)} />)
    </span>
  );
}

/** Whether a finished load is news at `viewUt`, and not a replay of one the screen was not there for. */
export function isNews(event: GameLoaded, viewUt: Value<"ut">): boolean {
  const fresh = value("s", STALE_AFTER_SECONDS);
  const none = value("s", 0);
  const recent = (since: Value<"ut">) => {
    const age = viewUt.minus(since);
    return !age.lessThan(none) && !age.greaterThan(fresh);
  };
  return recent(event.saveUt) || recent(event.fromUt);
}

/**
 * A polite banner on every screen when a game load finishes, and on no screen
 * that connects afterwards: an event older than the present by
 * {@link STALE_AFTER_SECONDS} is a replay, not news.
 *
 * The event arrives with no signal delay, so it is judged against the present
 * and not the delayed view clock, which a load rewinds and leaves behind the
 * load's own times for as long as the delay lasts.
 */
export function QuickloadBanner() {
  const reading = useTelemetry("ksp.gameLoaded");
  const event = stillTrue(reading, undefined);
  const clock = useViewClockOptional();
  const utNow = useUtNow();
  const store = useTelemetryStoreOptional();
  const seenRef = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState<{
    event: GameLoaded;
    from: Value<"ut"> | null;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: utNow re-runs the judgement once the clock has a time
  useEffect(() => {
    if (!event?.loadId || event.loadId === seenRef.current) return;
    // A fresh connection is replayed the last load before the clock has a time, so the load cannot be judged yet.
    if (
      clock === undefined ||
      !Number.isFinite(clock.confirmedEdgeUt("true-now"))
    ) {
      return;
    }
    seenRef.current = event.loadId;
    if (!isNews(event, value("ut", clock.utNowEstimate()))) return;
    const before = store?.utBeforeReset();
    setAnnouncement({
      event,
      from: before === undefined ? null : value("ut", before),
    });
  }, [event, clock, utNow, store]);

  useEffect(() => {
    if (announcement === null) return;
    const id = setTimeout(() => setAnnouncement(null), VISIBLE_MS);
    return () => clearTimeout(id);
  }, [announcement]);

  if (announcement === null) return null;
  return (
    <Banner role="status" aria-live="polite">
      <BannerRow>
        <QuickloadSentence
          event={announcement.event}
          from={announcement.from}
        />
      </BannerRow>
    </Banner>
  );
}

const Banner = styled.div`
  display: inline-flex;
  padding: var(--inset-banner);
  background: color-mix(in srgb, var(--color-scrim) 88%, transparent);
  border: var(--border-width-hairline) solid var(--color-accent-fg);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-compact);
`;
