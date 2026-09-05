// The keyboard's inputs, keyed by `KeyboardEvent.code`.
//
// `code` names a PHYSICAL key position, `key` names the character that
// position currently produces. A binding is to a position: the operator who
// bound the key one thumb-width left of the space bar wants that key back
// after switching to AZERTY, and a control panel binding has always meant a
// position. The cost is the label: the names below are the US legend, so a
// French operator reads "Q" on the key their keyboard prints "A" on. Chromium
// can resolve real legends via `navigator.keyboard.getLayoutMap()`; that is
// Chromium-only and not wired here.
//
// The list is deliberately code-defined rather than learned by pressing.
// Every key on a keyboard is known in advance and self-describing, so there
// is nothing for an operator to declare, which is the whole point of the
// keyboard device: no type to author, no instance to create, and a full
// picker on the very first frame.
//
// Tab and Escape are absent on purpose. Tab is how the page is navigated and
// Escape is how every dialog in the app is dismissed (the input-mapping tab's
// own cancel among them); either one, bound to an action, would take a key
// the operator cannot get back. See KeyboardTransport for the rest of the
// suppression rules.

import type { DeviceInput } from "./types";

interface KeyDef {
  code: string;
  name: string;
}

const LETTERS: KeyDef[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => ({
  code: `Key${c}`,
  name: c,
}));

const DIGITS: KeyDef[] = "0123456789".split("").map((c) => ({
  code: `Digit${c}`,
  name: c,
}));

const FUNCTION_KEYS: KeyDef[] = Array.from({ length: 12 }, (_, i) => ({
  code: `F${i + 1}`,
  name: `F${i + 1}`,
}));

const NUMPAD_DIGITS: KeyDef[] = "0123456789".split("").map((c) => ({
  code: `Numpad${c}`,
  name: `Numpad ${c}`,
}));

const NAMED_KEYS: KeyDef[] = [
  { code: "Space", name: "Space" },
  { code: "Enter", name: "Enter" },
  { code: "Backspace", name: "Backspace" },
  { code: "Delete", name: "Delete" },
  { code: "Insert", name: "Insert" },
  { code: "Home", name: "Home" },
  { code: "End", name: "End" },
  { code: "PageUp", name: "Page Up" },
  { code: "PageDown", name: "Page Down" },
  { code: "ArrowUp", name: "Up Arrow" },
  { code: "ArrowDown", name: "Down Arrow" },
  { code: "ArrowLeft", name: "Left Arrow" },
  { code: "ArrowRight", name: "Right Arrow" },
  { code: "ShiftLeft", name: "Left Shift" },
  { code: "ShiftRight", name: "Right Shift" },
  { code: "ControlLeft", name: "Left Ctrl" },
  { code: "ControlRight", name: "Right Ctrl" },
  { code: "AltLeft", name: "Left Alt" },
  { code: "AltRight", name: "Right Alt" },
  { code: "MetaLeft", name: "Left Meta" },
  { code: "MetaRight", name: "Right Meta" },
  { code: "CapsLock", name: "Caps Lock" },
  { code: "Backquote", name: "` Backquote" },
  { code: "Minus", name: "- Minus" },
  { code: "Equal", name: "= Equals" },
  { code: "BracketLeft", name: "[ Left Bracket" },
  { code: "BracketRight", name: "] Right Bracket" },
  { code: "Backslash", name: "\\ Backslash" },
  { code: "Semicolon", name: "; Semicolon" },
  { code: "Quote", name: "' Quote" },
  { code: "Comma", name: ", Comma" },
  { code: "Period", name: ". Period" },
  { code: "Slash", name: "/ Slash" },
  { code: "NumpadDivide", name: "Numpad /" },
  { code: "NumpadMultiply", name: "Numpad *" },
  { code: "NumpadSubtract", name: "Numpad -" },
  { code: "NumpadAdd", name: "Numpad +" },
  { code: "NumpadDecimal", name: "Numpad ." },
  { code: "NumpadEnter", name: "Numpad Enter" },
];

const ALL_KEYS: KeyDef[] = [
  ...LETTERS,
  ...DIGITS,
  ...FUNCTION_KEYS,
  ...NAMED_KEYS,
  ...NUMPAD_DIGITS,
];

/**
 * Every key the keyboard device exposes, as `DeviceInput`s. All buttons: a
 * key is down or it is not, so no analog action will ever offer one, and
 * `InputMappingTab` filters on `accepts` without needing to know that.
 */
export const KEYBOARD_INPUTS: readonly DeviceInput[] = ALL_KEYS.map((k) => ({
  id: k.code,
  name: k.name,
  kind: "button" as const,
}));

const KNOWN_CODES = new Set(ALL_KEYS.map((k) => k.code));

/**
 * Is this `KeyboardEvent.code` one the keyboard device carries? A key outside
 * the table (media keys, an OEM key, an unmapped code) emits nothing rather
 * than inventing an input id no picker could ever show.
 */
export function isKeyboardInputCode(code: string): boolean {
  return KNOWN_CODES.has(code);
}
