import { describe, expect, it } from "vitest";
import { encodeFrames, FrameReader, MAX_FRAME_BYTES } from "./endpointFraming";
import { EndpointHostLink } from "./endpointHostLink";

/** Enough RTCPeerConnection and RTCDataChannel to drive the link's events by hand. */
function fakes() {
  const sent: Uint8Array[] = [];
  const channel = Object.assign(new EventTarget(), {
    binaryType: "blob",
    send: (f: Uint8Array) => sent.push(f),
    close() {
      channel.dispatchEvent(new Event("close"));
    },
  });
  const descriptions: RTCSessionDescriptionInit[] = [];
  const pc = {
    localDescription: null as RTCSessionDescriptionInit | null,
    createDataChannel: () => channel,
    createOffer: async () => ({ type: "offer", sdp: "v=offer" }),
    setLocalDescription: async (d: RTCSessionDescriptionInit) => {
      pc.localDescription = d;
    },
    setRemoteDescription: async (d: RTCSessionDescriptionInit) => {
      descriptions.push(d);
    },
    close: () => {},
  };
  const deliver = (frame: Uint8Array) => {
    const e = new MessageEvent("message", { data: frame.slice().buffer });
    channel.dispatchEvent(e);
  };
  const link = new EndpointHostLink(
    "gonogo-host-ABCD",
    () => pc as unknown as RTCPeerConnection,
  );
  return { link, channel, sent, descriptions, deliver };
}

describe("a station's link through the endpoint", () => {
  it("offers at once and applies the endpoint's answer", async () => {
    const { link, descriptions } = fakes();
    expect(await link.createOffer()).toBe("v=offer");
    await link.accept("v=answer");
    expect(descriptions).toEqual([{ type: "answer", sdp: "v=answer" }]);
  });

  it("opens with the data channel, sends framed messages and reads them back", () => {
    const { link, channel, sent, deliver } = fakes();
    const got: unknown[] = [];
    link.on("data", (d) => got.push(d));
    link.send({ type: "dropped" });
    expect(sent).toHaveLength(0);
    channel.dispatchEvent(new Event("open"));
    expect(link.open).toBe(true);
    link.send({ type: "station-credential", credential: "c" });
    expect(new FrameReader().push(sent[0] as Uint8Array)).toEqual({
      type: "station-credential",
      credential: "c",
    });
    for (const f of encodeFrames({ type: "hello" })) deliver(f);
    expect(got).toEqual([{ type: "hello" }]);
  });

  it("counts every piece of a large message", () => {
    const { link, channel, deliver } = fakes();
    channel.dispatchEvent(new Event("open"));
    let pieces = 0;
    link.onPiece = () => {
      pieces += 1;
    };
    const frames = encodeFrames({
      data: new Uint8Array(MAX_FRAME_BYTES * 2).buffer,
    });
    for (const f of frames) deliver(f);
    expect(pieces).toBe(frames.length);
  });

  it("reports close once, whether the channel or the station ends it", () => {
    const { link, channel } = fakes();
    let closes = 0;
    link.on("close", () => {
      closes += 1;
    });
    channel.dispatchEvent(new Event("open"));
    link.close();
    channel.dispatchEvent(new Event("close"));
    expect(closes).toBe(1);
    expect(link.open).toBe(false);
  });
});
