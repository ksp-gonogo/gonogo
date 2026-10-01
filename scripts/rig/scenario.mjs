#!/usr/bin/env node
/**
 * Run one rig scenario against a live game on the Deck and the real app beside
 * it, capturing both at the same moments so a widget can be read against the
 * game's own readout.
 *
 *   node scripts/rig/scenario.mjs <scenario.mjs> [--out <dir>] [--host <deck-ip>] [--app <url> | --no-app] [--from <step>]
 *
 * The app is the dev server, started first and pointed at the Deck:
 *
 *   VITE_SITREP_HOST=<deck-ip> PORT=5273 pnpm --filter @ksp-gonogo/app dev
 *
 * A scenario is an ES module whose default export is
 *
 *   {
 *     name: "launch-and-stage",
 *     topics: ["vessel.flight", ...],      // held and snapshotted at every capture
 *     dashboards: { Flight: {items, layouts}, SpaceCenter: ... },  // seeded per scene
 *     steps: [ ... ],
 *   }
 *
 * and each step is one object, run in order:
 *
 *   { note: "text" }                                  logged only
 *   { input: "key space; sleep 1" }                   xin.py steps into the game
 *   { deck: "shell command" }                         run on the Deck (dev-tool requests)
 *   { command: "ksp.launch", args: {...}, timeoutS, giveUpS, expect, background }
 *                                                     a Sitrep command, the app's own wire path; with
 *                                                     `background: true` the run goes on and the reply
 *                                                     is logged whenever it comes
 *   { wait: "vessel.flight", until: (p) => ..., timeoutS }
 *   { sleep: 5 }
 *   { app: async (page) => {...} }                    drive the app through Playwright
 *   { capture: "name" }                               game frame, app page, side by side, and every held Topic
 *
 * Any step may carry `name`, which `--from` resumes at, and `optional: true`,
 * which records a failure and carries on instead of stopping the run.
 *
 * Rig only: it needs a Deck, and nothing in CI runs it.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { gameFrame, input, ssh, verifyInputReaches } from "./deck.mjs";
import { sendCommand } from "./sitrep-command.mjs";
import { TopicWatch } from "./topics.mjs";

const APP_VIEWPORT = { width: 1600, height: 1000 };

function parseCli(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key.startsWith("no-")) {
      flags[key.slice(3)] = false;
      continue;
    }
    flags[key] = argv[++i];
  }
  return { positional, flags };
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Seeds the app before its first script runs: the Deck as the Sitrep host, no boot modals, and the scenario's dashboards. */
function seedScript({ host, port, dashboards }) {
  const entries = [
    ["gonogo.datasource.sitrep", JSON.stringify({ host, port })],
    ["gonogo.analytics.consent", "disabled"],
    ["gonogo.uplinkHubWizard.firstRunSeen", "1"],
    ...Object.entries(dashboards ?? {}).map(([scene, config]) => [
      `gonogo:dashboard:main:${scene}`,
      JSON.stringify(config),
    ]),
  ];
  return { entries };
}

async function composite(page, gamePng, appPng, dest, title) {
  const [game, app] = await Promise.all([readFile(gamePng), readFile(appPng)]);
  const html = `<!doctype html><body style="margin:0;background:#111;color:#ddd;font:14px monospace">
    <div style="padding:6px 10px">${title}</div>
    <div style="display:flex;gap:8px;align-items:flex-start;padding:0 8px 8px">
      <figure style="margin:0"><figcaption>game</figcaption><img style="width:1280px" src="data:image/png;base64,${game.toString("base64")}"></figure>
      <figure style="margin:0"><figcaption>app</figcaption><img style="width:1600px" src="data:image/png;base64,${app.toString("base64")}"></figure>
    </div></body>`;
  await page.setViewportSize({ width: 2904, height: 1100 });
  await page.setContent(html);
  await page.screenshot({ path: dest, fullPage: true });
}

async function main() {
  const { positional, flags } = parseCli(process.argv.slice(2));
  const [scenarioPath] = positional;
  if (!scenarioPath) {
    console.error(
      "usage: scenario.mjs <scenario.mjs> [--out <dir>] [--host <deck-ip>] [--app <url> | --no-app] [--from <step>]",
    );
    process.exit(2);
  }
  const scenario = (await import(pathToFileURL(resolve(scenarioPath)).href))
    .default;
  const host = flags.host ?? process.env.RIG_HOST ?? "192.168.86.33";
  const port = Number(process.env.RIG_SITREP_PORT ?? 8090);
  const appUrl =
    flags.app === false ? null : (flags.app ?? "http://localhost:5273/");
  const out = resolve(
    flags.out ?? join("local_docs", "rig-runs", `${scenario.name}-${stamp()}`),
  );
  await mkdir(out, { recursive: true });
  const logPath = join(out, "log.jsonl");
  const log = async (entry) => {
    const line = { at: new Date().toISOString(), ...entry };
    console.log(JSON.stringify(line));
    await appendFile(logPath, `${JSON.stringify(line)}\n`);
  };

  // #759: a scenario with `input` steps is worthless if XTest stopped
  // reaching the game, and it fails silently (every step "succeeds", nothing
  // in the game moves) unless something checks first. Skip only for a
  // scenario that never sends input, or with --no-input-check (driving the
  // Sitrep command surface deliberately, input known broken).
  const usesInput = (scenario.steps ?? []).some(
    (step) => step.input !== undefined,
  );
  if (usesInput && flags["input-check"] !== false) {
    const result = await verifyInputReaches(out);
    await log({ inputCheck: "passed", openedFraction: result.openedFraction });
  }

  const watch = new TopicWatch(`ws://${host}:${port}`);
  for (const topic of scenario.topics ?? []) watch.subscribe(topic);
  await watch.open();

  const browser = appUrl ? await chromium.launch() : null;
  const context = browser
    ? await browser.newContext({ viewport: APP_VIEWPORT })
    : null;
  const page = context ? await context.newPage() : null;
  if (context && page) {
    await context.addInitScript(
      ({ entries }) => {
        for (const [key, value] of entries) localStorage.setItem(key, value);
      },
      seedScript({ host, port, dashboards: scenario.dashboards }),
    );
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      void log({ appConsoleError: message.text().slice(0, 600) });
    });
    page.on(
      "pageerror",
      (error) => void log({ appPageError: String(error).slice(0, 600) }),
    );
    // What the app asks the mod for, so a subscription it should or should not make is on the record.
    page.on("websocket", (socket) => {
      socket.on("framesent", (frame) => {
        void appendFile(
          join(out, "app-ws-sent.jsonl"),
          `${JSON.stringify({ at: new Date().toISOString(), frame: String(frame.payload) })}\n`,
        );
      });
    });
    await page.goto(appUrl);
  }
  const sheet = browser ? await browser.newPage() : null;

  let started = flags.from === undefined;
  let failures = 0;
  const background = [];
  for (const [index, step] of scenario.steps.entries()) {
    const label = step.name ?? `${index}`;
    if (!started && step.name === flags.from) started = true;
    if (!started) continue;
    try {
      await runStep(step, {
        watch,
        page,
        sheet,
        out,
        log,
        label,
        host,
        port,
        background,
      });
    } catch (error) {
      failures++;
      await log({
        step: label,
        failed: String(error.message ?? error).slice(0, 1200),
      });
      if (page)
        await page
          .screenshot({ path: join(out, `fail-${label}-app.png`) })
          .catch(() => {});
      await gameFrame(join(out, `fail-${label}-game.png`)).catch(() => {});
      if (!step.optional) break;
    }
  }

  for (const outcome of await Promise.allSettled(background)) {
    if (outcome.status === "rejected") {
      failures++;
      await log({
        backgroundFailed: String(outcome.reason?.message ?? outcome.reason),
      });
    }
  }
  watch.close();
  await browser?.close();
  await log({ done: scenario.name, failures, out });
  process.exit(failures === 0 ? 0 : 1);
}

async function runStep(step, context) {
  const { watch, page, sheet, out, log, label, host, port, background } =
    context;
  if (step.note !== undefined) {
    await log({ step: label, note: step.note });
    return;
  }
  if (step.input !== undefined) {
    await input(step.input);
    await log({ step: label, input: step.input });
    return;
  }
  if (step.deck !== undefined) {
    const stdout = await ssh(step.deck, (step.timeoutS ?? 60) * 1000);
    await log({
      step: label,
      deck: step.deck,
      stdout: stdout.trim().slice(0, 1200),
    });
    return;
  }
  if (step.sleep !== undefined) {
    await new Promise((done) => setTimeout(done, step.sleep * 1000));
    return;
  }
  if (step.wait !== undefined) {
    const began = Date.now();
    const payload = await watch.waitFor(
      step.wait,
      step.until ?? (() => true),
      (step.timeoutS ?? 60) * 1000,
    );
    await log({
      step: label,
      wait: step.wait,
      afterMs: Date.now() - began,
      payload: JSON.stringify(payload).slice(0, 600),
    });
    return;
  }
  if (step.command !== undefined && step.background) {
    background.push(runStep({ ...step, background: false }, context));
    await log({ step: label, command: step.command, background: "sent" });
    return;
  }
  if (step.command !== undefined) {
    const began = Date.now();
    let unconfirmedAfterMs = null;
    const result = await sendCommand({
      url: `ws://${host}:${port}`,
      command: step.command,
      args: step.args ?? {},
      timeoutMs: (step.timeoutS ?? 30) * 1000,
      giveUpMs: (step.giveUpS ?? 60) * 1000,
      onUnconfirmed: () => {
        unconfirmedAfterMs = Date.now() - began;
      },
    });
    await log({
      step: label,
      command: step.command,
      outcome: result.outcome,
      late: result.late,
      unconfirmedAfterMs,
      afterMs: Date.now() - began,
      messages: result.messages,
    });
    if (step.expect && result.outcome !== step.expect) {
      throw new Error(
        `${step.command}: expected ${step.expect}, got ${result.outcome}`,
      );
    }
    return;
  }
  if (step.app !== undefined) {
    if (!page) throw new Error("an app step with --no-app");
    await step.app(page, { watch });
    await log({ step: label, app: "ok" });
    return;
  }
  if (step.capture !== undefined) {
    const base = join(out, step.capture);
    // Together, so the two halves are as close to one instant as the SSH round trip allows.
    const topics = JSON.stringify(watch.snapshot(), null, 2);
    await Promise.all([
      gameFrame(`${base}-game.png`),
      page?.screenshot({ path: `${base}-app.png` }),
    ]);
    await writeFile(`${base}-topics.json`, topics);
    if (page && sheet)
      await composite(
        sheet,
        `${base}-game.png`,
        `${base}-app.png`,
        `${base}-side-by-side.png`,
        step.capture,
      );
    await log({ step: label, capture: step.capture });
    return;
  }
  throw new Error(
    `step ${label} names no known kind: ${JSON.stringify(Object.keys(step))}`,
  );
}

await main();
