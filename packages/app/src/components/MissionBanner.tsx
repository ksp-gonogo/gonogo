import { useGameContext, useTelemetry } from "@ksp-gonogo/core";
import {
  useGameStatus,
  useStreamConnected,
  useViewClockOptional,
} from "@ksp-gonogo/sitrep-client";
import { MissionDate, ReadoutCaption } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { SignalDelayReadout } from "./SignalDelayReadout";
import { VantageControl } from "./VantageControl";

/**
 * Thin, unobtrusive strip across the very top of the main screen, the
 * user's own brief: "invisible banner, ie the colour of the background/
 * transparent, with small basic colour text ... maybe 30px off the top of
 * the page". Background matches the page surface, text is muted, and it
 * claims a fixed ~30px so it never has to fight the dashboard grid for
 * space. Renders left-to-right as a small `label value` field list so more
 * fields can be added later without touching the layout.
 *
 * Mounted on both screens as the first child of `<Layout as="main">` (normal
 * document flow: see either file for why no flex/position:fixed trickery is
 * needed to reserve the space). `VantageControl` renders itself differently on
 * each; nothing else here branches.
 *
 * `actions` are the screen's header controls, drawn at the top right.
 * `centre` is drawn in the middle of the strip, centred on the page rather
 * than on the room the fields leave, and drops to a row of its own on a
 * narrow screen. `centreControls` are the controls for what the centre shows:
 * beside `actions` where there is room, and under the centre on a phone, where
 * the actions get a row of their own and the fields stack as a list.
 *
 * The strip itself is deliberately not a live region: the time field updates
 * roughly once a second off the live view clock, and an
 * `aria-live`/`role="status"` around it would announce every tick to a screen
 * reader. A single `aria-label` on the container makes the whole strip
 * discoverable as one unit instead. A field whose value changes rarely and
 * matters when it does can still declare its own live region, and the station's
 * vantage readout is one.
 *
 * The vessel name sits after the command centre, from the same
 * `vessel.identity` the rest of the screen reads, so a player who has added no
 * widget still sees which craft the numbers belong to.
 *
 * The signal delay sits beside the command centre because on a command-centre
 * screen it is that centre's distance from the craft. A pilot's is the distance
 * back to the centre mission control stands at. Either way it is only there
 * while a craft is flying.
 */
export function MissionBanner({
  actions,
  centre,
  centreControls,
}: Readonly<{
  actions?: ReactNode;
  centre?: ReactNode;
  centreControls?: ReactNode;
}>) {
  const phone = usePhoneBanner();
  const controlsBelow = phone && centreControls;
  return (
    <Banner role="group" aria-label="Mission status">
      <Fields>
        <BannerField label="UT">
          <BannerDate />
        </BannerField>
        <BannerField label="Command centre">
          <VantageControl />
        </BannerField>
        <VesselField />
        <EvaField />
        <SignalDelayField />
        <StreamStatusField />
        <GameStatusField />
      </Fields>
      {centre || controlsBelow ? (
        <Centre>
          {centre}
          {controlsBelow ? centreControls : null}
        </Centre>
      ) : null}
      {actions || centreControls ? (
        <Actions>
          {controlsBelow ? null : centreControls}
          {actions}
        </Actions>
      ) : null}
    </Banner>
  );
}

/** True while the screen is phone width, where the banner stacks into rows. */
function usePhoneBanner(): boolean {
  const query = `(max-width: ${PHONE_BANNER})`;
  const [phone, setPhone] = useState(
    () => globalThis.matchMedia?.(query).matches ?? false,
  );
  useEffect(() => {
    const mql = globalThis.matchMedia?.(query);
    if (!mql) return;
    setPhone(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setPhone(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return phone;
}

/** The view time at the one-second resolution the date shows, re-rendering only when that second changes. */
function BannerDate() {
  return <MissionDate value={useViewSecond()} />;
}

function wholeSecond(ut: number | undefined): number | undefined {
  return ut !== undefined && Number.isFinite(ut) ? Math.floor(ut) : undefined;
}

/**
 * The view clock's per-frame UT floored to a whole second before it reaches
 * state, so a frame that moves the view by a fraction of a second costs no
 * render at all.
 */
function useViewSecond(): number | undefined {
  const clock = useViewClockOptional();
  const [second, setSecond] = useState(() => wholeSecond(clock?.viewUt()));
  const lastDelivered = useRef(second);
  useEffect(() => {
    if (!clock) {
      lastDelivered.current = undefined;
      setSecond(undefined);
      return;
    }
    return clock.onFrame((ut) => {
      const next = wholeSecond(ut);
      if (next === lastDelivered.current) return;
      lastDelivered.current = next;
      setSecond(next);
    });
  }, [clock]);
  return second;
}

function BannerField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <InlinePair>
      <ReadoutCaption>{label}</ReadoutCaption>
      <FieldValue>{children}</FieldValue>
    </InlinePair>
  );
}

/** The active craft's name, and nothing while there is no craft or its name has not arrived. */
function VesselField() {
  const identity = useTelemetry("vessel.identity");
  if (identity.state !== "observed" && identity.state !== "held") return null;
  const name = identity.value.name.trim();
  if (name === "") return null;
  return (
    <BannerField label="Vessel">
      <VesselName>{name}</VesselName>
    </BannerField>
  );
}

/** The kerbals outside within physics range, named, and nothing while nobody is. The kerbal the vessel field already names is left out. */
function EvaField() {
  const crew = useTelemetry("eva.crew");
  const identity = useTelemetry("vessel.identity");
  if (crew.state !== "observed" && crew.state !== "held") return null;
  const ownId =
    identity.state === "observed" || identity.state === "held"
      ? identity.value.vesselId
      : undefined;
  const names = crew.value.kerbals.flatMap((kerbal) => {
    const name = kerbal.name?.trim();
    return name && (ownId === undefined || kerbal.kerbalVesselId !== ownId)
      ? [name]
      : [];
  });
  if (names.length === 0) return null;
  return (
    <BannerField label="EVA">
      <VesselName>{names.join(", ")}</VesselName>
    </BannerField>
  );
}

/**
 * No active vessel, no field: there is no craft for a delay to be measured to.
 * Delay switched off leaves no field either, since a caption over a bare zero
 * would state a delay that is not there.
 */
function SignalDelayField() {
  const { inFlight } = useGameContext();
  if (!inFlight) return null;
  return (
    <SignalDelayReadout
      wrap={(readout) => <BannerField label="Delay">{readout}</BannerField>}
    />
  );
}

const SCENE_NAMES: Record<string, string> = {
  FLIGHT: "Flight",
  SPACECENTER: "Space Center",
  TRACKSTATION: "Tracking Station",
  EDITOR: "Editor",
  MAINMENU: "Main Menu",
};

/**
 * What holds every reading: KSP loading a scene, or no game at all at its main
 * menu. It is a status, so it is quiet text in a live region that speaks once
 * per change, and absent while the game is ready. The store decides when a load
 * has run long enough to be worth saying, and owns every load, so the
 * scene-change notice has none of its own.
 */
function GameStatusField() {
  const { state, scene } = useGameStatus();
  if (state === "ready") return null;
  return (
    <GameStatus role="status" aria-live="polite">
      <BannerField label="KSP">
        {state === "no-game"
          ? "No game loaded"
          : `Loading ${SCENE_NAMES[scene] ?? scene}`}
      </BannerField>
    </GameStatus>
  );
}

/** How long the stream stays down before the header says so, so the moment before the first connection opens, and a reconnect that takes no time, say nothing. */
const STREAM_DOWN_ONSET_MS = 1500;

/**
 * The stream to the mod being down: nothing can be sent and no reading is
 * arriving. It is a status, so quiet text in a live region that speaks once per
 * change, and absent while the stream is open.
 */
function StreamStatusField() {
  const connected = useStreamConnected();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (connected) {
      setShown(false);
      return;
    }
    const id = setTimeout(() => setShown(true), STREAM_DOWN_ONSET_MS);
    return () => clearTimeout(id);
  }, [connected]);
  if (connected || !shown) return null;
  return (
    <StreamStatus role="status" aria-live="polite">
      <BannerField label="Mod">
        <WarnValue>Not connected</WarnValue>
      </BannerField>
    </StreamStatus>
  );
}

const StreamStatus = styled.span`
  display: inline-flex;
`;

const WarnValue = styled.span`
  color: var(--color-warn-text);
`;

/** Below this width the centre takes a row of its own under the fields and actions. */
const NARROW_BANNER = "56rem";

/** Below this width the actions take the top row and the fields stack as a list. */
export const PHONE_BANNER = "36rem";

const InlinePair = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-related);
`;

/*
 * On a phone the fields are a two-column list, captions in one column and
 * values in the other. Every field, including one wrapped in its own live
 * region, spans both columns and lays its caption and value on the list's own
 * columns through subgrid, so the values line up whatever wraps a field.
 */
const Fields = styled.div`
  grid-area: fields;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--gap-section);
  row-gap: var(--gap-related);
  min-width: 0;

  @media (max-width: ${PHONE_BANNER}) {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: var(--gap-related);
    align-items: baseline;

    & > *,
    & > * > ${InlinePair} {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: subgrid;
      align-items: baseline;
    }
  }
`;

const Centre = styled.div`
  grid-area: centre;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--gap-related);
  min-width: 0;

  &:empty {
    display: none;
  }
`;

const Actions = styled.div`
  grid-area: actions;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: var(--gap-related);
  min-width: 0;
`;

const VesselName = styled.span`
  max-width: 24ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const GameStatus = styled.span`
  display: inline-flex;
`;

const Banner = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  grid-template-areas: "fields centre actions";
  align-items: center;
  column-gap: var(--gap-section);
  row-gap: var(--gap-related);
  min-height: 30px;
  flex-shrink: 0;
  margin-bottom: var(--gap-mission-bar);
  padding: var(--inset-mission-bar);
  background: var(--color-surface-app);
  font-variant-numeric: tabular-nums;

  @media (max-width: ${NARROW_BANNER}) {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "fields actions"
      "centre centre";
  }

  @media (max-width: ${PHONE_BANNER}) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "actions"
      "fields"
      "centre";
    row-gap: var(--gap-section);
  }

  /* With nothing in the centre, the fields keep the whole width beside the actions. */
  &:has(> ${Centre}:empty) {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: "fields actions";

    @media (max-width: ${PHONE_BANNER}) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        "actions"
        "fields";
    }
  }
`;

const FieldValue = styled.span`
  font-size: var(--font-size-value);
  color: var(--color-text-muted);
`;
