import { clamp } from "@gonogo/core";
import type { InputEvent } from "../transports/DeviceTransport";
import type { DeviceInput } from "../types";

/**
 * Screen declaration as it arrives inside the device's state message.
 * `type` selects a render-style family (today: `"txt"` → the text-buffer
 * style). Other fields depend on the family — `txt` takes `w`/`h`.
 */
export interface JsonStateScreen {
  type: string;
  [key: string]: unknown;
}

/**
 * Output of one `parseJsonState` call. `events` is emitted per tick. The
 * two `*Update` fields are only populated when the message carried new
 * structural information — callers can short-circuit schema persistence
 * when both are `null`.
 */
export interface JsonStateParseResult {
  events: InputEvent[];
  /** New / updated input definitions. `null` when the message didn't carry schema info for any input. */
  inputsUpdate: DeviceInput[] | null;
  /** Latest screen declaration. `null` when the message didn't include one. */
  screenUpdate: JsonStateScreen | null;
  /** True only when the line couldn't be parsed as JSON at all — caller may log. */
  malformed: boolean;
}

type KnownInputsIndex = Map<string, DeviceInput>;

/**
 * Parse one line of the json-state protocol. Format:
 *
 *   {
 *     "btn":    { "A": 0, "B": 1, … },
 *     "analog": { "X": { "val": 100, "min": 0, "max": 1023 }, … },
 *     "screen": { "type": "txt", "w": 21, "h": 8 }
 *   }
 *
 * All three top-level keys are optional; messages may also elide `min`/`max`
 * after the first tick and we fall back to the cached values in
 * `knownInputs`. The parser is pure — state (last-known schema) lives in
 * the caller.
 */
export function parseJsonState(
  line: string,
  knownInputs: readonly DeviceInput[],
): JsonStateParseResult {
  const trimmed = line.trim();
  if (trimmed === "") {
    return emptyResult();
  }

  let msg: unknown;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return { ...emptyResult(), malformed: true };
  }
  if (!isObject(msg)) return { ...emptyResult(), malformed: true };

  const cache = indexInputs(knownInputs);
  const events: InputEvent[] = [];
  const updatedInputs = new Map<string, DeviceInput>();

  // ── Buttons ──
  const btnObj = isObject(msg.btn) ? msg.btn : null;
  if (btnObj) {
    for (const [id, raw] of Object.entries(btnObj)) {
      const event = parseButton(id, raw);
      if (event) events.push(event);

      // Register the button as a known input if we haven't seen it before.
      if (!cache.has(id) && !updatedInputs.has(id)) {
        updatedInputs.set(id, { id, name: id, kind: "button" });
      }
    }
  }

  // ── Analogs ──
  const analogObj = isObject(msg.analog) ? msg.analog : null;
  if (analogObj) {
    for (const [id, raw] of Object.entries(analogObj)) {
      const known = cache.get(id);
      const parsed = parseAnalog(id, raw, known);
      if (parsed.event) events.push(parsed.event);
      if (parsed.updatedInput) updatedInputs.set(id, parsed.updatedInput);
    }
  }

  // ── Screen ──
  const screen =
    isObject(msg.screen) && typeof msg.screen.type === "string"
      ? (msg.screen as JsonStateScreen)
      : null;

  // Only surface an inputs update when something genuinely new / changed was
  // seen. Unchanged ticks return null so the caller can skip a re-emit.
  const merged = mergeInputs(knownInputs, updatedInputs);

  return {
    events,
    inputsUpdate: merged,
    screenUpdate: screen,
    malformed: false,
  };
}

// ──────────────────────────────────────────────────────────────────────

function emptyResult(): JsonStateParseResult {
  return {
    events: [],
    inputsUpdate: null,
    screenUpdate: null,
    malformed: false,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function indexInputs(inputs: readonly DeviceInput[]): KnownInputsIndex {
  const out = new Map<string, DeviceInput>();
  for (const i of inputs) out.set(i.id, i);
  return out;
}

function parseButton(id: string, raw: unknown): InputEvent | null {
  if (typeof raw === "boolean") return { inputId: id, value: raw };
  if (typeof raw === "number") return { inputId: id, value: raw !== 0 };
  if (typeof raw === "string") {
    return { inputId: id, value: raw !== "" && raw !== "0" };
  }
  return null;
}

interface AnalogParse {
  event: InputEvent | null;
  updatedInput: DeviceInput | null;
}

function parseAnalog(
  id: string,
  raw: unknown,
  known: DeviceInput | undefined,
): AnalogParse {
  let val: number | undefined;
  let min: number | undefined = known?.min;
  let max: number | undefined = known?.max;

  if (isObject(raw)) {
    if (typeof raw.val === "number") val = raw.val;
    if (typeof raw.min === "number") min = raw.min;
    if (typeof raw.max === "number") max = raw.max;
  } else if (typeof raw === "number") {
    // Short-form: `"X": 100` with no min/max — only works if the analog
    // has been declared in a previous tick (`known` has them).
    val = raw;
  }

  const haveRange = typeof min === "number" && typeof max === "number";
  const rangeChanged = haveRange && (known?.min !== min || known?.max !== max);

  let updatedInput: DeviceInput | null = null;
  // Only register/update an input when we actually have a usable range.
  // A short-form value with no cached range is unregisterable — the caller
  // will ignore it entirely and we surface nothing.
  if (haveRange && (!known || rangeChanged)) {
    updatedInput = { id, name: id, kind: "analog", min, max };
  }

  if (val === undefined || !haveRange || max === min) {
    return { event: null, updatedInput };
  }

  const safeMin = min as number;
  const safeMax = max as number;
  const normalised = clamp(
    (2 * (val - safeMin)) / (safeMax - safeMin) - 1,
    -1,
    1,
  );
  return {
    event: { inputId: id, value: normalised },
    updatedInput,
  };
}

function mergeInputs(
  knownInputs: readonly DeviceInput[],
  updates: Map<string, DeviceInput>,
): DeviceInput[] | null {
  if (updates.size === 0) return null;
  const keep = knownInputs.filter((i) => !updates.has(i.id));
  return [...keep, ...updates.values()];
}
