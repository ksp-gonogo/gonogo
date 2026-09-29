#!/usr/bin/env node
/**
 * Send one command to a running Gonogo mod over its Sitrep stream, and print
 * what came back. The same `command-request` the app sends, so a rig check
 * drives the product's own command path rather than a dev-only stand-in.
 *
 *   node scripts/rig/sitrep-command.mjs <command> [argsJson] [--url <ws>] [--vantage <id>] [--timeout <s>] [--give-up <s>]
 *
 * Reaching the rig means tunnelling its port first; the mod binds 8090:
 *
 *   ssh -f -N -L 8090:127.0.0.1:8090 deck
 *
 * Putting a crewed craft on the pad, which is a control source, from a save
 * holding a craft with seats (`gonogo-rig` has `Sally-Hut 1`, all stock):
 *
 *   node scripts/rig/sitrep-command.mjs ksp.launch \
 *     '{"shipName":"Sally-Hut 1","facility":"VAB","site":"LaunchPad","crew":["Jebediah Kerman"]}'
 *
 * Every line printed is one server message as JSON: a `command-accepted` when
 * the uplink has taken the order, then the `command-response` or `error` that
 * settles it. The exit status is 0 only for a response, 1 for an error or a
 * connection that fails, and 3 for a command that stayed unconfirmed.
 *
 * No reply by `--timeout` is NOT a failure. A sent command can still run: the
 * game holds a delayed command while its clock is stopped (a KSC building open,
 * a pause) and runs it when the clock moves. So the command is reported
 * unconfirmed and the socket stays open until `--give-up`, because the late
 * reply can only come back on the connection that sent it.
 *
 * It lives in the repo rather than a scratch directory because `ws` resolves
 * from the importing file's own directory.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

/**
 * Send `command` with `args` and resolve with every message about it, ending
 * with the one that settles it (`command-response` or `error`). Messages about
 * anything else on the stream are ignored.
 *
 * Past `timeoutMs` with nothing back the command is unconfirmed: `onUnconfirmed`
 * is told, and listening goes on until `giveUpMs`, so a reply that comes late
 * still settles it, with `late` set. Only then does it resolve `unconfirmed`,
 * which says the command may yet run and nothing here will see it.
 */
export function sendCommand({
  url = "ws://127.0.0.1:8090",
  command,
  args = {},
  vantage,
  timeoutMs = 30_000,
  giveUpMs = 600_000,
  onUnconfirmed = () => {},
}) {
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const seen = [];
    let late = false;
    const socket = new WebSocket(url);
    const finish = (outcome) => {
      clearTimeout(unconfirmedTimer);
      clearTimeout(giveUpTimer);
      socket.close();
      resolve({ outcome, late, messages: seen });
    };
    const unconfirmedTimer = setTimeout(() => {
      late = true;
      onUnconfirmed();
    }, timeoutMs);
    const giveUpTimer = setTimeout(
      () => finish("unconfirmed"),
      Math.max(timeoutMs, giveUpMs),
    );
    socket.on("error", (error) => {
      seen.push({ type: "connection-error", message: String(error.message) });
      finish("connection-error");
    });
    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "command-request",
          requestId,
          command,
          label: "",
          topic: "",
          ...(vantage === undefined ? {} : { vantage }),
          args,
          sentAt: 0,
        }),
      );
    });
    socket.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message?.requestId !== requestId) return;
      seen.push(message);
      if (message.type === "command-response") finish("response");
      if (message.type === "error") finish("error");
    });
  });
}

function parseCli(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) flags[arg.slice(2)] = argv[++i];
    else positional.push(arg);
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseCli(process.argv.slice(2));
  const [command, argsJson] = positional;
  if (!command) {
    console.error(
      "usage: sitrep-command.mjs <command> [argsJson] [--url <ws>] [--vantage <id>] [--timeout <s>] [--give-up <s>]",
    );
    process.exit(2);
  }
  const { outcome, late, messages } = await sendCommand({
    url: flags.url,
    command,
    args: argsJson ? JSON.parse(argsJson) : {},
    vantage: flags.vantage,
    timeoutMs:
      flags.timeout === undefined ? undefined : Number(flags.timeout) * 1000,
    giveUpMs:
      flags["give-up"] === undefined
        ? undefined
        : Number(flags["give-up"]) * 1000,
    onUnconfirmed: () =>
      console.error(
        `${command} unconfirmed: no reply yet, it may still run; still listening`,
      ),
  });
  for (const message of messages) console.log(JSON.stringify(message));
  if (late && outcome !== "unconfirmed") {
    console.error(`${command} settled after it was reported unconfirmed`);
  }
  if (outcome === "unconfirmed") {
    console.error(
      `${command} still unconfirmed: it may yet run, and its outcome will not be seen here`,
    );
    process.exit(3);
  }
  process.exit(outcome === "response" ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
