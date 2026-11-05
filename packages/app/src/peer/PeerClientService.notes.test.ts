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

describe("a seated station's broker id", () => {
  it("names the seat's own station key when the peer is opened", async () => {
    const { getStationKey } = await import("./stationPeerId");
    const svc = new PeerClientService({ seat: "pilot" });
    svc.connect("abcd");
    const own = getStationKey(undefined, "pilot");
    const main = getStationKey();
    expect(own).not.toBe(main);
    const id = svc["stationPeerId"];
    expect(id.startsWith(`station-${own}-`)).toBe(true);
    svc.disconnect();
  });
});
