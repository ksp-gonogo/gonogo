import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import {
  registerComponent,
  useActionInput,
  useDataValue,
  useExecuteAction,
  useGameContext,
} from "@gonogo/core";
import { useEffect, useState } from "react";
import {
  DimmedOverlay,
  Panel,
  PanelTitle,
  PauseIcon,
  PlayIcon,
  ReadoutCaption,
  ToggleButton,
} from "@gonogo/ui";
import styled from "styled-components";

/**
 * Time-warp control widget. Reads the current warp index/rate from
 * Telemachus and exposes a row of step buttons that fire the
 * `t.timeWarp[N]` actions. Manual warp (via the in-game keys or another
 * surface) is reflected here too — this widget is purely a thin UI over
 * the same telemetry the alarm banner reads.
 *
 * Layout is flex-flow + selective rendering rather than discrete bucket
 * branches: rate readout and button block sit side-by-side when there's
 * horizontal room, stack when narrow, and the full 8-button ladder yields
 * to a 3-button stepper when there's no longer room for both. The grid
 * inside the ladder uses `auto-fit` so 8 buttons reflow naturally between
 * 8×1 / 4×2 / 2×4 / 1×8 depending on body shape.
 */

type WarpControlConfig = Record<string, never>;

const warpActions = [
  {
    id: "stepUp",
    label: "Warp up",
    accepts: ["button"],
    description: "Step warp up one level.",
  },
  {
    id: "stepDown",
    label: "Warp down",
    accepts: ["button"],
    description: "Step warp down one level.",
  },
  {
    id: "stop",
    label: "Drop to 1×",
    accepts: ["button"],
    description: "Drop warp straight to realtime.",
  },
  {
    id: "togglePause",
    label: "Toggle pause",
    accepts: ["button"],
    description: "Pause / unpause KSP (in-flight only).",
  },
] as const satisfies readonly ActionDefinition[];

export type WarpControlActions = typeof warpActions;

/**
 * KSP HIGH-warp ladder. The numeric labels match the in-game tooltip and
 * the indices are what `t.timeWarp[N]` accepts. Physics warp (LOW) uses
 * a different ladder; for v1 we surface only HIGH because mission-screen
 * use of warp is overwhelmingly out-of-atmosphere.
 */
const HIGH_LEVELS: ReadonlyArray<{ index: number; label: string }> = [
  { index: 0, label: "1×" },
  { index: 1, label: "5×" },
  { index: 2, label: "10×" },
  { index: 3, label: "50×" },
  { index: 4, label: "100×" },
  { index: 5, label: "1k×" },
  { index: 6, label: "10k×" },
  { index: 7, label: "100k×" },
];

function WarpControlComponent({
  w,
  h,
}: Readonly<ComponentProps<WarpControlConfig>>) {
  const rate = useDataValue<number>("data", "t.currentRate");
  const indexRaw = useDataValue<number>("data", "t.timeWarp");
  const mode = useDataValue<string>("data", "t.warpMode");
  const isPaused = useDataValue<boolean>("data", "t.isPaused");
  const execute = useExecuteAction("data");

  // Optimistic pause state: tracks the operator's *intent* between click
  // and the WS roundtrip that confirms `t.isPaused` flipped. Without this,
  // a click before the ~250ms WS push lands sees stale `isPaused` and
  // fires the wrong action key — explicitly observed as the "pause works,
  // unpause doesn't" symptom on 2026-05-15. Cleared by the reconcile effect
  // below once truth catches up.
  const [pauseIntent, setPauseIntent] = useState<boolean | null>(null);
  const effectivePaused = pauseIntent ?? isPaused;
  useEffect(() => {
    if (pauseIntent === null) return;
    if (isPaused === pauseIntent) setPauseIntent(null);
  }, [pauseIntent, isPaused]);

  // Time warp works in Flight / SpaceCenter / TrackingStation but not
  // Editor / MainMenu. Dim the body when KSP is in a no-warp scene so
  // the operator doesn't click into a no-op. Wider gate than the
  // shared `flight` requirement, so we apply it inline rather than via
  // RequiresGuard.
  const { scene, hasGameSignal } = useGameContext();
  const warpableScene =
    scene === "Flight" ||
    scene === "SpaceCenter" ||
    scene === "TrackingStation";
  const dimBody = hasGameSignal && !warpableScene;

  const currentIndex =
    typeof indexRaw === "number" && Number.isFinite(indexRaw)
      ? Math.round(indexRaw)
      : null;
  const currentRate =
    typeof rate === "number" && Number.isFinite(rate) ? rate : null;

  const setWarp = (idx: number) => {
    void execute(`t.timeWarp[${idx}]`);
  };
  // The fork ships separate `t.pause` / `t.unpause` action keys — there's
  // no toggle. Fire the inverse of the operator's last intent (or the
  // current truth if no intent is in-flight). Optimistic so back-to-back
  // clicks before the WS push catches up still pick the right action.
  const togglePause = () => {
    const next = !effectivePaused;
    setPauseIntent(next);
    void execute(next ? "t.pause" : "t.unpause");
  };

  useActionInput<WarpControlActions>({
    stepUp: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = Math.min(HIGH_LEVELS.length - 1, (currentIndex ?? 0) + 1);
      setWarp(next);
      return { Warp: HIGH_LEVELS[next]?.label ?? `${next}` };
    },
    stepDown: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = Math.max(0, (currentIndex ?? 0) - 1);
      setWarp(next);
      return { Warp: HIGH_LEVELS[next]?.label ?? `${next}` };
    },
    stop: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      setWarp(0);
      return { Warp: "1×" };
    },
    togglePause: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      togglePause();
      return { Paused: !effectivePaused };
    },
  });

  // Content-priority decisions, not layout decisions — CSS handles the
  // arrangement once we've decided what's in the body.
  // Full ladder needs enough area for 8 buttons to wrap legibly. We only
  // require the area; auto-fit handles whether it ends up 8×1, 4×2, 2×4…
  const cols = w ?? 6;
  const rows = h ?? 5;
  const showFullLadder = cols * rows >= 20 && cols >= 4 && rows >= 3;
  const showStepper = !showFullLadder && cols >= 3 && rows >= 3;
  const showModeCaption = rows >= 4;

  const rateLabel = formatRate(currentRate);
  const idx = currentIndex ?? 0;
  const downIdx = Math.max(0, idx - 1);
  const upIdx = Math.min(HIGH_LEVELS.length - 1, idx + 1);

  return (
    <Panel>
      <PanelTitle>WARP</PanelTitle>
      <DimmedOverlay
        show={dimBody}
        message="No active save"
        hint="Time warp works in flight, Space Center, and Tracking Station."
      >
        <Body>
          <Rate $tone="go">
            <RateValue aria-label={`Time warp rate ${rateLabel}`}>
              {rateLabel}
            </RateValue>
            {showModeCaption && typeof mode === "string" && mode !== "" && (
              <ReadoutCaption>{mode}</ReadoutCaption>
            )}
          </Rate>

          {scene === "Flight" && (
            <ToggleButton
              active={effectivePaused === true}
              tone="warn"
              size="sm"
              onClick={togglePause}
              aria-label={
                effectivePaused === true ? "Resume game" : "Pause game"
              }
              title={
                effectivePaused === true
                  ? "Resume (t.unpause)"
                  : "Pause (t.pause)"
              }
            >
              {effectivePaused === true ? (
                <PlayIcon size={12} />
              ) : (
                <PauseIcon size={12} />
              )}
            </ToggleButton>
          )}

          {showFullLadder && (
            <FullLadder role="group" aria-label="Time warp levels">
              {HIGH_LEVELS.map((lvl) => {
                const active = currentIndex === lvl.index;
                return (
                  <WarpButton
                    key={lvl.index}
                    type="button"
                    $active={active}
                    aria-pressed={active}
                    onClick={() => setWarp(lvl.index)}
                  >
                    {lvl.label}
                  </WarpButton>
                );
              })}
            </FullLadder>
          )}

          {showStepper && (
            <Stepper role="group" aria-label="Time warp controls">
              <WarpButton
                type="button"
                $active={false}
                disabled={idx === 0}
                onClick={() => setWarp(downIdx)}
                aria-label="Warp down"
              >
                −
              </WarpButton>
              <WarpButton
                type="button"
                $active={idx === 0}
                aria-pressed={idx === 0}
                onClick={() => setWarp(0)}
                aria-label="Drop to realtime"
              >
                1×
              </WarpButton>
              <WarpButton
                type="button"
                $active={false}
                disabled={idx === HIGH_LEVELS.length - 1}
                onClick={() => setWarp(upIdx)}
                aria-label="Warp up"
              >
                +
              </WarpButton>
            </Stepper>
          )}
        </Body>
      </DimmedOverlay>
    </Panel>
  );
}

function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  if (rate < 1.0001) return "1×";
  if (rate >= 1000) return `${(rate / 1000).toFixed(rate >= 10_000 ? 0 : 1)}k×`;
  if (Number.isInteger(rate)) return `${rate}×`;
  return `${rate.toFixed(2)}×`;
}

const Body = styled.div`
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  align-content: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
`;

const Rate = styled.div<{ $tone: "go" }>`
  flex: 1 1 70px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  color: var(--color-status-go-fg);
`;

const RateValue = styled.span`
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1;
`;

const FullLadder = styled.div`
  flex: 2 1 140px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(40px, 1fr));
  gap: 4px;
  align-content: center;
`;

const Stepper = styled.div`
  flex: 1 1 100px;
  display: grid;
  grid-template-columns: repeat(3, minmax(28px, 1fr));
  gap: 4px;
  align-content: center;
`;

const WarpButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) =>
    $active ? "var(--color-status-go-bg)" : "var(--color-surface-raised)"};
  color: var(--color-status-go-fg);
  border: 1px solid
    ${({ $active }) =>
      $active ? "var(--color-status-go-bg)" : "var(--color-border-subtle)"};
  border-radius: 3px;
  padding: 6px 4px;
  font-size: 13px;
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
  letter-spacing: 0.04em;
  cursor: pointer;
  min-width: 0;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

registerComponent<WarpControlConfig>({
  id: "warp-control",
  name: "Warp Control",
  description:
    "Set KSP time warp from the dashboard. Shows current warp rate and mode; button row maps to t.timeWarp[0..7].",
  tags: ["control", "time"],
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 4, h: 4 },
  component: WarpControlComponent,
  dataRequirements: ["t.currentRate", "t.timeWarp", "t.warpMode", "t.isPaused"],
  defaultConfig: {},
  actions: warpActions,
  pushable: true,
});

export { WarpControlComponent };
