#!/usr/bin/env node
/**
 * Hold one socket to the mod, optionally seated at a named command centre, and
 * write every frame it receives as one JSON line with the wall-clock instant it
 * arrived. A rig check reads the file afterwards, so the evidence is the wire
 * itself rather than a summary of it.
 *
 *   node scripts/rig/record.mjs --out <file.jsonl> --topics a,b,c [--vantage <centreId>] [--url <ws>] [--seconds <n>]
 *
 * Each line is `{ recvMs, msg }`. A `set-vantage` refusal arrives as an `error`
 * frame and is recorded like any other. Without `--seconds` it runs until killed.
 */
import { appendFileSync } from "node:fs";
import WebSocket from "ws";

const flags = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
}
if (!flags.out || !flags.topics) {
  console.error(
    "usage: record.mjs --out <file.jsonl> --topics a,b,c [--vantage <id>] [--url <ws>] [--seconds <n>]",
  );
  process.exit(2);
}

const write = (msg) =>
  appendFileSync(flags.out, `${JSON.stringify({ recvMs: Date.now(), msg })}\n`);

const socket = new WebSocket(flags.url ?? "ws://127.0.0.1:8090");
socket.on("open", () => {
  write({ type: "recorder-open", vantage: flags.vantage ?? null });
  if (flags.vantage) {
    socket.send(
      JSON.stringify({ type: "set-vantage", centreId: flags.vantage }),
    );
  }
  for (const topic of flags.topics.split(",")) {
    socket.send(JSON.stringify({ type: "subscribe", topic }));
  }
});
socket.on("message", (data) => {
  try {
    write(JSON.parse(String(data)));
  } catch {
    write({ type: "unparsed", text: String(data).slice(0, 400) });
  }
});
socket.on("close", () => {
  write({ type: "recorder-close" });
  process.exit(0);
});
socket.on("error", (error) => {
  write({ type: "recorder-error", message: String(error.message) });
  process.exit(1);
});
if (flags.seconds) {
  setTimeout(() => socket.close(), Number(flags.seconds) * 1000);
}
