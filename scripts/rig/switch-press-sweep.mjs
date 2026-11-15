#!/usr/bin/env node
/**
 * Press RCS and an action group around a near vessel switch, at a sweep of
 * times before and after the switch key, and read back from the game's own
 * save which craft each press changed.
 *
 *   node scripts/rig/switch-press-sweep.mjs [--out <dir>] [--url <ws>]
 *     [--offsets -600,-300,0,300,600,800,1200,1600,2000,2500] [--repeat 1]
 *     [--gap 300] [--settle 2] [--late 10]
 *     [--switch-key bracketright] [--save-key F5]
 *
 * Before it runs: the game is in flight on a craft with a second craft loaded
 * within physics range (so `]` switches without a scene load), both landed or
 * on the pad so a quicksave is allowed, the mod's port is tunnelled
 * (`ssh -f -N -L 8090:127.0.0.1:8090 deck`), and nothing else is driving the
 * rig. The save's `quicksave.sfs` is overwritten. Both craft must have a route
 * from the command centre: a press on a craft the centre's plan cannot reach is
 * held for up to an hour of game time, so the sweep checks both first and stops
 * with the mod's own warning when either is held.
 *
 * One trial:
 *
 *   1. both craft are set to RCS off and action group 1 off, and the save is
 *      read to prove it
 *   2. the switch key is sent on the Deck at time zero
 *   3. `vessel.control.setRcs {enabled: true}` is sent at the trial's offset
 *      from time zero and `vessel.control.setActionGroup {group: 1, state:
 *      true}` at offset + gap, each on its own socket opened beforehand, each
 *      naming the craft that was active before the key as the one seen
 *   4. after `--settle` seconds the game is quicksaved and the action groups
 *      of every craft are read from the save, and again after `--late` seconds
 *   5. the game is switched back, so every trial starts on the same craft
 *
 * A negative offset presses before the key is sent, which is a press before
 * the game switches however long the game takes to act on the key. The key
 * takes about 0.4 s to inject on the Deck, so only offsets past that press
 * after the switch; the default sweep runs to 2.5 s after the key. The time
 * the game did switch is the "Switching To Vessel" line in KSP.log, and each
 * press is placed against it on the Deck's clock, so `pressToSwitchMs` is the
 * measured figure and the offset is only the request.
 *
 * It uses nothing from the build under test but the two commands and the
 * Sitrep socket, so it runs unchanged against any build of the mod. The
 * readback is the stock save file, never the mod's telemetry.
 *
 * Output: `<out>/trials.jsonl`, one line a trial, and `<out>/summary.txt`. A
 * trial is LOST when a press was answered as a success and the group it set
 * is on for no craft in the save.
 *
 * Rig only: it needs a Deck, and nothing in CI runs it.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { input, ssh } from "./deck.mjs";
import { TopicWatch } from "./topics.mjs";

const SSH_HOST = process.env.RIG_SSH ?? "deck";
const KSP_ROOT =
  "$HOME/.local/share/Steam/steamapps/common/Kerbal Space Program";

function parseCli(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
  }
  return flags;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * The Deck's clock minus this machine's, in milliseconds, from the fastest of
 * several round trips over one standing SSH session.
 */
async function deckClockOffsetMs() {
  const child = spawn("ssh", [
    SSH_HOST,
    "while read line; do date +%s.%N; done",
  ]);
  let pending = null;
  child.stdout.on("data", (chunk) => pending?.(String(chunk).trim()));
  const ask = () =>
    new Promise((done) => {
      const sent = Date.now();
      pending = (text) => {
        const back = Date.now();
        done({
          rtt: back - sent,
          offset: Number(text) * 1000 - (sent + back) / 2,
        });
      };
      child.stdin.write("x\n");
    });
  await ask();
  let best = null;
  for (let i = 0; i < 12; i++) {
    const sample = await ask();
    if (best === null || sample.rtt < best.rtt) best = sample;
  }
  child.stdin.end();
  child.kill();
  return { offsetMs: best.offset, rttMs: best.rtt };
}

/**
 * How many "Switching To Vessel" lines KSP.log holds, and the newest forty as
 * Deck epoch milliseconds, oldest first.
 */
async function switchLines() {
  const out = await ssh(
    [
      `cd "${KSP_ROOT}"`,
      "date +%s.%N",
      "date +%H:%M:%S.%N",
      `grep -ac "Switching To Vessel" KSP.log`,
      `grep -a "Switching To Vessel" KSP.log | tail -n 40`,
    ].join(" && "),
  );
  const [epochText, clockText, totalText, ...lines] = out.trim().split("\n");
  const [h, m, s] = clockText.split(":").map(Number);
  const midnightMs = Number(epochText) * 1000 - (h * 3600 + m * 60 + s) * 1000;
  const newest = lines
    .map((line) => {
      const match = line.match(
        /^\[LOG (\d+):(\d+):([\d.]+)\].*Switching To Vessel (.*?) -+/,
      );
      if (!match) return null;
      const seconds =
        Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      return { atDeckMs: midnightMs + seconds * 1000, to: match[4] };
    })
    .filter(Boolean);
  return { total: Number(totalText), newest };
}

/** The switches logged since `total` was read, oldest first. */
function switchesSince(total, log) {
  const added = Math.min(log.total - total, log.newest.length);
  return added > 0 ? log.newest.slice(-added) : [];
}

/**
 * The mod's newest "link trace" line in KSP.log for each named craft: its
 * route to a ground station, or why it has none.
 */
async function linkTraces(names) {
  const traces = [];
  for (const name of names) {
    const line = await ssh(
      `cd "${KSP_ROOT}" && grep -aF "link trace: ${name} " KSP.log | tail -n 1`,
    );
    traces.push(line.trim() || `no link trace logged for ${name}`);
  }
  return traces;
}

const READ_SAVE = `
import glob, json, os, sys
root = os.path.expanduser("~/.local/share/Steam/steamapps/common/Kerbal Space Program/saves")
files = glob.glob(os.path.join(root, "*", "quicksave.sfs"))
if not files:
    print(json.dumps({"error": "no quicksave.sfs"})); sys.exit(0)
path = max(files, key=os.path.getmtime)
vessels, current, groups = [], None, None
for raw in open(path, errors="replace"):
    line = raw.strip()
    if line == "VESSEL":
        current = {"name": None, "pid": None, "groups": {}}
        vessels.append(current)
    elif current is not None and current["name"] is None and line.startswith("name = "):
        current["name"] = line[7:]
    elif current is not None and current["pid"] is None and line.startswith("pid = "):
        current["pid"] = line[6:]
    elif current is not None and line == "ACTIONGROUPS":
        groups = current["groups"]
    elif groups is not None and line == "}":
        groups = None
    elif groups is not None and " = " in line:
        key, value = line.split(" = ", 1)
        groups[key] = value.split(",")[0].strip() == "True"
print(json.dumps({"path": path, "mtime": os.path.getmtime(path), "vessels": [
    {"name": v["name"], "pid": v["pid"], "rcs": v["groups"].get("RCS"), "ag1": v["groups"].get("Custom01")}
    for v in vessels if v["groups"]]}))
`;

/** What the newest quicksave says of every craft's RCS and action group 1. */
async function readSave() {
  const encoded = Buffer.from(READ_SAVE).toString("base64");
  return JSON.parse(await ssh(`echo ${encoded} | base64 -d | python3 -`));
}

/** Quicksave the game and read the save once the file has been rewritten. */
async function quicksaveAndRead(saveKey) {
  const before = await readSave();
  await input(`key ${saveKey}`);
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const after = await readSave();
    if (after.mtime !== undefined && after.mtime !== before.mtime) return after;
  }
  return {
    error:
      "the quicksave was not written: the game refused it or the key did not reach it",
  };
}

/** A socket that has said hello and sends one command when asked, recording every message about it. */
function armCommand(url, command, args, seenVesselId) {
  const requestId = randomUUID();
  const record = { command, args, requestId, sentAtMs: null, messages: [] };
  const socket = new WebSocket(url);
  let hello = null;
  const ready = new Promise((done, fail) => {
    socket.once("error", fail);
    socket.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (hello === null && message?.type === "hello") {
        hello = message;
        done();
      }
      if (message?.requestId !== requestId) return;
      record.messages.push({ atMs: Date.now(), ...message });
    });
  });
  return {
    ready,
    record,
    fire() {
      record.sentAtMs = Date.now();
      socket.send(
        JSON.stringify({
          type: "command-request",
          requestId,
          command,
          label: "",
          topic: "",
          seenBootId: hello.bootId,
          seenEpoch: hello.timelineEpoch,
          ...(seenVesselId ? { seenVesselId } : {}),
          args,
          sentAt: 0,
        }),
      );
    },
    close: () => socket.close(),
  };
}

/**
 * How a press ended: "success", "refused: <why>", "held: <warning>" for one
 * the centre accepted and is keeping until a route appears, or "no answer".
 */
function outcomeOf(record) {
  const settled = record.messages.find(
    (m) => m.type === "command-response" || m.type === "error",
  );
  if (!settled) {
    const warned = record.messages.find((m) => m.warning);
    return warned ? `held: ${warned.warning}` : "no answer";
  }
  if (settled.type === "error")
    return `refused: ${settled.message ?? settled.code ?? "error"}`;
  const result = settled.result;
  if (result && typeof result === "object" && result.success === false) {
    return `refused: ${result.detail ?? result.errorCode ?? "failed"}`;
  }
  return "success";
}

const settledOrHeld = (record) => outcomeOf(record) !== "no answer";

async function sendAndWait(url, command, args) {
  const armed = armCommand(url, command, args, undefined);
  await armed.ready;
  armed.fire();
  for (let i = 0; i < 100 && !settledOrHeld(armed.record); i++) {
    await sleep(100);
  }
  armed.close();
  return outcomeOf(armed.record);
}

/**
 * Send the switch key and wait for the game to log the switch, sending the key
 * again when it logs none. Resolves with that line.
 */
async function switchAndWait(switchKey) {
  const before = (await switchLines()).total;
  for (let attempt = 0; attempt < 3; attempt++) {
    await input(`key ${switchKey}`);
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      const added = switchesSince(before, await switchLines());
      if (added.length > 0) return added[added.length - 1];
    }
    console.error(`no switch logged ${5 * (attempt + 1)} s after the key`);
  }
  throw new Error(
    "the game logged no vessel switch: the key did not reach it, or no second craft is in range",
  );
}

/**
 * Both craft to RCS off and action group 1 off, ending on the craft it started
 * on. Throws when either craft does not answer, since a press on it could not
 * be read either.
 */
async function allOff(url, switchKey) {
  for (let pass = 0; pass < 2; pass++) {
    for (const [command, args] of [
      ["vessel.control.setRcs", { enabled: false }],
      ["vessel.control.setActionGroup", { group: 1, state: false }],
    ]) {
      const outcome = await sendAndWait(url, command, args);
      if (outcome !== "success") {
        throw new Error(
          `${command} did not run on the active craft, so no press on it can be read (${outcome})`,
        );
      }
    }
    await switchAndWait(switchKey);
    await sleep(2500);
  }
}

async function trial({
  url,
  watch,
  offsetMs,
  gapMs,
  settleS,
  lateS,
  switchKey,
  saveKey,
  clock,
}) {
  await allOff(url, switchKey);
  const baseline = await quicksaveAndRead(saveKey);
  const seen = watch.get("vessel.identity")?.payload;
  const seenId = typeof seen?.vesselId === "string" ? seen.vesselId : undefined;

  const rcs = armCommand(
    url,
    "vessel.control.setRcs",
    { enabled: true },
    seenId,
  );
  const ag1 = armCommand(
    url,
    "vessel.control.setActionGroup",
    { group: 1, state: true },
    seenId,
  );
  await Promise.all([rcs.ready, ag1.ready]);
  const logBefore = await switchLines();

  const lead = Math.max(0, -offsetMs) + 400;
  const zero = Date.now() + lead;
  const at = (ms, run) => setTimeout(run, Math.max(0, zero + ms - Date.now()));
  let keyStamps = "";
  const key = new Promise((done) => {
    at(0, async () => {
      // Stamped on the Deck either side of the key, since the SSH hop is not part of the game's latency.
      keyStamps = await ssh(
        `date +%s.%N; python3 ~/xin.py 'key ${switchKey}'; date +%s.%N`,
      );
      done();
    });
  });
  at(offsetMs, () => rcs.fire());
  at(offsetMs + gapMs, () => ag1.fire());
  await key;
  await sleep(
    Math.max(0, zero + offsetMs + gapMs - Date.now()) + settleS * 1000,
  );

  const switches = switchesSince(logBefore.total, await switchLines());
  const switched = switches[0] ?? null;
  const early = await quicksaveAndRead(saveKey);
  await sleep(lateS * 1000);
  const late = await quicksaveAndRead(saveKey);
  rcs.close();
  ag1.close();
  await switchAndWait(switchKey);
  await sleep(2500);

  const [keyStartS, keyEndS] = keyStamps.trim().split("\n").map(Number);
  const onDeck = (macMs) => macMs + clock.offsetMs;
  const pressToSwitch = (record) =>
    switched && record.sentAtMs !== null
      ? Math.round(onDeck(record.sentAtMs) - switched.atDeckMs)
      : null;
  const whereOn = (save, field) =>
    save.vessels?.filter((v) => v[field] === true).map((v) => v.name) ?? null;
  const verdictFor = (record, field) => {
    const outcome = outcomeOf(record);
    if (outcome !== "success") return outcome;
    const on = whereOn(early, field);
    if (on === null) return "unread";
    return on.length === 0 ? "LOST" : `on ${on.join(", ")}`;
  };

  return {
    offsetMs,
    seenVesselId: seenId ?? null,
    // The game's own word for the craft it was on, since the screen's can be a signal delay old.
    activeBefore: logBefore.newest[logBefore.newest.length - 1]?.to ?? null,
    screenShowed: seen?.name ?? null,
    switchedTo: switched?.to ?? null,
    switchesLogged: switches.length,
    keyToSwitchMs: switched
      ? Math.round(switched.atDeckMs - keyStartS * 1000)
      : null,
    keyInjectMs: Math.round((keyEndS - keyStartS) * 1000),
    rcs: {
      pressToSwitchMs: pressToSwitch(rcs.record),
      outcome: outcomeOf(rcs.record),
      verdict: verdictFor(rcs.record, "rcs"),
      onAtSettle: whereOn(early, "rcs"),
      onLate: whereOn(late, "rcs"),
      messages: rcs.record.messages,
    },
    ag1: {
      pressToSwitchMs: pressToSwitch(ag1.record),
      outcome: outcomeOf(ag1.record),
      verdict: verdictFor(ag1.record, "ag1"),
      onAtSettle: whereOn(early, "ag1"),
      onLate: whereOn(late, "ag1"),
      messages: ag1.record.messages,
    },
    baseline: baseline.vessels ?? baseline,
    saveAtSettle: early.vessels ?? early,
    saveLate: late.vessels ?? late,
  };
}

async function main() {
  const flags = parseCli(process.argv.slice(2));
  const url = flags.url ?? "ws://127.0.0.1:8090";
  const out = resolve(flags.out ?? `.renders/switch-press-sweep/${Date.now()}`);
  const offsets = (
    flags.offsets ?? "-600,-300,0,300,600,800,1200,1600,2000,2500"
  )
    .split(",")
    .map(Number);
  const repeat = Number(flags.repeat ?? 1);
  const options = {
    url,
    gapMs: Number(flags.gap ?? 300),
    settleS: Number(flags.settle ?? 2),
    lateS: Number(flags.late ?? 10),
    switchKey: flags["switch-key"] ?? "bracketright",
    saveKey: flags["save-key"] ?? "F5",
  };
  await mkdir(out, { recursive: true });

  const clock = await deckClockOffsetMs();
  const watch = new TopicWatch(url);
  watch.subscribe("vessel.identity");
  await watch.open();
  await sleep(1500);

  const summary = [
    `clock: Deck is ${Math.round(clock.offsetMs)} ms ahead of this machine (round trip ${clock.rttMs} ms)`,
    "offset  rcs press-to-switch  rcs verdict            ag1 press-to-switch  ag1 verdict            key-to-switch",
  ];
  // Out and back, which names both craft and leaves the game where it was.
  const there = await switchAndWait(options.switchKey);
  await sleep(2500);
  const back = await switchAndWait(options.switchKey);
  await sleep(2500);
  for (const trace of await linkTraces([back.to, there.to])) {
    summary.push(trace);
    console.log(trace);
  }
  for (let round = 0; round < repeat; round++) {
    for (const offsetMs of offsets) {
      const result = await trial({ ...options, watch, offsetMs, clock });
      await appendFile(
        join(out, "trials.jsonl"),
        `${JSON.stringify(result)}\n`,
      );
      const line = [
        String(offsetMs).padStart(6),
        String(result.rcs.pressToSwitchMs).padStart(19),
        `  ${result.rcs.verdict.slice(0, 22).padEnd(22)}`,
        String(result.ag1.pressToSwitchMs).padStart(19),
        `  ${result.ag1.verdict.slice(0, 22).padEnd(22)}`,
        String(result.keyToSwitchMs).padStart(13),
      ].join("");
      summary.push(line);
      console.log(line);
    }
  }
  watch.close();
  await writeFile(join(out, "summary.txt"), `${summary.join("\n")}\n`);
  console.log(`written to ${out}`);
  const lost = summary.filter((line) => line.includes("LOST")).length;
  process.exit(lost > 0 ? 1 : 0);
}

await main();
