import { useLatestValue, useUtNow } from "@ksp-gonogo/sitrep-client";
import {
  type AnyBoundCommand,
  type PartPanelDefinition,
  type PendingEntry,
  type SetPartFieldArgs,
  type UseCommandResult,
  type ValueCommandQueueLike,
  value,
  valueCommandState,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  Cluster,
  DataLine,
  Disclosure,
  LiveRegion,
  NullValue,
  ScrollArea,
  Slider,
  Stack,
  Stepper,
  Switch,
  Text,
  Unit,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { type CSSProperties, useEffect, useRef } from "react";
import { isGameWindowPanel } from "../PartPanels/GameWindowPanel";
import {
  GAME_GREYS_THIS,
  NEEDS_THE_GAME_SCREEN,
  OPENS_ON_GAME_SCREEN,
  sendsPress,
  type TransferResourceOption,
  withPanelMark,
} from "./PartActionMenu";
import { usePartPanelRoutes } from "./partPanels";
import type { VesselSchematicPartActionEntry } from "./shipTopology";
import {
  type PartWindowRow,
  partActionsTopic,
  usePartActions,
} from "./usePartActions";

/** The mod command that sets one field of a part's window. Must match `PartActionCommandProvider.SetPartFieldCommand`, which `partActions.cs-sync.test.ts` reads out of the C# source. */
export const SET_PART_FIELD_COMMAND = "vessel.setPartField";

/** The window is older than this many seconds before it says so. */
const SHOWS_AGE_AFTER_SECONDS = 0.5;

/** What the window says in place of its rows once the part's rows have all gone: the part has separated from the vessel. */
const LEFT_THE_VESSEL = "This part has left the vessel.";

/** The handle `vessel.setPartField` is sent on. The widget owns it so a row's sent word outlives the window. */
export type FieldCommandHandle = UseCommandResult<SetPartFieldArgs>;

const NO_CONTRIBUTED: readonly VesselSchematicPartActionEntry[] = [];
const NO_RESOURCES: readonly TransferResourceOption[] = [];

export interface PartWindowProps {
  flightId: number;
  partTitle: string;
  /** The command one button sends. */
  commandFor: (
    eventName: string,
    actionLabel: string,
    moduleIndex?: number | null,
  ) => AnyBoundCommand;
  /** The handle `vessel.setPartField` is sent on, owned by the widget. */
  setFieldHandle: FieldCommandHandle;
  onDismiss: () => void;
  contributed?: readonly VesselSchematicPartActionEntry[];
  contributedCommandFor?: (
    entry: VesselSchematicPartActionEntry,
  ) => AnyBoundCommand | null;
  transferResources?: readonly TransferResourceOption[];
  onPickTransfer?: (resource: string) => void;
  onOpenPanel?: (panel: PartPanelDefinition) => void;
  style?: CSSProperties;
}

/**
 * A part's right-click window: the part's title, how old its state is, then
 * the rows the game draws in its own window as ui-kit controls, a switch, a
 * slider, an option list or a button each. A control sends its change through
 * `vessel.setPartField` or `vessel.invokePartAction` and shows what became of
 * it. Every figure is the part's delayed state; a control the operator moved
 * keeps their value until the report agrees.
 */
export function PartWindow({
  flightId,
  partTitle,
  commandFor,
  setFieldHandle,
  onDismiss,
  contributed = NO_CONTRIBUTED,
  contributedCommandFor,
  transferResources = NO_RESOURCES,
  onPickTransfer,
  onOpenPanel,
  style,
}: Readonly<PartWindowProps>) {
  const { actions, gameWindows, rows, pending } = usePartActions(flightId);
  const routes = usePartPanelRoutes();
  // The state on screen is one one-way delay old, the same delay a command takes to reach the part.
  const age = setFieldHandle.effectiveDelaySeconds;
  const rootRef = useRef<HTMLDivElement | null>(null);
  // A window that has had rows and has none now is of a part that has separated from the vessel.
  const hadRows = useRef(false);
  if (rows.length > 0) hadRows.current = true;
  const left = hadRows.current && rows.length === 0;
  // Escape and a press outside close the window, as they close the menu it stands in for.
  useEffect(() => {
    rootRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onDismiss]);
  const panelOfAction = (action: {
    moduleName?: string | null;
    name: string;
    label: string;
  }) =>
    onOpenPanel
      ? routes.forGameButton(
          action.moduleName,
          action.name,
          action.label || action.name,
        )
      : undefined;

  const shown = rows.filter((row) => !row.advanced);
  const advancedRows = rows.filter((row) => row.advanced);
  const isAdvancedButton = (b: PartActionRow) =>
    b.active && b.advancedTweakable;
  const advancedActions = (actions ?? []).filter(isAdvancedButton);
  const advancedGameWindows = gameWindows.filter(isAdvancedButton);
  const groups = new Map<string, PartWindowRow[]>();
  const loose: PartWindowRow[] = [];
  for (const row of shown) {
    const group = row.group;
    if (!group) {
      loose.push(row);
      continue;
    }
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }

  const renderAction = (action: PartActionRow) => {
    const panel = panelOfAction(action);
    const label = action.label || action.name;
    return (
      <div
        key={`${action.moduleName ?? ""}:${action.moduleIndex ?? ""}:${action.name}`}
        // A game button that also has a panel opens it as the press is sent, the way choosing it in the menu did.
        onClickCapture={
          panel
            ? () => {
                onOpenPanel?.(panel);
                onDismiss();
              }
            : undefined
        }
      >
        <Button
          command={
            sendsPress(panel)
              ? commandFor(action.name, label, action.moduleIndex)
              : undefined
          }
          tip={action.opensGameWindow ? OPENS_ON_GAME_SCREEN : undefined}
          aria-label={`${label} on ${partTitle}`}
        >
          {withPanelMark(label, panel !== undefined)}
        </Button>
      </div>
    );
  };

  const renderGameWindow = (action: PartActionRow) => (
    <Button
      key={`game-window:${action.moduleName ?? ""}:${action.moduleIndex ?? ""}:${action.name}`}
      disabled
      disabledReason={NEEDS_THE_GAME_SCREEN}
      aria-label={`${action.label || action.name} on ${partTitle}, ${NEEDS_THE_GAME_SCREEN}`}
    >
      {action.label || action.name}
    </Button>
  );

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      // The diagram pans on a press and zooms on the wheel, so a drag on a slider here would move the craft instead.
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onDismiss();
        }
      }}
      style={{ ...WINDOW, ...style }}
      aria-label={`${partTitle} window`}
    >
      <div style={TITLE_BAND}>
        <Cluster justify="between" align="center">
          <Text weight="semibold">{partTitle}</Text>
          {age !== null && age >= SHOWS_AGE_AFTER_SECONDS ? (
            <Text size="sm" level="faint" style={{ whiteSpace: "nowrap" }}>
              State as of{" "}
              <Unit value={value("s", Math.round(age))} decimals={0} /> ago
            </Text>
          ) : null}
        </Cluster>
      </div>
      <ScrollArea style={SCROLL_BOX}>
        <div style={ROWS_INSET}>
          <Stack gap="section">
            <LiveRegion>
              {left ? <Text size="sm">{LEFT_THE_VESSEL}</Text> : null}
            </LiveRegion>
            {left ? null : (
              <>
                {pending &&
                rows.length === 0 &&
                (actions?.length ?? 0) === 0 ? (
                  <Text size="sm" level="faint">
                    Awaiting actions...
                  </Text>
                ) : null}
                {loose.map((row) => (
                  <WindowRow
                    key={`${row.module}:${row.name}:${row.label}`}
                    row={row}
                    flightId={flightId}
                    partTitle={partTitle}
                    handle={setFieldHandle}
                    age={age}
                  />
                ))}
                {[...groups.entries()].map(([group, groupRows]) => (
                  <Disclosure key={group} label={group} variant="inline">
                    <Stack gap="section">
                      {groupRows.map((row) => (
                        <WindowRow
                          key={`${row.module}:${row.name}:${row.label}`}
                          row={row}
                          flightId={flightId}
                          partTitle={partTitle}
                          handle={setFieldHandle}
                          age={age}
                        />
                      ))}
                    </Stack>
                  </Disclosure>
                ))}
                {advancedRows.length +
                  advancedActions.length +
                  advancedGameWindows.length >
                0 ? (
                  <Disclosure label="Advanced" variant="inline">
                    <Stack gap="section">
                      {advancedRows.map((row) => (
                        <WindowRow
                          key={`${row.module}:${row.name}:${row.label}`}
                          row={row}
                          flightId={flightId}
                          partTitle={partTitle}
                          handle={setFieldHandle}
                          age={age}
                        />
                      ))}
                      <Stack gap="related">
                        {advancedActions.map(renderAction)}
                        {advancedGameWindows.map(renderGameWindow)}
                      </Stack>
                    </Stack>
                  </Disclosure>
                ) : null}
                <Stack gap="related">
                  {shownButtons(actions ?? []).map(renderAction)}
                  {shownButtons(gameWindows).map(renderGameWindow)}
                  {contributed.map((entry) => (
                    <Button
                      key={`contributed:${entry.name}`}
                      command={contributedCommandFor?.(entry) ?? undefined}
                      advise={entry.active ? undefined : GAME_GREYS_THIS}
                      aria-label={`${entry.label} on ${partTitle}`}
                    >
                      {entry.label}
                    </Button>
                  ))}
                  {transferResources.map(({ resource, label }) => (
                    <Button
                      key={`transfer:${resource}`}
                      onClick={() => {
                        onPickTransfer?.(resource);
                        onDismiss();
                      }}
                      aria-label={`Transfer ${label} from or to ${partTitle}`}
                    >
                      {`${label}...`}
                    </Button>
                  ))}
                </Stack>
              </>
            )}
          </Stack>
        </div>
      </ScrollArea>
    </section>
  );
}

type PartActionRow = NonNullable<
  ReturnType<typeof usePartActions>["actions"]
>[number];

/**
 * The buttons the game's own window draws with advanced tweakables off: the
 * active ones that are not advanced. The mod lists the rest with their flags;
 * the active advanced ones go under the window's closed "Advanced" group.
 */
function shownButtons<
  T extends { active: boolean; advancedTweakable: boolean },
>(buttons: readonly T[]): T[] {
  return buttons.filter((b) => b.active && !b.advancedTweakable);
}

/**
 * The word the game prints for a switch's state ("Free", "Locked"), shown beside the switch so the row reads as the game's does. A bare True or False says no more than the switch and is left out.
 */
function toggleStateWord(text: string): string | null {
  const word = text.trim();
  return word === "" || /^(true|false|on|off)$/i.test(word) ? null : word;
}

function WindowRow({
  row,
  flightId,
  partTitle,
  handle,
  age,
}: Readonly<{
  row: PartWindowRow;
  flightId: number;
  partTitle: string;
  handle: FieldCommandHandle;
  age: number | null;
}>) {
  const label = `${row.label} on ${partTitle}`;
  const stateWord = toggleStateWord(row.text);
  const command = (toValue: (v: number) => number) =>
    handle.toArgs(
      (v: number) => ({
        partId: String(flightId),
        module: row.module,
        field: row.name,
        value: toValue(v),
      }),
      { label, topic: partActionsTopic(flightId) },
    );
  const queue = useLatestValue<ValueCommandQueueLike>("system.uplink.pending");
  const nowUt = useUtNow();
  const oneWay = handle.effectiveDelaySeconds;
  const commandState = valueCommandState(
    SET_PART_FIELD_COMMAND,
    {
      received: row.number ?? null,
      matches: (entry: PendingEntry) => entry.label === label,
    },
    queue,
    oneWay === null ? null : value("s", oneWay),
    value("ut", nowUt ?? 0),
  );
  const commanded = commandState.commanded ?? row.number ?? null;
  const held =
    row.number !== null && row.number !== undefined && commanded !== row.number
      ? row.number
      : null;

  switch (row.kind) {
    case "slider":
      return (
        <Stack gap="related">
          <Text size="sm">{row.label}</Text>
          <Slider
            aria-label={row.label}
            value={commanded}
            min={row.min ?? 0}
            max={row.max ?? 100}
            step={row.step ?? 1}
            figure={(v) => formatLike(row.text, v)}
            lastSeen={held}
            lastSeenCaption={
              age !== null && age >= SHOWS_AGE_AFTER_SECONDS
                ? `reported ${writeQuantity(value("s", Math.round(age)), { decimals: 0 })} ago`
                : undefined
            }
            command={row.editable ? command((v) => v) : undefined}
            unavailable={
              row.editable
                ? undefined
                : "the game does not offer this in flight"
            }
          />
        </Stack>
      );
    case "toggle":
      return (
        <Cluster justify="between" align="center">
          <Text size="sm">{row.label}</Text>
          <Cluster align="center">
            {stateWord ? (
              <Text size="sm" level="muted">
                {stateWord}
              </Text>
            ) : null}
            {row.editable ? (
              <Switch
                aria-label={
                  stateWord ? `${row.label}: ${stateWord}` : row.label
                }
                state={
                  row.number === null || row.number === undefined
                    ? null
                    : row.number >= 0.5
                }
                command={handle.toArgs(
                  (on: boolean) => ({
                    partId: String(flightId),
                    module: row.module,
                    field: row.name,
                    value: on ? 1 : 0,
                  }),
                  { label, topic: partActionsTopic(flightId) },
                )}
              />
            ) : (
              <Switch
                aria-label={
                  stateWord ? `${row.label}: ${stateWord}` : row.label
                }
                checked={(row.number ?? 0) >= 0.5}
                disabled
                onChange={() => {}}
              />
            )}
          </Cluster>
        </Cluster>
      );
    case "option":
    case "cycle": {
      const names = row.options ?? [];
      const stepperProps = {
        label: row.label,
        options: names.map((_, i) => i),
        format: (i: number) => names[i] ?? String(i),
      };
      return (
        <Stack gap="related">
          <Text size="sm">{row.label}</Text>
          {row.editable ? (
            <Stepper
              {...stepperProps}
              value={commanded === null ? null : Math.round(commanded)}
              command={command((v) => v)}
            />
          ) : (
            <Stepper
              {...stepperProps}
              value={
                row.number === null || row.number === undefined
                  ? null
                  : Math.round(row.number)
              }
              disabled
              onChange={() => {}}
            />
          )}
        </Stack>
      );
    }
    case "resource":
      return (
        <DataLine label={row.label}>
          <Unit value={value("units", row.number ?? 0)} decimals={1} />
          {" / "}
          <Unit value={value("units", row.max ?? 0)} decimals={1} />
        </DataLine>
      );
    default:
      // A label the owning mod has not filled (some fill theirs only while the game's own window is open) has no reading, and is drawn as none rather than as an empty value.
      return (
        <DataLine label={row.label}>
          {row.text === "" ? <NullValue /> : row.text}
        </DataLine>
      );
  }
}

/** A figure drawn the way the game printed the current one: its text with the number swapped for the new value. */
function formatLike(text: string, v: number): string {
  const unit = text.replace(/^[-+]?[0-9.,]+\s*/, "");
  const digits = /\.([0-9]+)/.exec(text)?.[1]?.length ?? 0;
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ""}`.trim();
}

/* The window is held to 70vh. The rows scroll in a box that runs to the window's own edges, so the scroll glow spans the full width and meets the border; the padding sits inside the scrolled content. The title above is outside the scroll, on a darker band. */
const ROWS_MAX_HEIGHT = "calc(70vh - 3rem)";

const TITLE_BAND: CSSProperties = {
  background: "var(--color-surface-sunken)",
  borderBottom: "1px solid var(--color-border-subtle)",
  padding: "var(--inset-surface)",
};

const SCROLL_BOX: CSSProperties = {
  flex: "0 1 auto",
  maxHeight: ROWS_MAX_HEIGHT,
  // The scroll area bleeds out by this much and pads its content by it; the window has no padding of its own, so there is nothing to bleed past.
  ["--bleed-inline" as string]: "0px",
};

const ROWS_INSET: CSSProperties = {
  padding: "var(--inset-surface)",
};

const WINDOW: CSSProperties = {
  background: "var(--color-surface-raised)",
  color: "var(--color-text-primary)",
  fontSize: "var(--font-size-compact)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-regular)",
  minWidth: "260px",
  maxWidth: "340px",
  maxHeight: "70vh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  // The scroll glow fades to the panel colour, and this window is drawn on the raised surface.
  ["--color-surface-panel" as string]: "var(--color-surface-raised)",
};
