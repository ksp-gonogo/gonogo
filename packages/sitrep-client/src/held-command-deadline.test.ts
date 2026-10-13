import type { CommandStatus } from "@ksp-gonogo/sitrep-sdk";
import { ManualClock } from "@ksp-gonogo/sitrep-server";
import { describe, expect, it } from "vitest";
import { LOSS_MARGIN, TelemetryClient } from "./client";
import { localStorageOutstandingCommands } from "./outstanding-commands-storage";
import { makeMeta, StubTransport } from "./stub-transport";

/**
 * A held command's reply and expiry arrive as game UT, and the client's clock
 * counts seconds since its page started. These hold the two apart: a save
 * months into its career, a page a few seconds old.
 */

/** Game UT of the save, far past anything a page clock reaches. */
const SAVE_UT = 5_000_000;

class ClaimingTransport extends StubTransport {
  readonly claimsAnswers = true;
}

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

function inFlight(
  status: CommandStatus | undefined,
): Extract<CommandStatus, { phase: "in-flight" }> {
  if (status?.phase !== "in-flight") {
    throw new Error(
      `expected an in-flight command, got ${status?.phase ?? "no command at all"}`,
    );
  }
  return status;
}

/** One frame of any topic, which is all the client needs to learn the game's UT. */
function gameAt(transport: StubTransport, ut: number): void {
  transport.emitRaw({
    type: "stream-data",
    topic: "time.warp",
    payload: {},
    meta: makeMeta({ validAt: ut, deliveredAt: ut }),
  });
}

function heldClient(
  options?: ConstructorParameters<typeof TelemetryClient>[2],
) {
  const transport = new ClaimingTransport();
  transport.holdCommands();
  const clock = new ManualClock(0);
  const client = new TelemetryClient(transport, clock, options);
  return { transport, clock, client };
}

function send(client: TelemetryClient) {
  const { requestId, result } = client.dispatch("vessel.staging.activate");
  const settled = result.then(
    () => "resolved",
    () => "rejected",
  );
  return { requestId, settled };
}

describe("a held command's deadline, given in game UT", () => {
  it("is timed by how far ahead of the game's UT it is, late in a save", async () => {
    const { transport, clock, client } = heldClient();
    gameAt(transport, SAVE_UT);
    const { requestId, settled } = send(client);

    transport.emitRaw({
      type: "command-accepted",
      requestId,
      predictedReplyUt: SAVE_UT + 120,
    });

    // On the client's own clock, like the dispatch-time figure it replaces.
    expect(inFlight(client.getCommand(requestId)).etaConfirm).toBe(120);

    clock.advanceTo(120 + LOSS_MARGIN - 0.001);
    expect(client.getCommand(requestId)?.phase).toBe("in-flight");

    clock.advanceTo(120 + LOSS_MARGIN);
    expect(client.getCommand(requestId)?.phase).toBe("lost");
    await expect(settled).resolves.toBe("rejected");
  });

  it("times a command with no predicted reply by its expiry", () => {
    const { transport, clock, client } = heldClient();
    gameAt(transport, SAVE_UT);
    const { requestId } = send(client);

    transport.emitRaw({
      type: "command-accepted",
      requestId,
      expiresAtUt: SAVE_UT + 600,
    });

    clock.advanceTo(600 + LOSS_MARGIN - 0.001);
    expect(client.getCommand(requestId)?.phase).toBe("in-flight");
    clock.advanceTo(600 + LOSS_MARGIN);
    expect(client.getCommand(requestId)?.phase).toBe("lost");
  });

  it("follows the game through time warp", () => {
    const { transport, clock, client } = heldClient();
    gameAt(transport, SAVE_UT);
    const { requestId } = send(client);
    transport.emitRaw({
      type: "command-accepted",
      requestId,
      predictedReplyUt: SAVE_UT + 3600,
    });

    // Ten seconds of the page, an hour and more of the game.
    clock.advanceTo(10);
    gameAt(transport, SAVE_UT + 3600 + LOSS_MARGIN);
    clock.advanceTo(20);
    expect(client.getCommand(requestId)?.phase).toBe("lost");
  });

  it("waits while the game is paused", () => {
    const { transport, clock, client } = heldClient();
    gameAt(transport, SAVE_UT);
    const { requestId } = send(client);
    transport.emitRaw({
      type: "command-accepted",
      requestId,
      predictedReplyUt: SAVE_UT + 60,
    });

    // The game stops at +30 and keeps saying so.
    for (let page = 30; page <= 300; page += 1) {
      clock.advanceTo(page);
      gameAt(transport, SAVE_UT + 30);
    }
    expect(client.getCommand(requestId)?.phase).toBe("in-flight");

    // It runs again: thirty more game seconds and the margin.
    clock.advanceTo(300 + 30 + LOSS_MARGIN);
    expect(client.getCommand(requestId)?.phase).toBe("lost");
  });

  it("keeps the deadline it had when the game's UT is not known yet", () => {
    const { transport, clock, client } = heldClient();
    client.setDelaySource(() => 4);
    const { requestId } = send(client);

    transport.emitRaw({
      type: "command-accepted",
      requestId,
      predictedReplyUt: SAVE_UT + 120,
    });

    // No frame has said what UT it is, so the game's figure cannot be placed.
    expect(inFlight(client.getCommand(requestId)).etaConfirm).toBe(8);

    // The first frame places it, and the deadline moves to the game's.
    gameAt(transport, SAVE_UT);
    expect(inFlight(client.getCommand(requestId)).etaConfirm).toBe(120);
    clock.advanceTo(8 + LOSS_MARGIN + 1);
    expect(client.getCommand(requestId)?.phase).toBe("in-flight");
    clock.advanceTo(120 + LOSS_MARGIN);
    expect(client.getCommand(requestId)?.phase).toBe("lost");
  });
});

describe("a held command read back after a reload", () => {
  it("is timed against the game's UT, not the last page's clock", () => {
    const storage = memoryStorage();
    const outstanding = () => localStorageOutstandingCommands("main", storage);

    // The last page had been open for an hour when it sent the command.
    const last = new ClaimingTransport();
    last.holdCommands();
    const lastClock = new ManualClock(3600);
    const first = new TelemetryClient(last, lastClock, {
      idPrefix: "old",
      outstanding: outstanding(),
    });
    gameAt(last, SAVE_UT);
    const { requestId, result } = first.dispatch("vessel.staging.activate");
    result.catch(() => undefined);
    last.emitRaw({
      type: "command-accepted",
      requestId,
      predictedReplyUt: SAVE_UT + 120,
    });
    first.dispose();

    // The new page starts its clock again, twenty game seconds later.
    const transport = new ClaimingTransport();
    const clock = new ManualClock(0);
    const client = new TelemetryClient(transport, clock, {
      idPrefix: "new",
      outstanding: outstanding(),
    });
    expect(client.getCommand(requestId)?.phase).toBe("in-flight");

    // Nothing is known of the game's UT until a frame arrives.
    clock.advanceTo(50);
    expect(client.getCommand(requestId)?.phase).toBe("in-flight");

    gameAt(transport, SAVE_UT + 20);
    clock.advanceTo(50 + 100 + LOSS_MARGIN - 0.001);
    expect(client.getCommand(requestId)?.phase).toBe("in-flight");
    clock.advanceTo(50 + 100 + LOSS_MARGIN);
    expect(client.getCommand(requestId)?.phase).toBe("lost");
  });

  it("gives the claim's answer the margin when the deadline passed while the page was away", () => {
    const storage = memoryStorage();
    storage.setItem(
      "gonogo.sitrep.outstandingCommands.v1.main",
      JSON.stringify([
        {
          requestId: "old-1",
          command: "vessel.staging.activate",
          args: undefined,
          label: "",
          replyDueUt: SAVE_UT + 120,
        },
      ]),
    );
    const transport = new ClaimingTransport();
    const clock = new ManualClock(0);
    const client = new TelemetryClient(transport, clock, {
      outstanding: localStorageOutstandingCommands("main", storage),
    });

    gameAt(transport, SAVE_UT + 5000);
    clock.advanceTo(LOSS_MARGIN - 0.001);
    expect(client.getCommand("old-1")?.phase).toBe("in-flight");
    clock.advanceTo(LOSS_MARGIN);
    expect(client.getCommand("old-1")?.phase).toBe("lost");
  });

  it("does not carry one page's clock reading into the next", () => {
    const storage = memoryStorage();
    const last = new ClaimingTransport();
    last.holdCommands();
    const first = new TelemetryClient(last, new ManualClock(3600), {
      idPrefix: "old",
      outstanding: localStorageOutstandingCommands("main", storage),
    });
    first.setDelaySource(() => 600);
    const { requestId, result } = first.dispatch("vessel.staging.activate");
    result.catch(() => undefined);
    first.dispose();

    const clock = new ManualClock(0);
    const client = new TelemetryClient(new ClaimingTransport(), clock, {
      idPrefix: "new",
      outstanding: localStorageOutstandingCommands("main", storage),
    });
    // Sent with the game's UT unknown, so nothing says when its reply is due.
    clock.advanceTo(LOSS_MARGIN);
    expect(client.getCommand(requestId)?.phase).toBe("lost");
  });
});
