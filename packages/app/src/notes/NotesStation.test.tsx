import { ScreenProvider } from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { type PeerClient, PeerClientProvider } from "../peer/PeerClientContext";
import { idlePeerClient } from "../test/peerFakes";
import { NotesClientService } from "./NotesClientService";
import { NotesComponent } from "./NotesComponent";
import type { Note, NotesSnapshot } from "./types";

const HOME = "ground:home";
const note = (body: string, version = 1): Note => ({
  id: body,
  body,
  order: 0,
  version,
  createdAt: 0,
  updatedAt: 0,
});

type ConnStatus = ReturnType<PeerClient["getConnStatus"]>;
type NoteResult = Parameters<Parameters<PeerClient["onNoteResult"]>[0]>[0];

/** A station link whose connection state and incoming messages a test drives. */
function stationLink(initial: ConnStatus) {
  let status: ConnStatus = initial;
  const statusListeners = new Set<(s: ConnStatus) => void>();
  const snapshotListeners = new Set<(s: NotesSnapshot) => void>();
  const resultListeners = new Set<(r: NoteResult) => void>();
  const sent: Array<{ kind: string; args: unknown[] }> = [];
  const send =
    (kind: string) =>
    (...args: unknown[]) => {
      if (status !== "connected") return false;
      sent.push({ kind, args });
      return true;
    };
  const client: PeerClient = {
    ...idlePeerClient(),
    getConnStatus: () => status,
    onConnectionStatus: (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    onNotesSnapshot: (cb) => {
      snapshotListeners.add(cb);
      return () => snapshotListeners.delete(cb);
    },
    onNoteResult: (cb) => {
      resultListeners.add(cb);
      return () => resultListeners.delete(cb);
    },
    sendNoteAdd: vi.fn(send("add")),
    sendNoteUpdate: vi.fn(send("update")),
    sendNoteDelete: vi.fn(send("delete")),
    sendNoteReorder: vi.fn(send("reorder")),
  };
  return {
    client,
    sent,
    setStatus(next: ConnStatus) {
      status = next;
      for (const cb of statusListeners) cb(next);
    },
    hear(snap: NotesSnapshot) {
      for (const cb of snapshotListeners) cb(snap);
    },
    answer(result: NoteResult) {
      for (const cb of resultListeners) cb(result);
    },
  };
}

describe("a station's notes link", () => {
  it("settles a change made with no connection as offline, without sending it", async () => {
    const link = stationLink("reconnecting");
    const service = new NotesClientService(link.client);

    await expect(service.addNote("lost?")).resolves.toEqual({
      status: "offline",
    });
    await expect(service.updateNote("a", "x", 1)).resolves.toEqual({
      status: "offline",
    });
    expect(link.sent).toEqual([]);
  });

  it("settles a change in flight as offline when the connection drops before the host answers", async () => {
    const link = stationLink("connected");
    const service = new NotesClientService(link.client);

    const outcome = service.updateNote("a", "x", 1);
    link.setStatus("reconnecting");

    await expect(outcome).resolves.toEqual({ status: "offline" });
  });

  it("settles a change with what the host answered", async () => {
    const link = stationLink("connected");
    const service = new NotesClientService(link.client);

    const outcome = service.updateNote("a", "x", 1);
    link.answer({
      type: "note-result",
      ref: "n0",
      ok: false,
      current: note("theirs", 2),
    });

    await expect(outcome).resolves.toEqual({
      status: "refused",
      current: note("theirs", 2),
    });
  });
});

describe("a station the main screen has not approved", () => {
  it("settles a note change as unapproved, not as a conflict or a deletion", async () => {
    const link = stationLink("connected");
    const service = new NotesClientService(link.client);

    const outcome = service.updateNote("a", "x", 1);
    link.answer({
      type: "note-result",
      ref: "n0",
      ok: false,
      awaitingApproval: true,
    });

    await expect(outcome).resolves.toEqual({ status: "unapproved" });
  });
});

describe("NotesComponent on a station", () => {
  const station = (link: ReturnType<typeof stationLink>) =>
    render(
      <ScreenProvider value="station">
        <PeerClientProvider client={link.client}>
          <NotesComponent id="notes-1" />
        </PeerClientProvider>
      </ScreenProvider>,
    );

  it("shows the list for its centre and sends an edit with the version shown", () => {
    const link = stationLink("connected");
    station(link);
    act(() => link.hear({ centreId: HOME, notes: [note("check fuel", 3)] }));

    fireEvent.click(screen.getByLabelText("Delete note"));

    expect(link.sent).toEqual([
      { kind: "delete", args: [expect.any(String), "check fuel", 3] },
    ]);
  });

  it("says it is not connected and keeps its list and draft when the link drops", () => {
    const link = stationLink("connected");
    station(link);
    act(() => link.hear({ centreId: HOME, notes: [note("check fuel")] }));
    const composer = screen.getByLabelText(/New note body/);
    fireEvent.change(composer, { target: { value: "half typed" } });

    act(() => link.setStatus("reconnecting"));

    expect(screen.getByText("check fuel")).toBeTruthy();
    expect((composer as HTMLInputElement).value).toBe("half typed");
    expect(composer.hasAttribute("readonly")).toBe(true);
    expect(
      composer.closest("[data-tooltip]")?.getAttribute("data-tooltip"),
    ).toBe("Not connected to the main screen");
    expect(
      screen.getByRole("button", { name: "Add" }).getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByLabelText("Delete note"));
    expect(link.sent).toEqual([]);
  });

  it("has nothing to edit until the host has told it a centre", () => {
    const link = stationLink("connected");
    station(link);
    act(() => link.hear({ centreId: null, notes: [] }));

    expect(
      screen
        .getByLabelText(/New note body/)
        .closest("[data-tooltip]")
        ?.getAttribute("data-tooltip"),
    ).toBe("No command centre chosen yet");
  });
});
