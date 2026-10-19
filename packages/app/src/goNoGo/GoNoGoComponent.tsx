import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  registerComponent,
  useActionInput,
  useScreen,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Field, FieldLabel, Input, useModalSaveBar } from "@ksp-gonogo/ui";
import { Button, Grid, NULL_DISPLAY, Select, Unit } from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import styled from "styled-components";
import { usePeerClient } from "../peer/PeerClientContext";
import { playCountdownTone } from "../sound";
import { useGoNoGoHost, useGoNoGoSnapshot } from "./GoNoGoHostContext";
import { DEFAULT_GONOGO_CONFIG } from "./GoNoGoHostService";
import { DEFAULT_ON_GO, onGoLabelOf, useOnGoOptions } from "./onGo";

interface GoNoGoWidgetConfig {
  /** Main-screen only: countdown length in seconds. Default 10. */
  countdownSeconds?: number;
  /** Main-screen only: what fires at T-0, an action group id or "none". Default Stage. */
  onGo?: string;
}

const actions = [
  {
    id: "toggle-vote",
    label: "Toggle GO/NO-GO",
    accepts: ["button"],
    description: "Flip the local station's GO/NO-GO vote.",
  },
  {
    id: "abort",
    label: "Abort",
    accepts: ["button"],
    description: "Post-launch: send the abort signal.",
  },
] as const satisfies readonly ActionDefinition[];

type GoNoGoActions = typeof actions;

// Component entry: branches on screen context.
function GoNoGoComponent({
  config,
  w,
  h,
  onConfigChange,
}: Readonly<ComponentProps<GoNoGoWidgetConfig>>) {
  // The host aggregates every participant's vote; every other screen casts one
  // and reads the tally back. A pilot page is a mesh CLIENT for this even
  // though it holds its own telemetry session, so it votes rather than tallies.
  const screen = useScreen();
  if (screen !== "main") return <StationView w={w} h={h} />;
  return (
    <MainView config={config} w={w} h={h} onConfigChange={onConfigChange} />
  );
}

function StationView({
  w,
  h,
}: {
  w: number | undefined;
  h: number | undefined;
}) {
  const client = usePeerClient();
  // The host owns the T-0 action; `undefined` until it has said.
  const [onGoLabel, setOnGoLabel] = useState<string | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!client) return;
    return client.onGonogoOnGo(setOnGoLabel);
  }, [client]);
  // Launched once the view clock is past liftoff, so it runs against the same
  // clock this screen reads everything else against. Never before the clamps
  // release, `launchUt` being null until then.
  const identity = useTelemetry("vessel.identity");
  const launchUt =
    identity.state === "observed" || identity.state === "held"
      ? identity.value.launchUt
      : undefined;
  const viewUt = useViewUt();
  const launched =
    launchUt != null &&
    viewUt !== undefined &&
    viewUt.minus(launchUt).greaterThan(0);
  const [vote, setVote] = useState<"go" | "no-go">("no-go");
  // Set when the host resets the poll after launch, so the vote is offered again beside ABORT until the craft is back on the pad.
  const [pollOpen, setPollOpen] = useState(false);
  const [countdown, setCountdown] = useState<{ t0Ms: number } | null>(null);
  const [abortNotice, setAbortNotice] = useState<{
    stationName: string;
    at: number;
  } | null>(null);
  // Tick at 10 Hz during countdown for a responsive T-minus display.
  // useReducer instead of useState so Sonar's "unused tuple element"
  // rule (S6754) doesn't trip on a tick-counter that we never read.
  const [, setNow] = useReducer((n: number, _action: unknown) => n + 1, 0);
  const tickingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Did the user on THIS station press the abort button? Used to re-notify
  // the host on reconnect (e.g. after a main-screen refresh mid-flight).
  const iAbortedRef = useRef(false);

  // A launched station has effectively "left the poll", null = not voting rather than stale no-go, which would render a confusing red cell on main.
  const polling = !launched || pollOpen;
  const effectiveVote = polling ? vote : null;

  // Push the current effective vote whenever it changes. Split from the
  // lifecycle effect below so vote flips don't transiently send null (which
  // would cancel an in-flight countdown or flicker the grid cell to grey).
  useEffect(() => {
    if (!client) return;
    client.sendGonogoVote(effectiveVote);
  }, [client, effectiveVote]);

  // Re-assert state on (re)connection; send null on unmount so the host
  // removes us from the grid. Uses a ref so the unmount cleanup and
  // reconnect handler see the latest effective vote without re-subscribing
  // on every toggle.
  const effectiveVoteRef = useRef(effectiveVote);
  useEffect(() => {
    effectiveVoteRef.current = effectiveVote;
  }, [effectiveVote]);
  const launchedRef = useRef(launched);
  useEffect(() => {
    launchedRef.current = launched;
  }, [launched]);

  // Revert clears local "I aborted" memory: revert means we're back on the pad and the abort button is a fresh slate.
  useEffect(() => {
    if (!launched) {
      iAbortedRef.current = false;
      setPollOpen(false);
    }
  }, [launched]);

  useEffect(() => {
    if (!client) return;
    // Reset the local vote when the host process restarts (fresh session
    // token). Without this, a station that voted GO before the operator
    // refreshed the main screen would re-broadcast the old GO vote on
    // reconnect, making it look like the GO state persisted across a
    // fresh app launch. We clear local state; the change effect resends
    // the fresh "no-go" automatically.
    const unsubRestart = client.onHostRestart(() => {
      iAbortedRef.current = false;
      // Update the ref synchronously so the hello-driven resend that
      // fires immediately after sees the cleared value, not the stale
      // pre-restart vote.
      effectiveVoteRef.current = "no-go";
      setVote("no-go");
    });
    // Resend our current vote after every hello (initial connect AND
    // reconnect). Doing this on `hello` rather than `connected` means we
    // run AFTER the restart-detection above has had a chance to flip the
    // local state: so a station that should reset doesn't briefly flash
    // its old vote on the host's grid before the restart fires.
    const unsubHello = client.onHostHello(() => {
      client.sendGonogoVote(effectiveVoteRef.current);
      if (iAbortedRef.current) client.sendGonogoAbort();
    });
    return () => {
      unsubHello();
      unsubRestart();
      client.sendGonogoVote(null);
    };
  }, [client]);

  // Host broadcasts for countdown + abort attribution
  useEffect(() => {
    if (!client) return;
    const unsubs = [
      client.onGonogoCountdownStart((t0Ms) => setCountdown({ t0Ms })),
      client.onGonogoCountdownCancel(() => setCountdown(null)),
      client.onGonogoReset((reopened) => {
        // The host has forgotten every vote, and a vote already at NO-GO would not change and so would not be sent again: resend it, or this screen drops out of the poll.
        const next = reopened || !launchedRef.current ? "no-go" : null;
        effectiveVoteRef.current = next ?? "no-go";
        setVote("no-go");
        setCountdown(null);
        setPollOpen(reopened);
        client.sendGonogoVote(next);
      }),
      client.onGonogoAbortNotify((stationName, at) =>
        setAbortNotice({ stationName, at }),
      ),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [client]);

  // Countdown ticker
  useEffect(() => {
    if (!countdown) {
      if (tickingRef.current) {
        clearInterval(tickingRef.current);
        tickingRef.current = null;
      }
      return;
    }
    tickingRef.current = setInterval(() => setNow(Date.now()), 100);
    return () => {
      if (tickingRef.current) clearInterval(tickingRef.current);
      tickingRef.current = null;
    };
  }, [countdown]);

  // Clear abort notice on revert
  useEffect(() => {
    if (!launched && abortNotice) setAbortNotice(null);
  }, [launched, abortNotice]);

  const handleVoteToggle = () => {
    if (!polling) return;
    setVote((prev) => (prev === "go" ? "no-go" : "go"));
  };

  const handleAbort = () => {
    if (!launched || !client) return;
    iAbortedRef.current = true;
    client.sendGonogoAbort();
  };

  useActionInput<GoNoGoActions>({
    "toggle-vote": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      handleVoteToggle();
      return { Status: vote === "go" ? "NO-GO" : "GO" };
    },
    abort: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      handleAbort();
      return { Status: "ABORTING" };
    },
  });

  if (launched && !pollOpen) {
    return (
      <StationLayout>
        <BigButton
          $variant="abort"
          onClick={handleAbort}
          role="alert"
          aria-live="assertive"
        >
          <ButtonLabel>ABORT</ButtonLabel>
          {abortNotice && (
            <AbortNotice>Aborted by {abortNotice.stationName}</AbortNotice>
          )}
        </BigButton>
      </StationLayout>
    );
  }

  const secondsLeft = countdown
    ? Math.max(0, (countdown.t0Ms - Date.now()) / 1000)
    : null;

  const showOnGo = onGoLabel !== undefined && (w ?? 4) >= 4 && (h ?? 4) >= 4;

  return (
    <StationLayout>
      {showOnGo && (
        <OnGoReadout>
          On go: <strong>{onGoLabel ?? "Nothing"}</strong>
        </OnGoReadout>
      )}
      <BigButton
        $variant={vote === "go" ? "go" : "nogo"}
        onClick={handleVoteToggle}
        role="status"
        aria-live="polite"
      >
        <ButtonLabel>{vote === "go" ? "GO" : "NO-GO"}</ButtonLabel>
        {secondsLeft !== null && (
          <CountdownOverlay role="timer" aria-label="Countdown">
            T − <Unit value={value("s", secondsLeft)} decimals={1} />
          </CountdownOverlay>
        )}
        {secondsLeft !== null && (
          <CountdownAnnouncer secondsLeft={secondsLeft} />
        )}
      </BigButton>
      {launched && (
        <AbortStrip $variant="abort" onClick={handleAbort}>
          <ButtonLabel>ABORT</ButtonLabel>
          {abortNotice && (
            <AbortNotice>Aborted by {abortNotice.stationName}</AbortNotice>
          )}
        </AbortStrip>
      )}
    </StationLayout>
  );
}

/**
 * Announces countdown milestones to assistive tech without flooding the
 * screen reader every tick. Fires polite announcements at T-10, T-5, T-3,
 * T-2, T-1, and T-0.
 */
const MILESTONES = new Set([10, 5, 3, 2, 1, 0]);

export function CountdownAnnouncer({
  secondsLeft,
}: Readonly<{ secondsLeft: number }>) {
  const [message, setMessage] = useState("");
  const lastMilestoneRef = useRef<number | null>(null);

  useEffect(() => {
    const whole = Math.ceil(secondsLeft);
    if (!MILESTONES.has(whole)) return;
    if (lastMilestoneRef.current === whole) return;
    lastMilestoneRef.current = whole;
    setMessage(whole === 0 ? "T zero" : `T minus ${whole}`);
  }, [secondsLeft]);

  return (
    <span className="sr-only" role="status" aria-live="polite">
      {message}
    </span>
  );
}

/**
 * Fires a short audio blip on each whole-second countdown tick (T-9...T-1).
 * The distinct T-0 commit tone is emitted by GoNoGoHostService (see the
 * guard below). MAIN-ONLY (rendered only inside MainView) and gated by the
 * "Sound effects" setting via playCountdownTone. Pairs with the on-screen
 * CountdownBanner so audio is never the only cue.
 *
 * Renders nothing, it's a side-effect-only companion. Tracks the last
 * whole second in a ref so the 10 Hz parent tick doesn't double-fire.
 */
export function CountdownTone({
  secondsLeft,
}: Readonly<{ secondsLeft: number }>) {
  const lastWholeRef = useRef<number | null>(null);

  useEffect(() => {
    const whole = Math.ceil(secondsLeft);
    if (lastWholeRef.current === whole) return;
    // Skip the very first observed value so mounting mid-countdown (e.g. a hot reload) doesn't fire a spurious blip for whatever second we land on.
    const isFirst = lastWholeRef.current === null;
    lastWholeRef.current = whole;
    if (isFirst) return;
    // T-0 is emitted by GoNoGoHostService.onCountdownReached, the component
    // unmounts the instant the countdown clears, so we can't reliably observe
    // secondsLeft === 0 here. Only emit the per-second blips (9...1).
    if (whole === 0) return;
    playCountdownTone(false);
  }, [secondsLeft]);

  return null;
}

function MainView({
  config,
  w,
  onConfigChange,
}: Readonly<{
  config: GoNoGoWidgetConfig | undefined;
  w: number | undefined;
  h: number | undefined;
  onConfigChange: ((config: GoNoGoWidgetConfig) => void) | undefined;
}>) {
  const host = useGoNoGoHost();
  const options = useOnGoOptions();
  const onGo = config?.onGo ?? DEFAULT_ON_GO;
  const onGoLabel = onGoLabelOf(options, onGo);
  const snapshot = useGoNoGoSnapshot();
  // Bumped from the countdown ticker below: useReducer so Sonar's "unused tuple element" rule (S6754) doesn't flag this.
  const [, setNow] = useReducer((n: number, _action: unknown) => n + 1, 0);

  // Push the widget's config into the host service. Main-level settings
  // masquerade as per-widget config for user discoverability; if two widgets
  // exist with different configs, whichever renders last wins, fine for v1.
  useEffect(() => {
    if (!host) return;
    host.setConfig({
      countdownLengthMs:
        (config?.countdownSeconds ??
          DEFAULT_GONOGO_CONFIG.countdownLengthMs / 1000) * 1000,
      onGo,
      onGoLabel,
    });
  }, [host, config?.countdownSeconds, onGo, onGoLabel]);

  // Tick during countdown so the T-minus display updates
  useEffect(() => {
    if (!snapshot?.countdown) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [snapshot?.countdown]);

  if (!snapshot) {
    return <Empty>GO/NO-GO host unavailable</Empty>;
  }

  const { stations, countdown, abort, launched, reopened } = snapshot;
  const polling = !launched || reopened;
  const secondsLeft = countdown
    ? Math.max(0, (countdown.t0Ms - Date.now()) / 1000)
    : null;

  // Selective rendering: chrome (the T-0 action line) drops at small widths so the GO/NO-GO grid stays the focus.
  const cols = w ?? 4;
  const showControls = cols >= 4;

  return (
    <MainLayout>
      <MainHeader>
        <HeaderLabel>{polling ? "GO / NO-GO" : "MISSION ACTIVE"}</HeaderLabel>
      </MainHeader>
      {showControls && (
        <ControlsRow>
          {polling && (
            <OnGoLine>
              <label htmlFor="gonogo-on-go">On go:</label>
              <OnGoSelect
                id="gonogo-on-go"
                value={onGo}
                disabled={countdown !== null}
                onChange={(e) =>
                  onConfigChange?.({ ...config, onGo: e.target.value })
                }
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </OnGoSelect>
            </OnGoLine>
          )}
          <Button size="sm" onClick={() => host?.reset()}>
            Reset
          </Button>
        </ControlsRow>
      )}
      {countdown && (
        <>
          <CountdownBanner role="timer" aria-label="Countdown">
            {onGoLabel !== null && <BannerAction>{onGoLabel} in </BannerAction>}
            T − <Unit value={value("s", secondsLeft ?? 0)} decimals={1} />
          </CountdownBanner>
          {secondsLeft !== null && (
            <CountdownAnnouncer secondsLeft={secondsLeft} />
          )}
          {secondsLeft !== null && <CountdownTone secondsLeft={secondsLeft} />}
        </>
      )}
      {abort && (
        <AbortBanner role="alert">
          ABORT: triggered by {abort.stationName}
        </AbortBanner>
      )}
      <Grid
        squares
        minColWidth="88px"
        minRowHeight="40px"
        gap="related-comfortable"
      >
        {stations.length === 0 && <Empty>No stations connected</Empty>}
        {stations.map((s) => {
          const cellState = deriveCellState(s, launched, reopened, abort);
          return (
            <Cell
              key={s.peerId}
              $state={cellState}
              role="status"
              aria-live="polite"
              aria-label={`${s.name}: ${cellLabel(cellState)}`}
            >
              <CellName>{s.name}</CellName>
              <CellStatus>{cellLabel(cellState)}</CellStatus>
            </Cell>
          );
        })}
      </Grid>
    </MainLayout>
  );
}

type CellState = "go" | "no-go" | "neutral" | "abort" | "unknown";

function deriveCellState(
  s: { peerId: string; status: "go" | "no-go" | null },
  launched: boolean,
  reopened: boolean,
  abort: { peerId: string; stationName: string; at: number } | null,
): CellState {
  if (launched) {
    if (abort?.peerId === s.peerId) return "abort";
    if (!reopened) return "neutral";
  }
  if (s.status === "go") return "go";
  if (s.status === "no-go") return "no-go";
  return "unknown";
}

function cellLabel(state: CellState): string {
  switch (state) {
    case "go":
      return "GO";
    case "no-go":
      return "NO-GO";
    case "abort":
      return "ABORT";
    case "neutral":
      return "ACTIVE";
    default:
      return NULL_DISPLAY;
  }
}

// Config component: main-screen only.
function GoNoGoConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<GoNoGoWidgetConfig>>) {
  const [countdownSeconds, setCountdownSeconds] = useState(
    String(
      config?.countdownSeconds ??
        DEFAULT_GONOGO_CONFIG.countdownLengthMs / 1000,
    ),
  );

  const candidate = useMemo<GoNoGoWidgetConfig>(() => {
    const secs = Number.parseFloat(countdownSeconds);
    return {
      countdownSeconds:
        Number.isFinite(secs) && secs > 0
          ? secs
          : DEFAULT_GONOGO_CONFIG.countdownLengthMs / 1000,
      onGo: config?.onGo ?? DEFAULT_ON_GO,
    };
  }, [countdownSeconds, config?.onGo]);

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigWrap>
      <Field>
        <FieldLabel htmlFor="gonogo-countdown">Countdown length (s)</FieldLabel>
        <Input
          id="gonogo-countdown"
          type="number"
          min={1}
          max={300}
          step={1}
          value={countdownSeconds}
          onChange={(e) => setCountdownSeconds(e.target.value)}
        />
      </Field>
    </ConfigWrap>
  );
}

type BigButtonVariant = "go" | "nogo" | "abort";

// Flat look-up tables keep the styled-template readable and quiet
// SonarQube's nested-ternary warning (S3358). One entry per variant.
const BIG_BUTTON_BORDER: Record<BigButtonVariant, string> = {
  go: "var(--color-go-status)",
  abort: "var(--color-nogo-mark)",
  nogo: "var(--color-nogo-mark)",
};
const BIG_BUTTON_BG: Record<BigButtonVariant, string> = {
  go: "radial-gradient(circle at 50% 35%, var(--color-accent-fg) 0%, var(--color-go-status) 90%)",
  abort:
    "radial-gradient(circle at 50% 35%, var(--color-nogo-mark) 0%, var(--color-nogo-muted) 90%)",
  nogo: "radial-gradient(circle at 50% 35%, var(--color-nogo-muted) 0%, var(--color-nogo-muted) 90%)",
};
const BIG_BUTTON_COLOR: Record<BigButtonVariant, string> = {
  go: "var(--color-go-text)",
  abort: "var(--color-nogo-text)",
  nogo: "var(--color-nogo-text)",
};

const BigButton = styled.button<{ $variant: BigButtonVariant }>`
  position: relative;
  width: 100%;
  flex: 1 1 0;
  min-height: 0;
  border-radius: var(--radius-floating);
  border: 2px solid ${({ $variant }) => BIG_BUTTON_BORDER[$variant]};
  background: ${({ $variant }) => BIG_BUTTON_BG[$variant]};
  color: ${({ $variant }) => BIG_BUTTON_COLOR[$variant]};
  cursor: pointer;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-related);
  box-shadow: inset 0 0 24px rgba(0, 0, 0, 0.6);
  transition: transform var(--duration-fast) var(--ease-standard);
  /*
   * Establish a CSS containment context so ButtonLabel can size its text
   * relative to the button itself (cqmin), not the viewport. A
   * viewport-relative rule (10vw) leaves giant buttons with tiny text on
   * small viewports, and vice versa.
   */
  container-type: size;

  &:active {
    transform: scale(0.98);
  }
`;

const AbortStrip = styled(BigButton)`
  flex: 0 0 30%;
`;

const ButtonLabel = styled.span`
  /*
   * 22cqmin = 22% of the smaller of the button's width/height. clamp
   * keeps the text legible on a 3x3 grid cell (~min 28px) without
   * exceeding a sensible ceiling on huge wallboard layouts.
   */
  font-size: clamp(28px, 22cqmin, 120px);
  line-height: var(--line-height-flush);
`;

const CountdownOverlay = styled.span`
  position: absolute;
  top: 8px;
  left: 8px;
  padding: var(--inset-surface);
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid var(--color-warn-mark);
  border-radius: var(--radius-regular);
  color: var(--color-warn-text);
  font-size: var(--font-size-figure);
  letter-spacing: 0.15em;
`;

const AbortNotice = styled.span`
  font-size: var(--font-size-compact);
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 0.08em;
  text-transform: none;
`;

const MainLayout = styled.div`
  /* The countdown sizes itself against this box in both axes, so it fits the tile it is in. */
  container-type: size;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  width: 100%;
  height: 100%;
  padding: var(--inset-gonogo-board);
`;

const MainHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-related);
`;

const HeaderLabel = styled.span`
  white-space: nowrap;
  font-size: var(--font-size-caption);
  letter-spacing: 0.15em;
  color: var(--color-text-muted);
  text-transform: uppercase;
`;

const ControlsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--gap-related);
`;

const OnGoLine = styled.div`
  flex: 1 1 0;
  min-width: 7rem;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  min-width: 0;
  font-size: var(--font-size-caption);
  letter-spacing: 0.15em;
  color: var(--color-text-muted);
  text-transform: uppercase;
`;

const OnGoSelect = styled(Select)`
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-caption);
`;

const OnGoReadout = styled.div`
  font-size: var(--font-size-caption);
  letter-spacing: 0.15em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  text-align: center;
`;

const StationLayout = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  width: 100%;
  height: 100%;
`;

const CountdownBanner = styled.div`
  text-align: center;
  font-size: clamp(var(--font-size-value), min(11cqw, 22cqh), 56px);
  font-weight: 700;
  color: var(--color-warn-text);
  letter-spacing: 0.1em;
  white-space: nowrap;
`;

const BannerAction = styled.span`
  display: block;
  font-size: clamp(var(--font-size-caption), 4.5cqw, var(--font-size-value));
  letter-spacing: 0.12em;
  white-space: normal;
`;

const AbortBanner = styled.div`
  text-align: center;
  padding: var(--inset-surface);
  border: 1px solid var(--color-nogo-mark);
  background: rgba(200, 40, 40, 0.2);
  color: var(--color-nogo-text);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const Cell = styled.div<{ $state: CellState }>`
  /* The cell's own height sets its type, so a short row shrinks its text instead of overflowing. */
  container-type: size;
  min-height: 0;
  justify-content: center;
  padding: var(--inset-surface);
  border-radius: var(--radius-regular);
  border: 1px solid ${({ $state }) => cellBorder($state)};
  background: ${({ $state }) => cellBg($state)};
  color: ${({ $state }) => cellColor($state)};
  display: flex;
  flex-direction: column;
  gap: var(--gap-related-dense);
`;

function cellBorder(state: CellState): string {
  switch (state) {
    case "go":
      return "var(--color-go-status)";
    case "no-go":
    case "abort":
      return "var(--color-nogo-mark)";
    case "neutral":
      return "var(--color-info-mark)";
    default:
      return "var(--color-border-strong)";
  }
}

function cellBg(state: CellState): string {
  switch (state) {
    case "go":
      return "rgba(40, 160, 80, 0.2)";
    case "no-go":
      return "rgba(160, 40, 40, 0.2)";
    case "abort":
      return "rgba(200, 40, 40, 0.4)";
    case "neutral":
      return "rgba(60, 100, 160, 0.15)";
    default:
      return "rgba(50, 50, 50, 0.25)";
  }
}

function cellColor(state: CellState): string {
  switch (state) {
    case "go":
      return "var(--color-go-text)";
    case "no-go":
    case "abort":
      return "var(--color-nogo-text)";
    case "neutral":
      return "var(--color-info-mark)";
    default:
      return "var(--color-text-muted)";
  }
}

const CellName = styled.span`
  font-size: clamp(var(--font-size-caption), 16cqh, var(--font-size-value));
  line-height: var(--line-height-flush);
  letter-spacing: 0.08em;
`;

const CellStatus = styled.span`
  /* Display tier: the type scale stops at --font-size-lg on purpose,
     everything above 16px in this codebase is a clamp, a JS fit, or locked
     to a box width. */
  font-size: clamp(var(--font-size-value), 30cqh, 18px);
  line-height: var(--line-height-flush);
  font-weight: 700;
  letter-spacing: 0.12em;
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-compact);
  letter-spacing: 0.1em;
  text-align: center;
  padding: var(--inset-empty-state);
`;

const ConfigWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

registerComponent<GoNoGoWidgetConfig>({
  id: "gonogo",
  name: "GO / NO-GO",
  description:
    "Mission readiness poll: button on station screens, grid of lights on main. Morphs into ABORT after launch.",
  tags: ["mission-control"],
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  /*
   * The board's text is one size and only the station cards grow, so past
   * sixteen rows four stations are tall empty blocks. Width is left at the
   * full desktop grid: a wide, short board stays a tidy row.
   */
  maxSize: { w: 36, h: 16 },
  component: GoNoGoComponent,
  configComponent: GoNoGoConfigComponent,
  dataRequirements: ["vessel.identity.launchUt"],
  defaultConfig: {
    countdownSeconds: DEFAULT_GONOGO_CONFIG.countdownLengthMs / 1000,
    onGo: DEFAULT_ON_GO,
  },
  actions,
});

export { GoNoGoComponent };
