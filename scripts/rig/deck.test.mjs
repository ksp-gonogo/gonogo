/**
 * The self-check failure text names what was observed and the cause it points
 * at, and never blames libei.
 *
 *   node --test scripts/rig/deck.test.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeInputFailure,
  parseSteamInputFocus,
  readSteamInputFocus,
} from "./deck.mjs";

const frames = ["a.png", "b.png", "c.png"];

test("parses the xprop lines and skips noise", () => {
  const out =
    "37748789 STEAM_INPUT_FOCUS(CARDINAL) = 1\nbogus\n12 STEAM_INPUT_FOCUS:  not found.\n";
  assert.deepEqual(parseSteamInputFocus(out), [{ window: 37748789, value: 1 }]);
});

test("a Steam window holding focus is named with the xprop reset", () => {
  const text = describeInputFailure({
    openedFraction: 0.001,
    steamFocus: [{ window: 0x2400035, value: 1 }],
    frames,
  });
  assert.match(text, /STEAM_INPUT_FOCUS: 1 on 0x2400035/);
  assert.match(
    text,
    /xprop -id 0x2400035 -f STEAM_INPUT_FOCUS 32c -set STEAM_INPUT_FOCUS 0/,
  );
  assert.match(text, /Click: not tested/);
  assert.match(text, /XI2 selectors on the game window: not observable/);
  assert.doesNotMatch(text, /libei/i);
});

test("an unreadable Steam state is reported as unreadable, not as a cause", () => {
  const text = describeInputFailure({
    openedFraction: 0,
    steamFocus: null,
    frames,
  });
  assert.match(text, /could not be read/);
  assert.doesNotMatch(text, /Steam holds input focus/);
});

test("focus 0 rules Steam out", () => {
  const text = describeInputFailure({
    openedFraction: 0.02,
    steamFocus: [{ window: 5, value: 0 }],
    frames,
  });
  assert.match(text, /0 on every Steam window, so Steam is not the cause/);
});

test("a window the name search misses is found through the class search", async () => {
  const commands = [];
  const run = async (command) => {
    commands.push(command);
    return "37748789 STEAM_INPUT_FOCUS(CARDINAL) = 1\n";
  };
  const steamFocus = await readSteamInputFocus(run);
  assert.deepEqual(steamFocus, [{ window: 37748789, value: 1 }]);
  assert.match(commands[0], /xdotool search --class steam/);
  assert.doesNotMatch(commands[0], /search --name/);
  assert.match(commands[0], /xwininfo -root -tree/);
  const text = describeInputFailure({
    openedFraction: 0.01,
    steamFocus,
    frames,
  });
  assert.match(text, /STEAM_INPUT_FOCUS: 1 on 0x2400035/);
});

test("hex window ids from the tree listing parse", () => {
  assert.deepEqual(
    parseSteamInputFocus("0x2400035 STEAM_INPUT_FOCUS(CARDINAL) = 1\n"),
    [{ window: 0x2400035, value: 1 }],
  );
});

test("no window at all reports an unknown cause and still offers the reset", async () => {
  const steamFocus = await readSteamInputFocus(async () => "");
  assert.deepEqual(steamFocus, []);
  const text = describeInputFailure({
    openedFraction: 0.01,
    steamFocus,
    frames,
  });
  assert.match(text, /cause is unknown/);
  assert.doesNotMatch(text, /Steam is not holding input focus/);
  assert.match(
    text,
    /xprop -id \$w -f STEAM_INPUT_FOCUS 32c -set STEAM_INPUT_FOCUS 0/,
  );
});

test("a failing runner reads as unreadable", async () => {
  const steamFocus = await readSteamInputFocus(async () => {
    throw new Error("ssh down");
  });
  assert.equal(steamFocus, null);
});
