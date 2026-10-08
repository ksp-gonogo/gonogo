import { railTagsForCommand, value } from "@ksp-gonogo/sitrep-sdk";
import type {
  CommandButton,
  CommandButtonHandle,
  CommandGroup,
  Countdown,
  Dial,
  IconButton,
  LineGraph,
  MissionDate,
  ReadOnlyField,
  Readout,
  ReckonedUnit,
  Stepper,
  Tape,
  UnitInput,
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

/** A plain cross, so the preset needs no runtime import from the kit. */
const GLYPH = () => (
  <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden="true">
    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth={1.5} />
  </svg>
);

const RANGE = { min: value("1", 0), max: value("1", 3) };

/**
 * The minimal state set for each instrument the generator cannot give a
 * default to: live, held, pending, and a band where the instrument draws one.
 * Enough to see the primitive; the states it deserves are still to be designed.
 */
export const UI_KIT_PRESETS = {
  Dial: [
    {
      name: "Live",
      args: {
        "aria-label": "Dial",
        value: live("deg", 92),
        min: value("deg", 0),
        max: value("deg", 360),
      },
    },
    {
      name: "Held",
      args: {
        "aria-label": "Dial",
        value: held("deg", 92),
        min: value("deg", 0),
        max: value("deg", 360),
      },
    },
    {
      name: "Pending",
      args: {
        "aria-label": "Dial",
        value: pending(),
        min: value("deg", 0),
        max: value("deg", 360),
      },
    },
  ] satisfies Presets<ComponentProps<typeof Dial>>,
  Tape: [
    {
      name: "Live",
      args: {
        value: live("m", 640),
        min: value("m", 0),
        max: value("m", 1000),
        "aria-label": "Altitude",
      },
    },
    {
      name: "Held",
      args: {
        value: held("m", 640),
        min: value("m", 0),
        max: value("m", 1000),
        "aria-label": "Altitude",
      },
    },
    {
      name: "Band",
      args: {
        value: live("m", 640, { lo: 590, hi: 700, kind: "bound" }),
        min: value("m", 0),
        max: value("m", 1000),
        "aria-label": "Altitude",
      },
    },
  ] satisfies Presets<ComponentProps<typeof Tape>>,
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
            color: "var(--color-go-text)",
            points: [0, 1, 2, 3, 4, 5, 6].map((x) => ({ x, y: x * x })),
          },
          {
            id: "vs",
            label: "Vertical speed",
            color: "var(--color-info-text)",
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
  IconButton: [
    {
      name: "At rest",
      args: { "aria-label": "Close", children: <GLYPH /> },
    },
    {
      name: "Pressed",
      args: { "aria-label": "Close", pressed: true, children: <GLYPH /> },
    },
  ] satisfies Presets<ComponentProps<typeof IconButton>>,
  Readout: [
    {
      name: "Inline",
      args: { children: "1,240" },
    },
    {
      name: "Hero",
      args: { size: "hero", children: "1,240" },
    },
    {
      name: "Warning tone",
      args: {
        tone: "warn",
        children: "1,240",
      },
    },
  ] satisfies Presets<ComponentProps<typeof Readout>>,
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
};

export type PresetName = keyof typeof UI_KIT_PRESETS;
