import { act, renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeAudioInput, useAudioInput } from "./useAudioInput";

/**
 * The parts of the state machine the drawn picker does not reach:
 * `release()`, and what a request carries when the caller supplied
 * constraints of its own. Everything here talks to a stubbed
 * `navigator.mediaDevices`, never to a device.
 */

class FakeTrack {
  stopped = false;
  constructor(private readonly deviceId: string) {}
  stop(): void {
    this.stopped = true;
  }
  getSettings(): { deviceId: string } {
    return { deviceId: this.deviceId };
  }
  readonly label = "Built-in Microphone";
}

function fakeMediaDevices() {
  const opened: Array<{ getTracks(): FakeTrack[] }> = [];
  const requests: MediaTrackConstraints[] = [];
  const media = {
    opened,
    requests,
    getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
      requests.push(constraints.audio as MediaTrackConstraints);
      const track = new FakeTrack("built-in");
      const stream = {
        getTracks: () => [track],
        getAudioTracks: () => [track],
      };
      opened.push(stream);
      return stream;
    }),
    enumerateDevices: vi.fn(async () => [
      {
        kind: "audioinput" as const,
        deviceId: "built-in",
        label: "Built-in Microphone",
        groupId: "group",
      },
    ]),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(globalThis, "isSecureContext", {
    value: true,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: media,
    configurable: true,
    writable: true,
  });
  return media;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "isSecureContext");
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("useAudioInput", () => {
  it("releases the capture without giving up the granted access", async () => {
    const media = fakeMediaDevices();
    const onStream = vi.fn();
    const { result } = renderHook(() => useAudioInput({ onStream }));
    await act(async () => {});

    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe("ready");

    act(() => {
      result.current.release();
    });

    expect(result.current.status).toBe("unasked");
    expect(result.current.stream).toBeNull();
    expect(onStream).toHaveBeenLastCalledWith(null);
    expect(media.opened[0].getTracks()[0].stopped).toBe(true);
    /*
     * The label survives the release, and that is the difference between this
     * state and the one before the first request: a populated label is the
     * browser's own evidence that access is granted, which is what the picker
     * branches its copy on.
     */
    expect(result.current.devices[0].label).toBe("Built-in Microphone");
  });

  it("carries the caller's constraints into the request", async () => {
    const media = fakeMediaDevices();
    const { result } = renderHook(() =>
      useAudioInput({
        constraints: { channelCount: 1, noiseSuppression: true },
      }),
    );
    await act(async () => {});

    await act(async () => {
      await result.current.select("built-in");
    });

    expect(media.requests[0]).toEqual({
      channelCount: 1,
      noiseSuppression: true,
      deviceId: { exact: "built-in" },
    });
  });
});

describe("describeAudioInput", () => {
  it("uses the browser's label when there is one", () => {
    expect(describeAudioInput({ deviceId: "a", label: "Headset" }, 0)).toBe(
      "Headset",
    );
  });

  it("numbers a device whose name the browser withheld", () => {
    expect(describeAudioInput({ deviceId: "a", label: "" }, 1)).toBe(
      "Input 2, name withheld",
    );
  });
});
