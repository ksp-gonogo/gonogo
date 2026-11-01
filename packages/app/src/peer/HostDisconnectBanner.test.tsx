import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { HostDisconnectBanner } from "./HostDisconnectBanner";
import type { ConnStatus, PeerClientService } from "./PeerClientService";

function link() {
  let listener: (status: ConnStatus) => void = () => {};
  const client: Pick<PeerClientService, "onConnectionStatus"> = {
    onConnectionStatus: (cb) => {
      listener = cb;
      return () => {};
    },
  };
  return {
    client,
    set: (next: ConnStatus) => {
      act(() => listener(next));
    },
  };
}

describe("the banner for a station's link to its host", () => {
  it("says nothing while connected", () => {
    render(<HostDisconnectBanner client={link().client} />);
    expect(screen.queryByText(/HOST/)).toBeNull();
  });

  it("keeps saying the link is down through every state the retry loop passes through", () => {
    const { client, set } = link();
    render(<HostDisconnectBanner client={client} />);
    set("reconnecting");
    expect(screen.getByText("RECONNECTING TO HOST...")).toBeInTheDocument();
    set("connecting");
    expect(screen.getByText("RECONNECTING TO HOST...")).toBeInTheDocument();
    set("idle");
    expect(screen.getByText("RECONNECTING TO HOST...")).toBeInTheDocument();
    set("connected");
    expect(screen.queryByText(/HOST/)).toBeNull();
  });

  it("escalates once the station gives up", () => {
    const { client, set } = link();
    render(<HostDisconnectBanner client={client} />);
    set("disconnected");
    expect(screen.getByText("HOST DISCONNECTED")).toBeInTheDocument();
  });
});
