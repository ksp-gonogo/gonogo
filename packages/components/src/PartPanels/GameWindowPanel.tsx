import { useTelemetry } from "@ksp-gonogo/core";
import { useCommand, useViewClockOptional } from "@ksp-gonogo/sitrep-client";
import {
  type AnyBoundCommand,
  type GameWindow,
  type GameWindowNode,
  type PartPanelDefinition,
  type PartPanelFallbackButton,
  type PartPanelProps,
  stillTrue,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  Card,
  Cluster,
  Field,
  FieldLabel,
  IconButton,
  ScrollArea,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  TextField,
  ToggleButton,
  type ToggleButtonTone,
  Tooltip,
} from "@ksp-gonogo/ui-kit";
import {
  type ComponentType,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { opensGameWindow } from "./gameWindowButtons";

const PRESS_COMMAND = "vessel.gameWindow.press";

const GAME_WINDOW_PANEL_PREFIX = "game-window:";

/** Whether a panel is a form read from a window the game opens, which needs the game's button pressed, rather than a console panel that stands in for the button. */
export function isGameWindowPanel(panel: PartPanelDefinition): boolean {
  return panel.id.startsWith(GAME_WINDOW_PANEL_PREFIX);
}

/**
 * How long after the button is pressed the panel waits for a window, in real
 * seconds, before saying none came. The signal delay both ways is added to it,
 * since the window reaches the screen only after the command has gone out and
 * the frame has come back.
 */
const WINDOW_WAIT_SECONDS = 5;

const NO_WINDOW = "The game did not open a window.";

function waitMs(
  clock: { delaySeconds: () => number } | undefined,
  seconds: number,
): number {
  return (seconds + 2 * (clock?.delaySeconds() ?? 0)) * 1000;
}

export const EXPERIMENTAL_TIP =
  "This form is read from the game's own window. It is experimental, so some controls may not work as they do in the game.";

const GREYED_OUT = "Greyed out in the game";

const VALUE_KINDS = new Set(["textfield", "textarea", "slider"]);

function unavailable(node: GameWindowNode): string | null {
  return node.enabled === false ? GREYED_OUT : null;
}

/** A value control's label: the label drawn just before it, as the window lays them out. */
function labelBefore(
  siblings: readonly GameWindowNode[],
  index: number,
): string | undefined {
  const before = siblings[index - 1];
  return before?.kind === "label" ? (before.text ?? undefined) : undefined;
}

/** A label that the control after it takes as its own, and so is not drawn twice. */
function isTakenByNext(siblings: readonly GameWindowNode[], index: number) {
  const node = siblings[index];
  const next = siblings[index + 1];
  return (
    node?.kind === "label" &&
    next !== undefined &&
    next.kind !== "slider" &&
    VALUE_KINDS.has(next.kind)
  );
}

/* Game colours are chosen for the game's panels. Only their sense survives, in the kit's tones. */
const TONE_COLORS: Readonly<Record<string, string>> = {
  go: "var(--color-go-text)",
  nogo: "var(--color-nogo-text)",
  warn: "var(--color-warn-text)",
};

function toneColor(tone: string | null | undefined): string | undefined {
  return tone && Object.hasOwn(TONE_COLORS, tone)
    ? TONE_COLORS[tone]
    : undefined;
}

function buttonTone(
  tone: string | null | undefined,
): ToggleButtonTone | undefined {
  return tone === "go" || tone === "nogo" || tone === "warn" ? tone : undefined;
}

function hexTone(hex: string): string | undefined {
  const value = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (Number.isNaN(value)) return undefined;
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  if (r > g * 1.4 && r > b * 1.4) return g > 128 ? "warn" : "nogo";
  if (g > r * 1.2 && g > b * 1.2) return "go";
  return undefined;
}

const RICH_TAG = /<\/?(b|i|color|size|material|quad)(=[^>]*)?>/g;

/** The rich-text tags a game label uses, drawn as bold, italic and the kit's tones. */
function RichText({ text }: Readonly<{ text: string }>) {
  const parts: ReactNode[] = [];
  let at = 0;
  let bold = false;
  let italic = false;
  const colors: (string | undefined)[] = [];
  const flush = (end: number) => {
    if (end <= at) return;
    parts.push(
      <span
        key={at}
        style={{
          fontWeight: bold ? "bold" : undefined,
          fontStyle: italic ? "italic" : undefined,
          color: toneColor(colors[colors.length - 1]),
        }}
      >
        {text.slice(at, end)}
      </span>,
    );
  };
  for (const match of text.matchAll(RICH_TAG)) {
    const index = match.index ?? 0;
    flush(index);
    at = index + match[0].length;
    const closing = match[0].startsWith("</");
    if (match[1] === "b") bold = !closing;
    if (match[1] === "i") italic = !closing;
    if (match[1] === "color") {
      if (closing) colors.pop();
      else colors.push(hexTone((match[2] ?? "").replace(/^=/, "")));
    }
  }
  flush(text.length);
  return <>{parts}</>;
}

function TextControl({
  windowId,
  node,
  label,
  multiline,
}: Readonly<{
  windowId: string;
  node: GameWindowNode;
  label: string;
  multiline?: boolean;
}>) {
  const press = useCommand(PRESS_COMMAND);
  if (multiline) {
    return (
      <TextBox
        label={label}
        text={node.text ?? ""}
        disabled={node.enabled === false}
        unavailable={unavailable(node)}
        send={(text) => press.with({ windowId, controlId: node.id, text })}
      />
    );
  }
  return (
    <TextField
      label={label}
      value={node.text ?? ""}
      unavailable={unavailable(node)}
      command={press.toArgs((text: string) => ({
        windowId,
        controlId: node.id,
        text,
      }))}
    />
  );
}

function TextBox({
  label,
  text,
  disabled,
  unavailable: why,
  send,
}: Readonly<{
  label: string;
  text: string;
  disabled: boolean;
  unavailable: string | null;
  send: (text: string) => AnyBoundCommand;
}>) {
  const id = useId();
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  return (
    <div style={FIELD_ROW}>
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Textarea
          id={id}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Button size="sm" unavailable={why} command={send(draft)}>
        Set
      </Button>
    </div>
  );
}

function plainFigure(value: number): string {
  return String(Number(value.toPrecision(4)));
}

function NameTip({
  tip,
  children,
}: Readonly<{ tip: string | null | undefined; children: ReactElement }>) {
  return tip ? <Tooltip text={tip}>{children}</Tooltip> : children;
}

/** "UnityWhite" as "Unity White": what names a picture when the game gives it no words. */
function humanized(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
}

/** A control's name: its own text, its tooltip, the label before it, or its picture's name. */
function buttonText(node: GameWindowNode, label?: string): string {
  return (
    node.text || node.tooltip || label || humanized(node.image) || "Control"
  );
}

/** More radios than this in a row are drawn as a wrapping grid, as the game lays out its type icons, so a long list does not stand as a column. */
const RADIO_GRID_MIN = 4;

const RADIO_GRID: CSSProperties = {
  display: "grid",
  gap: "var(--gap-related)",
  gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
};

function radioRunLength(
  siblings: readonly GameWindowNode[],
  start: number,
): number {
  let end = start;
  while (siblings[end]?.kind === "radio") end += 1;
  return end - start;
}

function Control({
  windowId,
  node,
  label,
}: Readonly<{ windowId: string; node: GameWindowNode; label?: string }>) {
  const press = useCommand(PRESS_COMMAND);
  switch (node.kind) {
    case "group":
    case "scroll": {
      const children = node.children ?? [];
      const drawn = (child: GameWindowNode, index: number) => {
        if (isTakenByNext(children, index)) return null;
        const control = (
          <Control
            key={child.id}
            windowId={windowId}
            node={child}
            label={labelBefore(children, index)}
          />
        );
        return node.dir === "h" && VALUE_KINDS.has(child.kind) ? (
          <div key={child.id} style={GROWS}>
            {control}
          </div>
        ) : (
          control
        );
      };
      const body: ReactNode[] = [];
      for (let index = 0; index < children.length; ) {
        const run = radioRunLength(children, index);
        if (run > RADIO_GRID_MIN) {
          body.push(
            <div key={children[index]?.id} style={RADIO_GRID}>
              {children
                .slice(index, index + run)
                .map((c, k) => drawn(c, index + k))}
            </div>,
          );
          index += run;
        } else {
          const child = children[index];
          if (child) body.push(drawn(child, index));
          index += 1;
        }
      }
      if (node.columns != null) {
        return <div style={gridStyle(node.columns)}>{body}</div>;
      }
      if (node.kind === "scroll") {
        return (
          <ScrollArea framed>
            <Stack>{body}</Stack>
          </ScrollArea>
        );
      }
      return node.dir === "h" ? (
        <Cluster>{body}</Cluster>
      ) : (
        <Stack>{body}</Stack>
      );
    }
    case "button":
      if (!node.text && node.image) {
        return (
          <Cluster>
            <IconButton
              aria-label={buttonText(node, label)}
              unavailable={unavailable(node)}
              command={press.with({ windowId, controlId: node.id })}
            >
              <PictureGlyph />
            </IconButton>
          </Cluster>
        );
      }
      return (
        <NameTip tip={node.tooltip}>
          <Button
            size="sm"
            variant={node.tone ? "primary" : "default"}
            tone={buttonTone(node.tone)}
            unavailable={unavailable(node)}
            command={press.with({ windowId, controlId: node.id })}
          >
            {node.text || node.tooltip}
          </Button>
        </NameTip>
      );
    case "toggle":
      if (node.variant === "button") {
        return (
          <ToggleButton
            size="sm"
            name={buttonText(node, label)}
            state={node.bool ?? null}
            tone={buttonTone(node.tone)}
            unavailable={unavailable(node)}
            command={press.toArgs((bool: boolean) => ({
              windowId,
              controlId: node.id,
              bool,
            }))}
          >
            {buttonText(node, label)}
          </ToggleButton>
        );
      }
      return (
        <Switch
          label={buttonText(node, label)}
          state={node.bool ?? null}
          unavailable={unavailable(node)}
          command={press.toArgs((bool: boolean) => ({
            windowId,
            controlId: node.id,
            bool,
          }))}
        />
      );
    case "radio":
      return (
        <ToggleButton
          size="sm"
          name={buttonText(node, label)}
          state={node.bool ?? null}
          unavailable={unavailable(node)}
          command={press.toArgs((on: boolean) =>
            on ? { windowId, controlId: node.id, bool: true } : undefined,
          )}
        >
          {buttonText(node, label)}
        </ToggleButton>
      );
    case "textfield":
      return (
        <TextControl windowId={windowId} node={node} label={label ?? "Text"} />
      );
    case "textarea":
      return (
        <TextControl
          windowId={windowId}
          node={node}
          label={label ?? "Text"}
          multiline
        />
      );
    case "slider": {
      const min = node.min ?? 0;
      const max = node.max ?? 1;
      const whole =
        Number.isInteger(min) && Number.isInteger(max) && max - min > 1;
      return (
        <Slider
          aria-label={label ?? "Value"}
          min={min}
          max={max}
          step={whole ? 1 : (max - min) / 100}
          value={node.num ?? null}
          figure={plainFigure}
          unavailable={unavailable(node)}
          command={press.toArgs((num: number) => ({
            windowId,
            controlId: node.id,
            num,
          }))}
        />
      );
    }
    case "grid":
      return (
        <div style={gridStyle(node.columns ?? (node.options ?? []).length)}>
          {(node.options ?? []).map((option, index) => (
            <ToggleButton
              key={option}
              size="sm"
              name={option || "Control"}
              state={node.num === index}
              unavailable={unavailable(node)}
              command={press.toArgs((on: boolean) =>
                on ? { windowId, controlId: node.id, num: index } : undefined,
              )}
            >
              {option || "Control"}
            </ToggleButton>
          ))}
        </div>
      );
    case "box":
      return (
        <Card>
          <Text>{node.text ? <RichText text={node.text} /> : null}</Text>
        </Card>
      );
    default:
      if (!node.text) return null;
      return (
        <NameTip tip={node.tooltip}>
          <Text style={{ color: toneColor(node.tone) }}>
            <RichText text={node.text} />
          </Text>
        </NameTip>
      );
  }
}

/** Stands in for the picture a game button shows, which is not carried to the console. */
function PictureGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2 3h12v10H2V3Zm1 1v6.5l3-3 2.5 2.5L11 7.5l2 2V4H3Zm3 2.5A1 1 0 1 1 6 4.5a1 1 0 0 1 0 2Z"
      />
    </svg>
  );
}

const GROWS: CSSProperties = { flex: 1, minWidth: 0 };

const FIELD_ROW: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "end",
  gap: "var(--gap-related)",
};

function gridStyle(columns: number): CSSProperties {
  return {
    display: "grid",
    gap: "var(--gap-section)",
    gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
  };
}

function opener(
  candidate: GameWindow,
  partId: string,
  button: PartPanelFallbackButton,
) {
  return (
    candidate.openedBy.partId === partId &&
    candidate.openedBy.event === button.event &&
    (candidate.openedBy.module ?? null) === button.module
  );
}

function GameWindowForm({
  partId,
  close,
  button,
}: Readonly<PartPanelProps & { button: PartPanelFallbackButton }>) {
  const reading = useTelemetry("vessel.gameWindows");
  const windows = stillTrue(reading, undefined);
  const gameWindow = windows?.windows.find((w) => opener(w, partId, button));
  const seen = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const viewClock = useViewClockOptional();
  const viewClockRef = useRef(viewClock);
  viewClockRef.current = viewClock;

  /* The part menu sent the button's press as it opened this panel, so the wait for a window starts here. */
  useEffect(() => {
    const timer = setTimeout(
      () => {
        if (!seen.current) setProblem(NO_WINDOW);
      },
      waitMs(viewClockRef.current, WINDOW_WAIT_SECONDS),
    );
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (gameWindow) {
      seen.current = true;
      return;
    }
    if (seen.current) close();
  }, [gameWindow, close]);

  if (gameWindow)
    return <Control windowId={gameWindow.id} node={gameWindow.root} />;
  return <Text>{problem ?? "Opening the game window..."}</Text>;
}

function ExperimentalMark() {
  return (
    <Tooltip text={EXPERIMENTAL_TIP} focusable>
      <span
        role="img"
        aria-label="Experimental"
        style={{ color: "var(--color-warn-text)", cursor: "help" }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 1 15.5 14.5H.5L8 1Zm-1 5v4.5h2V6H7Zm0 5.5v2h2v-2H7Z"
          />
        </svg>
      </span>
    </Tooltip>
  );
}

/* One definition per button, so a menu redraw hands the modal the same component and does not remount it. */
const PANELS = new Map<string, PartPanelDefinition>();

function panelFor(button: PartPanelFallbackButton): PartPanelDefinition {
  const key = `${button.module ?? ""}\0${button.event}`;
  const existing = PANELS.get(key);
  if (existing) return existing;
  const component: ComponentType<PartPanelProps> = (props) => (
    <GameWindowForm {...props} button={button} />
  );
  const panel: PartPanelDefinition = {
    id: `${GAME_WINDOW_PANEL_PREFIX}${button.module ?? ""}:${button.event}`,
    title: button.label,
    component,
    width: "520px",
    titleAdornment: <ExperimentalMark />,
  };
  PANELS.set(key, panel);
  return panel;
}

/**
 * Offers a console version of any part menu button known to open a game
 * window, as a form read from that window. Passed to
 * `registerPartPanelFallback`, so a panel that names the button in `replaces`
 * takes it instead.
 */
export function gameWindowFallback(
  button: PartPanelFallbackButton,
): PartPanelDefinition | undefined {
  return opensGameWindow(button.module, button.event)
    ? panelFor(button)
    : undefined;
}
