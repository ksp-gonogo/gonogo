import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@gonogo/core";
import {
  registerComponent,
  useActionInput,
  useDataValue,
  useScreen,
} from "@gonogo/core";
import { Field, FieldLabel, Input, PrimaryButton, Switch } from "@gonogo/ui";
import { useEffect, useReducer, useRef, useState } from "react";
import styled from "styled-components";
import { usePeerClient } from "../peer/PeerClientContext";
import { useGoNoGoHost, useGoNoGoSnapshot } from "./GoNoGoHostContext";
import { DEFAULT_GONOGO_CONFIG } from "./GoNoGoHostService";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface GoNoGoWidgetConfig {
  /** Main-screen only — countdown length in seconds. Default 10. */
  countdownSeconds?: number;
  /** Main-screen only — trigger f.stage at T-0. Default true. */
  triggerStageAtZero?: boolean;
}

const actions = [
  {
    id: "toggleVote",
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

// ---------------------------------------------------------------------------
// Component entry — branches on screen context
// ---------------------------------------------------------------------------

function GoNoGoComponent({
  config,
}: Readonly<ComponentProps<GoNoGoWidgetConfig>>) {
  const screen = useScreen();
  if (screen === "station") return <StationView />;
  return <MainView config={config} />;
}

// ---------------------------------------------------------------------------
// Station view
// ---------------------------------------------------------------------------

function StationView() {
  const client = usePeerClient();
  const missionTime = useDataValue("data", "v.missionTime");
  const launched = typeof missionTime === "number" && missionTime > 0;
  const [vote, setVote] = useState<"go" | "no-go">("no-go");
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

  // A launched station has effectively "left the poll" — null = not voting
  // rather than stale no-go, which would render a confusing red cell on main.
  const effectiveVote = launched ? null : vote;

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

  // Revert clears local "I aborted" memory — revert means we're back on
  // the pad and the abort button is a fresh slate.
  useEffect(() => {
    if (!launched) iAbortedRef.current = false;
  }, [launched]);

  useEffect(() => {
    if (!client) return;
    const unsub = client.onConnectionStatus((status) => {
      if (status === "connected") {
        client.sendGonogoVote(effectiveVoteRef.current);
        if (iAbortedRef.current) client.sendGonogoAbort();
      }
    });
    return () => {
      unsub();
      client.sendGonogoVote(null);
    };
  }, [client]);

  // Host broadcasts for countdown + abort attribution
  useEffect(() => {
    if (!client) return;
    const unsubs = [
      client.onGonogoCountdownStart((t0Ms) => setCountdown({ t0Ms })),
      client.onGonogoCountdownCancel(() => setCountdown(null)),
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
    if (launched) return;
    setVote((prev) => (prev === "go" ? "no-go" : "go"));
  };

  const handleAbort = () => {
    if (!launched || !client) return;
    iAbortedRef.current = true;
    client.sendGonogoAbort();
  };

  useActionInput<GoNoGoActions>({
    toggleVote: (payload) => {
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

  if (launched) {
    return (
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
    );
  }

  const secondsLeft = countdown
    ? Math.max(0, (countdown.t0Ms - Date.now()) / 1000)
    : null;

  return (
    <BigButton
      $variant={vote === "go" ? "go" : "nogo"}
      onClick={handleVoteToggle}
      role="status"
      aria-live="polite"
    >
      <ButtonLabel>{vote === "go" ? "GO" : "NO-GO"}</ButtonLabel>
      {secondsLeft !== null && (
        <CountdownOverlay role="timer" aria-label="Countdown">
          T − {secondsLeft.toFixed(1)} s
        </CountdownOverlay>
      )}
      {secondsLeft !== null && <CountdownAnnouncer secondsLeft={secondsLeft} />}
    </BigButton>
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

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

function MainView({
  config,
}: Readonly<{ config: GoNoGoWidgetConfig | undefined }>) {
  const host = useGoNoGoHost();
  const snapshot = useGoNoGoSnapshot();
  // Bumped from the countdown ticker below — useReducer so Sonar's
  // "unused tuple element" rule (S6754) doesn't flag this.
  const [, setNow] = useReducer((n: number, _action: unknown) => n + 1, 0);

  // Push the widget's config into the host service. Main-level settings
  // masquerade as per-widget config for user discoverability; if two widgets
  // exist with different configs, whichever renders last wins — fine for v1.
  useEffect(() => {
    if (!host) return;
    host.setConfig({
      countdownLengthMs:
        (config?.countdownSeconds ??
          DEFAULT_GONOGO_CONFIG.countdownLengthMs / 1000) * 1000,
      triggerStageAtZero:
        config?.triggerStageAtZero ?? DEFAULT_GONOGO_CONFIG.triggerStageAtZero,
    });
  }, [host, config?.countdownSeconds, config?.triggerStageAtZero]);

  // Tick during countdown so the T-minus display updates
  useEffect(() => {
    if (!snapshot?.countdown) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [snapshot?.countdown]);

  if (!snapshot) {
    return <Empty>GO/NO-GO host unavailable</Empty>;
  }

  const { stations, countdown, abort, launched, config: hostConfig } = snapshot;
  const secondsLeft = countdown
    ? Math.max(0, (countdown.t0Ms - Date.now()) / 1000)
    : null;

  return (
    <MainLayout>
      <MainHeader>
        <HeaderLabel>{launched ? "MISSION ACTIVE" : "GO / NO-GO"}</HeaderLabel>
        <HeaderRight>
          {hostConfig.triggerStageAtZero && !launched && (
            <WarnChip title="At T-0 the next stage will auto-fire">
              AUTO STAGE AT T-0
            </WarnChip>
          )}
        </HeaderRight>
      </MainHeader>
      {countdown && (
        <>
          <CountdownBanner role="timer" aria-label="Countdown">
            T − {secondsLeft?.toFixed(1)} s
          </CountdownBanner>
          {secondsLeft !== null && (
            <CountdownAnnouncer secondsLeft={secondsLeft} />
          )}
        </>
      )}
      {abort && (
        <AbortBanner role="alert">
          ABORT — triggered by {abort.stationName}
        </AbortBanner>
      )}
      <Grid>
        {stations.length === 0 && <Empty>No stations connected</Empty>}
        {stations.map((s) => {
          const cellState = deriveCellState(s, launched, abort);
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
  abort: { peerId: string; stationName: string; at: number } | null,
): CellState {
  if (launched) {
    if (abort?.peerId === s.peerId) return "abort";
    return "neutral";
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
      return "—";
  }
}

// ---------------------------------------------------------------------------
// Config component (main-screen only)
// ---------------------------------------------------------------------------

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
  const [triggerStage, setTriggerStage] = useState(
    config?.triggerStageAtZero ?? DEFAULT_GONOGO_CONFIG.triggerStageAtZero,
  );

  const handleSave = () => {
    const secs = Number.parseFloat(countdownSeconds);
    onSave({
      countdownSeconds:
        Number.isFinite(secs) && secs > 0
          ? secs
          : DEFAULT_GONOGO_CONFIG.countdownLengthMs / 1000,
      triggerStageAtZero: triggerStage,
    });
  };

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
      <Field>
        <Switch
          checked={triggerStage}
          onChange={setTriggerStage}
          label="Auto-trigger next stage at T-0"
        />
      </Field>
      <PrimaryButton onClick={handleSave}>Save</PrimaryButton>
    </ConfigWrap>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

type BigButtonVariant = "go" | "nogo" | "abort";

// Flat look-up tables keep the styled-template readable and quiet
// SonarQube's nested-ternary warning (S3358). One entry per variant.
const BIG_BUTTON_BORDER: Record<BigButtonVariant, string> = {
  go: "#2a8a3a",
  abort: "#a02020",
  nogo: "#7a2a2a",
};
const BIG_BUTTON_BG: Record<BigButtonVariant, string> = {
  go: "radial-gradient(circle at 50% 35%, #2ab04f 0%, #0a3a18 90%)",
  abort: "radial-gradient(circle at 50% 35%, #e02020 0%, #400808 90%)",
  nogo: "radial-gradient(circle at 50% 35%, #702020 0%, #180404 90%)",
};
const BIG_BUTTON_COLOR: Record<BigButtonVariant, string> = {
  go: "#d0ffd0",
  abort: "#fff0f0",
  nogo: "#ffd0d0",
};

const BigButton = styled.button<{ $variant: BigButtonVariant }>`
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 6px;
  border: 2px solid ${({ $variant }) => BIG_BUTTON_BORDER[$variant]};
  background: ${({ $variant }) => BIG_BUTTON_BG[$variant]};
  color: ${({ $variant }) => BIG_BUTTON_COLOR[$variant]};
  cursor: pointer;
  font-family: monospace;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-shadow: inset 0 0 24px rgba(0, 0, 0, 0.6);
  transition: transform 0.1s ease;

  &:active {
    transform: scale(0.98);
  }
`;

const ButtonLabel = styled.span`
  font-size: clamp(28px, 10vw, 120px);
  line-height: 1;
`;

const CountdownOverlay = styled.span`
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 4px 10px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid #ffae42;
  border-radius: 3px;
  color: #ffae42;
  font-size: 14px;
  letter-spacing: 0.15em;
`;

const AbortNotice = styled.span`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 0.08em;
  text-transform: none;
`;

const MainLayout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
  font-family: monospace;
`;

const MainHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const HeaderLabel = styled.span`
  font-size: 11px;
  letter-spacing: 0.15em;
  color: #888;
  text-transform: uppercase;
`;

const HeaderRight = styled.div`
  display: flex;
  gap: 6px;
`;

const WarnChip = styled.span`
  font-size: 9px;
  letter-spacing: 0.15em;
  padding: 2px 6px;
  border: 1px solid #8a6a28;
  background: rgba(120, 100, 40, 0.25);
  color: #ffd68a;
  border-radius: 2px;
  text-transform: uppercase;
`;

const CountdownBanner = styled.div`
  text-align: center;
  font-size: clamp(24px, 6vw, 56px);
  font-weight: 700;
  color: #ffae42;
  letter-spacing: 0.1em;
`;

const AbortBanner = styled.div`
  text-align: center;
  padding: 6px 10px;
  border: 1px solid #a02020;
  background: rgba(200, 40, 40, 0.2);
  color: #ffb0b0;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const Grid = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  align-content: start;
`;

const Cell = styled.div<{ $state: CellState }>`
  padding: 8px 10px;
  border-radius: 3px;
  border: 1px solid ${({ $state }) => cellBorder($state)};
  background: ${({ $state }) => cellBg($state)};
  color: ${({ $state }) => cellColor($state)};
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

function cellBorder(state: CellState): string {
  switch (state) {
    case "go":
      return "#2a7a3a";
    case "no-go":
    case "abort":
      return "#a02020";
    case "neutral":
      return "#3a5a7a";
    default:
      return "#333";
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
      return "#a8efb0";
    case "no-go":
    case "abort":
      return "#efb0b0";
    case "neutral":
      return "#a8c8ef";
    default:
      return "#888";
  }
}

const CellName = styled.span`
  font-size: 11px;
  letter-spacing: 0.08em;
`;

const CellStatus = styled.span`
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.12em;
`;

const Empty = styled.div`
  color: #555;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-align: center;
  padding: 20px;
`;

const ConfigWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-family: monospace;
`;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerComponent<GoNoGoWidgetConfig>({
  id: "gonogo",
  name: "GO / NO-GO",
  description:
    "Mission readiness poll — button on station screens, grid of lights on main. Morphs into ABORT after launch.",
  tags: ["mission-control"],
  defaultSize: { w: 4, h: 4 },
  component: GoNoGoComponent,
  configComponent: GoNoGoConfigComponent,
  dataRequirements: ["v.missionTime"],
  behaviors: ["gonogo-participant"],
  defaultConfig: {
    countdownSeconds: DEFAULT_GONOGO_CONFIG.countdownLengthMs / 1000,
    triggerStageAtZero: DEFAULT_GONOGO_CONFIG.triggerStageAtZero,
  },
  actions,
});

export { GoNoGoComponent };
