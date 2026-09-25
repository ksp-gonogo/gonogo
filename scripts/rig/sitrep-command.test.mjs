/**
 * `sendCommand` against a local stand-in for the mod's stream: it must send
 * the request the app sends, settle on the reply that names its request, and
 * ignore every other message on the stream.
 *
 *   node --test scripts/rig/sitrep-command.test.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import { sendCommand } from "./sitrep-command.mjs";

async function standIn(reply) {
  const server = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => server.on("listening", resolve));
  const received = [];
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const request = JSON.parse(String(data));
      received.push(request);
      reply(socket, request);
    });
  });
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    received,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("sends the app's command-request and settles on its own response", async () => {
  const server = await standIn((socket, request) => {
    socket.send(JSON.stringify({ type: "stream-data", topic: "time.warp" }));
    socket.send(
      JSON.stringify({ type: "command-response", requestId: "someone-else" }),
    );
    socket.send(
      JSON.stringify({
        type: "command-accepted",
        requestId: request.requestId,
        oneWaySeconds: 0,
      }),
    );
    socket.send(
      JSON.stringify({
        type: "command-response",
        requestId: request.requestId,
        result: { success: true },
      }),
    );
  });
  try {
    const args = { shipName: "Sally-Hut 1", crew: ["Jebediah Kerman"] };
    const { outcome, messages } = await sendCommand({
      url: server.url,
      command: "ksp.launch",
      args,
    });
    assert.equal(outcome, "response");
    assert.deepEqual(
      messages.map((m) => m.type),
      ["command-accepted", "command-response"],
    );
    const [request] = server.received;
    assert.equal(request.type, "command-request");
    assert.equal(request.command, "ksp.launch");
    assert.deepEqual(request.args, args);
    assert.equal(request.sentAt, 0);
    assert.equal("vantage" in request, false);
  } finally {
    await server.close();
  }
});

test("settles on an error naming its request", async () => {
  const server = await standIn((socket, request) => {
    socket.send(
      JSON.stringify({
        type: "error",
        requestId: request.requestId,
        code: "NOT_FOUND",
        message: "no such craft",
      }),
    );
  });
  try {
    const { outcome } = await sendCommand({
      url: server.url,
      command: "ksp.launch",
    });
    assert.equal(outcome, "error");
  } finally {
    await server.close();
  }
});

test("times out when nothing settles it", async () => {
  const server = await standIn(() => {});
  try {
    const { outcome } = await sendCommand({
      url: server.url,
      command: "ksp.launch",
      timeoutMs: 200,
    });
    assert.equal(outcome, "timeout");
  } finally {
    await server.close();
  }
});
