import { railTagsForCommand, value } from "@ksp-gonogo/sitrep-sdk";
import type {
  AugmentSlot,
  CommandButton,
  CommandButtonHandle,
  CommandGroup,
  Countdown,
  Dial,
  DivergingBar,
  Gauge,
  LineGraph,
  MissionDate,
  ReadOnlyField,
  ReckonedUnit,
  Stepper,
  Tape,
  UnitInput,
  WidgetScopeProvider,
} from "@ksp-gonogo/ui-kit";
import type { ComponentProps } from "react";
import { absent, held, live, pending } from "./readings";

/** One named arg set for a primitive whose required props need a real value. */
export interface Preset<Props> {
  name: string;
  args: Props;
}

type Presets<Props> = Preset<Props>[];

/** A handle whose send never settles: the button at rest, dispatching nothing. */
const IDLE_HANDLE: CommandButtonHandle = {
  send: () => new Promise<never>(() => {}),
  inFlight: [],
  tags: railTagsForCommand("vessel.control.stage"),
  effectiveDelaySeconds: 0,
};

const RANGE = { min: value("1", 0), max: value("1", 3) };

/**
 * The minimal state set for each instrument the generator cannot give a
 * default to: live, held, pending, and a band where the instrument draws one.
 * Enough to see the primitive; the states it deserves are still to be designed.
 */
export const UI_KIT_PRESETS = {
  Gauge: [
    {
      name: "Live",
      args: { value: live("1", 1.42), ...RANGE, width: 140, height: 80 },
    },
    {
      name: "Held",
      args: { value: held("1", 1.42), ...RANGE, width: 140, height: 80 },
    },
    {
      name: "Pending",
      args: { value: pending(), ...RANGE, width: 140, height: 80 },
    },
    {
      name: "Band",
      args: {
        value: live("1", 1.42, { lo: 1.3, hi: 1.55, kind: "sigma1" }),
        ...RANGE,
        width: 140,
        height: 80,
      },
    },
  ] satisfies Presets<ComponentProps<typeof Gauge>>,
  Dial: [
    {
      name: "Live",
      args: {
        value: live("deg", 92),
        min: value("deg", 0),
        max: value("deg", 360),
      },
    },
    {
      name: "Held",
      args: {
        value: held("deg", 92),
        min: value("deg", 0),
        max: value("deg", 360),
      },
    },
    {
      name: "Pending",
      args: { value: pending(), min: value("deg", 0), max: value("deg", 360) },
    },
  ] satisfies Presets<ComponentProps<typeof Dial>>,
  Tape: [
    {
      name: "Live",
      args: {
        value: live("m", 640),
        min: value("m", 0),
        max: value("m", 1000),
      },
    },
    {
      name: "Held",
      args: {
        value: held("m", 640),
        min: value("m", 0),
        max: value("m", 1000),
      },
    },
    {
      name: "Band",
      args: {
        value: live("m", 640, { lo: 590, hi: 700, kind: "bound" }),
        min: value("m", 0),
        max: value("m", 1000),
      },
    },
  ] satisfies Presets<ComponentProps<typeof Tape>>,
  DivergingBar: [
    {
      name: "Positive",
      args: { value: live("m/s", 4.2), maxAbs: value("m/s", 10) },
    },
    {
      name: "Negative",
      args: { value: live("m/s", -6.8), maxAbs: value("m/s", 10) },
    },
    {
      name: "Held",
      args: { value: held("m/s", 4.2), maxAbs: value("m/s", 10) },
    },
  ] satisfies Presets<ComponentProps<typeof DivergingBar>>,
  Countdown: [
    { name: "Live", args: { value: live("s", 754), clock: true } },
    { name: "Held", args: { value: held("s", 754), clock: true } },
    { name: "Absent", args: { value: absent() } },
  ] satisfies Presets<ComponentProps<typeof Countdown>>,
  MissionDate: [
    { name: "Live", args: { value: live("ut", 8_345_600) } },
    { name: "Held", args: { value: held("ut", 8_345_600) } },
  ] satisfies Presets<ComponentProps<typeof MissionDate>>,
  ReckonedUnit: [
    { name: "Observed", args: { value: live("m", 71_420) } },
    {
      name: "Banded",
      args: {
        value: live("m", 71_420, { lo: 71_100, hi: 71_800, kind: "sigma1" }),
      },
    },
    { name: "Held", args: { value: held("m", 71_420) } },
  ] satisfies Presets<ComponentProps<typeof ReckonedUnit>>,
  LineGraph: [
    {
      name: "Two series",
      args: {
        series: [
          {
            id: "alt",
            label: "Altitude",
            color: "var(--color-status-go-fg)",
            points: [0, 1, 2, 3, 4, 5, 6].map((x) => ({ x, y: x * x })),
          },
          {
            id: "vs",
            label: "Vertical speed",
            color: "var(--color-status-info-fg)",
            points: [0, 1, 2, 3, 4, 5, 6].map((x) => ({ x, y: 12 - x })),
          },
        ],
        height: 160,
      },
    },
  ] satisfies Presets<ComponentProps<typeof LineGraph>>,
  UnitInput: [
    {
      name: "Metres",
      args: {
        label: "Target altitude",
        value: value("m", 80_000),
        unit: "m",
        onChange: () => {},
      },
    },
  ] satisfies Presets<ComponentProps<typeof UnitInput>>,
  ReadOnlyField: [
    {
      name: "Quantity",
      args: { label: "Apoapsis", value: value("m", 82_300) },
    },
  ] satisfies Presets<ComponentProps<typeof ReadOnlyField>>,
  Stepper: [
    {
      name: "Warp rate",
      args: {
        options: [1, 5, 10, 50, 100],
        value: 10,
        onChange: () => {},
        label: "Warp rate",
      },
    },
  ] satisfies Presets<ComponentProps<typeof Stepper>>,
  CommandGroup: [
    {
      name: "Commit",
      args: {
        value: {},
        onCommit: () => {},
        children: "Grouped inputs",
        commitLabel: "Commit",
      },
    },
    {
      name: "Gated",
      args: {
        value: {},
        onCommit: () => {},
        children: "Grouped inputs",
        commitLabel: "Commit",
        gated: true,
      },
    },
  ] satisfies Presets<ComponentProps<typeof CommandGroup>>,
  CommandButton: [
    { name: "Ready", args: { handle: IDLE_HANDLE, label: "Stage" } },
    {
      name: "Delayed",
      args: {
        handle: { ...IDLE_HANDLE, effectiveDelaySeconds: 12 },
        label: "Stage",
      },
    },
  ] satisfies Presets<ComponentProps<typeof CommandButton>>,
  WidgetScopeProvider: [
    {
      name: "Scoped",
      args: {
        widget: "resource-ops",
        scope: {},
        children: "WidgetScopeProvider",
      },
    },
  ] satisfies Presets<ComponentProps<typeof WidgetScopeProvider>>,
  AugmentSlot: [
    {
      name: "Empty slot",
      // The props type is per slot, and a story typed against every slot at once reads it as never.
      args: { name: "resource-ops.sections", props: {} as never },
    },
  ] satisfies Presets<ComponentProps<typeof AugmentSlot>>,
};

export type PresetName = keyof typeof UI_KIT_PRESETS;
