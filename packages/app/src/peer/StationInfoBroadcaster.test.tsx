import { act, render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ScopedStationIdentity } from "../stationIdentity";
import {
  type StationInfoAnnouncer,
  StationInfoBroadcaster,
} from "./StationInfoBroadcaster";

type SentInfo = { name: string; meta: { seat?: string } };

/**
 * The two calls the broadcaster makes, and nothing else. A hand-rolled stub
 * rather than a mocked module: `client` is a boundary object handed in as a
 * prop, so standing one up costs two methods and keeps the real component
 * under test.
 */
function stubClient() {
  const sent: SentInfo[] = [];
  let notify: ((status: string) => void) | undefined;
  const client: StationInfoAnnouncer = {
    sendStationInfo: (name, meta) => {
      sent.push({ name, meta: meta ?? {} });
    },
    onConnectionStatus: (cb) => {
      notify = cb as (status: string) => void;
      return () => {
        notify = undefined;
      };
    },
  };
  return {
    client,
    sent,
    reconnect: () => act(() => notify?.("connected")),
    drop: () => act(() => notify?.("disconnected")),
  };
}

function mount(seat: "mission-control" | "pilot") {
  const stub = stubClient();
  const view = render(
    <ScopedStationIdentity defaultName="Pilot">
      <StationInfoBroadcaster client={stub.client} seat={seat} />
    </ScopedStationIdentity>,
  );
  return { ...stub, view };
}

describe("StationInfoBroadcaster", () => {
  it("announces the seat it was given, so a pilot is not taken for a command centre", () => {
    const f = mount("pilot");

    expect(f.sent.at(-1)?.meta.seat).toBe("pilot");

    f.view.unmount();
  });

  it("announces mission control for a screen sitting at one", () => {
    const f = mount("mission-control");

    expect(f.sent.at(-1)?.meta.seat).toBe("mission-control");

    f.view.unmount();
  });

  it("re-announces on every reconnect, because the host forgets a peer that left", () => {
    const f = mount("pilot");
    const afterMount = f.sent.length;

    f.drop();
    f.reconnect();

    expect(f.sent.length).toBeGreaterThan(afterMount);
    expect(f.sent.at(-1)?.meta.seat).toBe("pilot");

    f.view.unmount();
  });

  it("sends once without waiting for a status change, for a peer already connected when it mounts", () => {
    /*
     * The effect can run after the connection is up, and a seat announced only
     * on the next reconnect is a seat the host does not know for the whole
     * session in between.
     */
    const f = mount("pilot");

    expect(f.sent.length).toBeGreaterThan(0);

    f.view.unmount();
  });
});
