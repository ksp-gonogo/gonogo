# @ksp-gonogo/serial

Per-screen serial input platform. Lets an operator plug physical hardware
(or a virtual stand-in) into a gonogo screen and map its buttons / knobs
to widget actions. Each screen has its own set of devices — inputs on a
station stay station-local, they don't flow across PeerJS.

---

## Mental model

Three concepts, cleanly separated:

| Concept            | What it is                                                                                                               | Persisted to                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **Device type**    | A reusable definition of *what this hardware is*: the list of named inputs, how to parse them, optional render style.    | `localStorage` (per screen)                            |
| **Device instance**| A specific device *on this screen*: references a type, picks a transport (web-serial or virtual), stores baud rate, etc. | `localStorage` (per screen, key `gonogo.serial.devices.<screenKey>`) |
| **Input mapping**  | On a single widget: "when input *X* on device *Y* fires, dispatch widget action *A*."                                    | The `DashboardItem.inputMappings` blob on each widget  |

Everything user-defined lives in `localStorage`. Render styles are
code-registered (see below).

---

## Adding a real USB device (Web Serial)

1. Click the joystick FAB (bottom-right) to open **Serial Devices**.
2. Under **Device Types**, define the hardware once:
   - Give it a name (e.g. `Cockpit Panel`).
   - For each input: id, human name, `kind` (`button` or `analog`), and
     the *character offset + length* inside the incoming line where that
     input's value lives. For `analog` also set the raw `min..max` range.
   - Parser: `char-position` (the only parser today).
3. Under **Devices**, add an instance: name, pick the type, pick
   `Web Serial (USB)` as the transport, set baud rate.
4. Save. The device appears in the list with status `disconnected`.
5. Click **Connect** on the device row. **The browser fires
   `navigator.serial.requestPort()` here** — pick the port from the
   browser's dialog. Status flips to `connected`.

The port picker is deliberately a separate step from saving — Web Serial
needs a live user gesture, and we don't want it firing every time you
edit an existing device.

## Adding a virtual device (no hardware needed)

Same flow, but pick `Virtual (in-app)` as the transport and skip the
Connect step. A **Virtual Controller** type + instance are also seeded
automatically on first run so there's always something to test against.

Add the **Virtual Device** widget to a dashboard to drive the virtual
device by clicking buttons / dragging sliders instead of sending serial
bytes. Great for testing a widget's input-mapping UX without hardware.

---

## Parsers

Two parsers today — pick one per device type. Each has a `?` help button
next to it in the Device Type editor that opens the full protocol reference
and an MCU example; the shorthand is here.

### `char-position` — fixed-width, user-authored schema

Low-ceremony. Your firmware sends one ASCII line per tick, each input
occupying a fixed character slice. You declare the inputs and their
slice positions in the UI. Best for simple MCU projects where
hand-rolling `snprintf` is easier than pulling in a JSON library.

### `json-state` — self-describing, device-authored schema

NDJSON — one line of JSON per tick:

```json
{
  "btn":    { "A": 0, "B": 1 },
  "analog": { "X": { "val": 100, "min": 0, "max": 1023 } },
  "screen": { "type": "txt", "w": 21, "h": 8 }
}
```

The parser discovers the input list from the message itself — the Device
Type's inputs populate (and update) at connect time from what the device
reports. No offset/length editing in the UI; the "Inputs" section shows
a read-only list of what the device has announced so far.

All three top-level keys are optional. After the first tick, firmware can
elide `min`/`max` (`{"analog":{"X":100}}` works — the parser caches the
range) and the `screen` block to save bytes. Re-sending the full form
every few seconds is wise so an app that reconnects mid-stream picks the
schema up without a handshake.

The `screen` block's `type` selects a render-style family:

| `screen.type` | Render style    | Config read from `screen` |
| ------------- | --------------- | ------------------------- |
| `"txt"`       | `text-buffer`   | `w`, `h`                  |

Unknown `type` values leave the render style unset — no error, just no
output. New render styles are added under `packages/serial/src/renderStyles/`.

### How `char-position` slices a line

Both parsers are designed around "one line per tick." For char-position
specifically: It assumes your device sends one
line of ASCII per tick, terminated by `\n`. Each input you declared on
the type picks a fixed character slice of that line.

Say your device sends this each tick:

```
0723 1 0 0 450
```

And your type's inputs are:

| id         | kind   | offset | length | min | max  |
| ---------- | ------ | ------ | ------ | --- | ---- |
| throttle   | analog | 0      | 4      | 0   | 1023 |
| sas        | button | 5      | 1      |     |      |
| rcs        | button | 7      | 1      |     |      |
| gear       | button | 9      | 1      |     |      |
| pitch-trim | analog | 11     | 3      | 0   | 900  |

Per tick you get five `InputEvent`s:

- `throttle`: `parseInt("0723") → 723`, normalised `(2·723/1023 - 1) ≈ 0.41`
- `sas`: `"1"` → `true`
- `rcs`: `"0"` → `false`
- `gear`: `"0"` → `false`
- `pitch-trim`: `parseInt("450") → 450`, normalised `0.0`

### Parsing rules

- **Button** — non-empty slice AND not `"0"` → `true`. Everything else → `false`.
- **Analog** — `parseInt(slice, 10)` then normalised to `-1..1` using
  `(raw - min) / (max - min)` mapped into `[-1, 1]`, clamped.
- **Malformed slices** (out-of-range offset, `NaN`, zero-width range) are
  silently skipped for that tick — no event for that input. Other inputs
  on the same line still fire.

Source: [`packages/serial/src/parsers/charPosition.ts`](./src/parsers/charPosition.ts)

---

## Wiring an input to a widget action

Widgets opt into the input platform by declaring actions at registration:

```ts
const actions = [
  { id: "toggle-sas",   label: "Toggle SAS",  accepts: ["button"] },
  { id: "set-throttle", label: "Throttle",    accepts: ["analog"] },
] as const satisfies readonly ActionDefinition[];

registerComponent({
  id: "my-widget",
  actions,
  // …
});
```

Inside the widget body, subscribe to those actions:

```ts
useActionInput<typeof actions>({
  "toggle-sas": () => {
    setSas((on) => !on);
  },
  "set-throttle": ({ value }) => {
    // value is -1..1
    setThrottle(Math.max(0, value));
    // Optional: return an object to drive render-style output back to the device.
    return { throttle: value };
  },
});
```

Then the operator opens the widget's gear icon → **Inputs tab**. For
each declared action, they pick a *device* and *input*. That binding
lives on `DashboardItem.inputMappings` and is consumed by `InputDispatcher`.

---

## Dispatch pipeline

```
bytes arrive
  → Transport.readLoop                       accumulates + splits \n
  → parseCharPosition                        emits one InputEvent per input
  → SerialDeviceService.onInput              per-screen fan-out
  → InputDispatcher.handleInput              walks items' inputMappings
  → dispatchAction(itemId, actionId, …)      finds the useActionInput handler
  → handler runs                             and optionally returns a payload
  → SerialDeviceService.recordActionReturn   merges returns for this device
  → DeviceRenderStyle.render                 debounced, via code-registered style
  → transport.write()                        writes back to the hardware (LCD, LEDs)
```

All routing lives in
[`packages/serial/src/InputDispatcher.ts`](./src/InputDispatcher.ts).

---

## Writing back to the device (render styles)

Each device type can reference a render style by id. When a widget's
action handler returns an object, the service merges returns from every
widget that targets the same device into one state snapshot and runs it
through the render style to produce a frame to write back.

The built-in style is **`text-buffer`** — a fixed-width ASCII grid whose
dimensions come from `DeviceType.renderStyleConfig` (`{ w, h }`). Defaults
to 21×8 when no config is provided; set `{ w: 40, h: 4 }` for a VFD, etc.
A backward-compat alias **`text-buffer-168`** is registered pointing at
the 21×8 defaults for saved types from before the generalisation.

Register your own via:

```ts
import { registerSerialRenderStyle } from "@ksp-gonogo/serial";

registerSerialRenderStyle({
  id: "my-style",
  name: "My Style",
  render(merged) {
    // merged is { key: value } from all action returns targeting this device
    return `THROTTLE ${String(merged.throttle ?? "")}\n`;
  },
});
```

Register at module load (like components / data sources). New styles live
under `packages/serial/src/renderStyles/` next to the built-in.

---

## Transports

### `web-serial`

Real USB via `navigator.serial`. Requires:

- An HTTPS context or `localhost` (browser security requirement).
- A supported browser — Chrome / Edge / Opera today, Firefox via a flag.
- A user gesture to call `requestPort()` — why Connect is a separate
  step from Save.

### `virtual`

In-memory transport backed by the **Virtual Device** widget or, in tests,
by `VirtualTransport.inject(lines)`. No browser features, no hardware.
Use this for:

- A controller simulator UI for training / recording without hardware.
- Integration tests — `VirtualTransport` is the preferred test fixture
  for serial flows, see `packages/serial/src/transports/VirtualTransport.test.ts`.

---

## Signal scope

Serial events **do not** broadcast over PeerJS. A station wanting
physical inputs adds its own devices and mappings locally. Each screen
that wants inputs configures them on that screen.

---

## File map

```
packages/serial/src/
├─ types.ts                        DeviceType, DeviceInstance, DeviceInput, …
├─ parsers/
│   ├─ charPosition.ts             Fixed-width ASCII slicer
│   └─ jsonState.ts                Self-describing NDJSON parser
├─ transports/
│   ├─ DeviceTransport.ts          Transport interface
│   ├─ WebSerialTransport.ts       navigator.serial reader/writer
│   └─ VirtualTransport.ts         In-memory testing transport
├─ renderStyles/                   Code-registered render styles
├─ registry.ts                     registerSerialRenderStyle + lookups
├─ SerialDeviceService.ts          Per-screen service: instances, connects, fan-out
├─ InputDispatcher.ts              InputEvent → dispatchAction routing
├─ InputMappingTab.tsx             The "Inputs" tab in widget config modals
├─ SerialDevicesMenu/              Device/type management UI (the joystick FAB modal)
├─ VirtualDevice/                  The in-dashboard Virtual Device widget
└─ bindings.ts                     DashboardItem.inputMappings shape
```

---

## Testing patterns

- **Prefer `VirtualTransport`** for integration tests — no browser APIs
  needed, inject lines directly via `VirtualTransport.inject(line)`.
- Use **`MockWebSerial`** when you specifically need to exercise the
  `WebSerialTransport` code path (read loop, buffer handling).
- Both live under `packages/serial/src/mocks/` and are exported from
  `@ksp-gonogo/serial` for cross-package reuse.
