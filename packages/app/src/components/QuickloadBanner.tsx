import { useTelemetry } from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import {
  type GameLoaded,
  stillTrue,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { BannerRow } from "@ksp-gonogo/ui";
import { MissionDate, Unit } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useEffect, useRef, useState } from "react";
import styled from "styled-components";

const VISIBLE_MS = 10_000;

/** How far behind the view clock a load may be and still count as news. */
const STALE_AFTER_SECONDS = 10;

/** The player-facing words for a finished quickload, written in one place so their wording can be reviewed. */
export function QuickloadSentence({ event }: { event: GameLoaded }): ReactNode {
  if (event.outcome === "failed") {
    return `Quickload failed: ${event.failReason ?? "unknown reason"}`;
  }
  if (event.outcome === "cancelled") {
    return "Quickload cancelled: the scene changed first";
  }
  const lead = event.requestedBy
    ? `Quickloaded by ${event.requestedBy}`
    : "Game loaded";
  const behind = event.fromUt.minus(event.saveUt);
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
 * A polite banner on every screen when a quickload finishes, and on no screen
 * that connects afterwards: an event older than the view clock by
 * {@link STALE_AFTER_SECONDS} is a replay, not news.
 */
export function QuickloadBanner() {
  const reading = useTelemetry("ksp.gameLoaded");
  const event = stillTrue(reading, undefined);
  const viewUt = useViewUt();
  const seenRef = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState<GameLoaded | null>(null);

  useEffect(() => {
    if (!event?.loadId || event.loadId === seenRef.current) return;
    // A fresh connection is replayed the last load before the view clock has a time, so the load cannot be judged yet.
    if (viewUt === undefined || viewUt === null) return;
    seenRef.current = event.loadId;
    if (!isNews(event, viewUt)) return;
    setAnnouncement(event);
  }, [event, viewUt]);

  useEffect(() => {
    if (announcement === null) return;
    const id = setTimeout(() => setAnnouncement(null), VISIBLE_MS);
    return () => clearTimeout(id);
  }, [announcement]);

  if (announcement === null) return null;
  return (
    <Banner role="status" aria-live="polite">
      <BannerRow>
        <QuickloadSentence event={announcement} />
      </BannerRow>
    </Banner>
  );
}

const Banner = styled.div`
  display: inline-flex;
  padding: var(--inset-banner);
  background: rgba(0, 0, 0, 0.88);
  border: 1px solid var(--color-accent-fg);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-compact);
`;
