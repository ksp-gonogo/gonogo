import { describe, expect, it, vi } from "vitest";
import type { NotesSnapshot } from "../notes/types";
import { PeerClientService } from "./PeerClientService";

describe("a station's notes list", () => {
  it("reaches a subscriber that starts listening after the host sent it", () => {
    const client = new PeerClientService();
    const snapshot: NotesSnapshot = { centreId: "ground:home", notes: [] };
    client["handleMessage"]({ type: "notes-snapshot", snapshot });
    const heard = vi.fn();
    client.onNotesSnapshot(heard);
    expect(heard).toHaveBeenCalledWith(snapshot);
  });
});
