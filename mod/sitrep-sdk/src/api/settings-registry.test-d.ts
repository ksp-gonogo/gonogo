// Type-level proof of what an OUTSIDE Uplink author can declare through
// `registerSetting`, and of what the compiler stops them declaring. Every
// import comes from the package root, the way a third party installs it:
// nothing here reaches into `spine/`, which is unpublished.
//
// The rows below are the four shapes a mod's settings actually take, and the
// `@ts-expect-error` blocks are the point of the file. A registry that accepted
// `type: "number"` beside `defaultValue: true` would render a `Switch` over a
// tolerance and say nothing, which is the failure mode the typed union exists
// to make impossible at the call site rather than in the panel.

import {
  isReadOnlySetting,
  registerSetting,
  type SettingDefinition,
  type SettingType,
  settingTypeOf,
  value,
} from "../index";

// --- A boolean row still needs no `type` at all -----------------------------
//
// The back-compat guarantee, stated as a compile: every row registered before
// there was more than one type omitted `type` or wrote `"boolean"`, and both
// still land on a boolean row with a boolean `defaultValue`.

registerSetting({
  id: "legacy.implicit",
  label: "Implicit boolean",
  category: "Test",
  defaultValue: true,
});

registerSetting({
  id: "legacy.explicit",
  type: "boolean",
  label: "Explicit boolean",
  category: "Test",
  defaultValue: false,
});

// --- A source-backed boolean's `write` still takes a boolean ----------------
//
// The row's declared type reaches the binding closures, so a client that owns a
// `setThrottle(v: boolean)` can pass `v` straight through, which is what every
// existing caller does.

declare function setThrottle(on: boolean): void;

registerSetting({
  id: "legacy.sourced",
  backing: "source-backed",
  type: "boolean",
  sourceId: "some-uplink",
  read: () => true,
  write: (_s, v) => {
    setThrottle(v);
  },
  subscribe: () => () => {},
  label: "Throttle",
  category: "Test",
});

// --- A quantity, read off the wire, grouped, and never writable -------------

interface PredictionSettings {
  tolerance: number;
  maxSteps: number;
  frameName: string;
  declutter: boolean;
}

registerSetting({
  id: "example.tolerance",
  backing: "stream-backed",
  type: "number",
  topic: "example.settings",
  // A `Value`, not a bare number, so the row renders "1 m" and announces
  // "metres" rather than showing a naked 1.
  select: (p) => value("m", (p as PredictionSettings).tolerance),
  label: "Prediction tolerance",
  category: "Example",
  group: "Prediction",
});

registerSetting({
  id: "example.maxSteps",
  backing: "stream-backed",
  type: "number",
  topic: "example.settings",
  select: (p) => (p as PredictionSettings).maxSteps,
  label: "Max steps",
  category: "Example",
  group: "Prediction",
});

registerSetting({
  id: "example.frame",
  backing: "stream-backed",
  type: "text",
  topic: "example.settings",
  select: (p) => (p as PredictionSettings).frameName,
  label: "Plotting frame",
  category: "Example",
  group: "Plotting frame",
});

registerSetting({
  id: "example.declutter",
  backing: "stream-backed",
  type: "boolean",
  topic: "example.settings",
  select: (p) => (p as PredictionSettings).declutter,
  label: "Declutter",
  category: "Example",
  group: "Drawing",
});

// --- A source-backed row the source reports but will not accept -------------

registerSetting({
  id: "example.buildId",
  backing: "source-backed",
  type: "text",
  readOnly: true,
  sourceId: "some-uplink",
  read: () => "0.1.0",
  subscribe: () => () => {},
  label: "Build",
  category: "Example",
  group: "Diagnostics",
});

// --- What the compiler refuses ----------------------------------------------

// The two mismatched defaults are refused at the CALL rather than at the
// property, because `registerSetting` is overloaded: neither the generic form
// nor the already-typed forwarding form matches, and TypeScript reports an
// exhausted overload set at the argument.

// @ts-expect-error a number row's default is a number, not a flag
registerSetting({
  id: "wrong.numberDefault",
  type: "number",
  label: "Tolerance",
  category: "Test",
  defaultValue: true,
});

// @ts-expect-error a text row's default is a string
registerSetting({
  id: "wrong.textDefault",
  type: "text",
  label: "Frame",
  category: "Test",
  defaultValue: 3,
});

registerSetting({
  id: "wrong.sourcedWrite",
  backing: "source-backed",
  type: "number",
  sourceId: "some-uplink",
  read: () => 1,
  // @ts-expect-error the row is a number row, so its writer takes a number
  write: (_s, v: boolean) => {
    setThrottle(v);
  },
  subscribe: () => () => {},
  label: "Steps",
  category: "Test",
});

// A stream-backed row has no writer, so it cannot be declared writable. The
// directive sits on the call rather than on the property because no member of
// the union matches at all, and TypeScript reports that at the argument.
// @ts-expect-error readOnly: false is not a thing a stream-backed row can be
registerSetting({
  id: "wrong.streamWritable",
  backing: "stream-backed",
  type: "text",
  topic: "example.settings",
  select: () => "x",
  label: "Frame",
  category: "Test",
  readOnly: false,
});

// --- Rows declared as a list, registered in a loop ---------------------------

// What a client with dozens of rows writes. Mixed types collapse to the union
// the moment they share an array, and the generic form cannot take that back
// (a source-backed row's `write` is contravariant in the row's own type), so
// the forwarding overload is what makes the loop compile.
const rows: SettingDefinition[] = [
  {
    id: "list.frame",
    backing: "stream-backed",
    type: "text",
    topic: "example.settings",
    select: (p) => (p as PredictionSettings).frameName,
    label: "Frame",
    category: "Example",
  },
  {
    id: "list.tolerance",
    backing: "stream-backed",
    type: "number",
    topic: "example.settings",
    select: (p) => (p as PredictionSettings).tolerance,
    label: "Tolerance",
    category: "Example",
  },
];

for (const def of rows) registerSetting(def);

// --- The read side ----------------------------------------------------------

declare const registered: SettingDefinition;

// Both predicates take the widened union a registry read hands back, which is
// the only shape a renderer ever has.
const writable: boolean = !isReadOnlySetting(registered);
const kind: SettingType = settingTypeOf(registered);
void writable;
void kind;
