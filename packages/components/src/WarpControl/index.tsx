import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import {
  registerComponent,
  useActionInput,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
import styled from "styled-components";

/**
 * Time-warp control widget. Reads the current warp index/rate from
 * Telemachus and exposes a row of step buttons that fire the
 * `t.timeWarp[N]` actions. Manual warp (via the in-game keys or another
 * surface) is reflected here too — this widget is purely a thin UI over
 * the same telemetry the alarm banner reads.
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

function WarpControlComponent(_: Readonly<ComponentProps<WarpControlConfig>>) {
  const rate = useDataValue<number>("data", "t.currentRate");
  const indexRaw = useDataValue<number>("data", "t.timeWarp");
  const mode = useDataValue<string>("data", "t.warpMode");
  const execute = useExecuteAction("data");

  const currentIndex =
    typeof indexRaw === "number" && Number.isFinite(indexRaw)
      ? Math.round(indexRaw)
      : null;
  const currentRate =
    typeof rate === "number" && Number.isFinite(rate) ? rate : null;

  const setWarp = (idx: number) => {
    void execute(`t.timeWarp[${idx}]`);
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
  });

  return (
    <Panel>
      <PanelTitle>WARP</PanelTitle>
      <PanelSubtitle>
        {formatRate(currentRate)}
        {typeof mode === "string" && mode !== "" ? ` · ${mode}` : ""}
      </PanelSubtitle>
      <ButtonGrid role="group" aria-label="Time warp levels">
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
      </ButtonGrid>
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

const ButtonGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-top: 6px;
  flex: 1;
  align-content: start;
`;

const WarpButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) => ($active ? "var(--color-status-go-bg)" : "var(--color-surface-raised)")};
  color: ${({ $active }) => ($active ? "var(--color-status-go-fg)" : "var(--color-status-go-fg)")};
  border: 1px solid
    ${({ $active }) => ($active ? "var(--color-status-go-bg)" : "var(--color-border-subtle)")};
  border-radius: 3px;
  padding: 8px 4px;
  font-size: 13px;
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
  letter-spacing: 0.04em;
  cursor: pointer;
  &:hover {
    background: ${({ $active }) => ($active ? "var(--color-status-go-bg)" : "var(--color-surface-raised)")};
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

registerComponent<WarpControlConfig>({
  id: "warp-control",
  name: "Warp Control",
  description:
    "Set KSP time warp from the dashboard. Shows current warp rate and mode; button row maps to t.timeWarp[0..7].",
  tags: ["control", "time"],
  defaultSize: { w: 6, h: 5 },
  component: WarpControlComponent,
  dataRequirements: ["t.currentRate", "t.timeWarp", "t.warpMode"],
  defaultConfig: {},
  actions: warpActions,
  pushable: true,
});

export { WarpControlComponent };
