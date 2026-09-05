import { act, fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioInputPicker } from "./AudioInputPicker";

/**
 * No microphone is involved anywhere in this file. `navigator.mediaDevices` is
 * the whole browser boundary the component talks to, so it is stubbed at that
 * boundary and everything above it (the state machine, the copy, the stream
 * handoff, the track teardown) is the real thing.
 *
 * The stub answers the way a browser does rather than the way the component
 * would find convenient: labels are empty until a capture succeeds, a refusal
 * is a `DOMException` with the name the spec gives it, and `devicechange` is
 * an event rather than a callback.
 */

class FakeTrack {
  stopped = false;
  constructor(
    readonly label: string,
    private readonly deviceId: string,
  ) {}
  stop(): void {
    this.stopped = true;
  }
  getSettings(): { deviceId: string } {
    return { deviceId: this.deviceId };
  }
}

class FakeStream {
  constructor(readonly track: FakeTrack) {}
  getTracks(): FakeTrack[] {
    return [this.track];
  }
  getAudioTracks(): FakeTrack[] {
    return [this.track];
  }
}

interface FakeDevice {
  deviceId: string;
  label: string;
}

class FakeMediaDevices {
  /** What `enumerateDevices` reports. Labels stay empty until a grant. */
  present: FakeDevice[] = [];
  /** Set to make the next `getUserMedia` reject with this exception name. */
  refuseWith: string | null = null;
  granted = false;
  readonly opened: FakeStream[] = [];
  readonly requests: MediaTrackConstraints[] = [];
  private readonly listeners = new Set<() => void>();

  getUserMedia = vi.fn(
    async (constraints: MediaStreamConstraints): Promise<FakeStream> => {
      this.requests.push(constraints.audio as MediaTrackConstraints);
      if (this.refuseWith !== null) {
        const name = this.refuseWith;
        this.refuseWith = null;
        throw new DOMException(`stubbed ${name}`, name);
      }
      this.granted = true;
      const wanted = (constraints.audio as { deviceId?: { exact?: string } })
        ?.deviceId?.exact;
      const device =
        this.present.find((d) => d.deviceId === wanted) ?? this.present[0];
      const stream = new FakeStream(
        new FakeTrack(device?.label ?? "", device?.deviceId ?? ""),
      );
      this.opened.push(stream);
      return stream;
    },
  );

  enumerateDevices = vi.fn(async () =>
    this.present.map((device) => ({
      kind: "audioinput" as const,
      deviceId: device.deviceId,
      label: this.granted ? device.label : "",
      groupId: "group",
    })),
  );

  addEventListener(type: string, listener: () => void): void {
    if (type === "devicechange") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "devicechange") this.listeners.delete(listener);
  }

  async emitDeviceChange(): Promise<void> {
    await act(async () => {
      for (const listener of this.listeners) listener();
    });
  }
}

function install(media: FakeMediaDevices | undefined): void {
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
}

function twoDevices(): FakeMediaDevices {
  const media = new FakeMediaDevices();
  media.present = [
    { deviceId: "built-in", label: "Built-in Microphone" },
    { deviceId: "headset", label: "Comms Headset" },
  ];
  return media;
}

/** Render, then let the mount-time enumeration settle inside `act`. */
async function mountPicker(
  props: Parameters<typeof AudioInputPicker>[0] = {},
): Promise<ReturnType<typeof render>> {
  const result = render(<AudioInputPicker {...props} />);
  await act(async () => {});
  return result;
}

async function grant(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: /request microphone/i }),
    );
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "isSecureContext");
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("AudioInputPicker", () => {
  it("names the origin, not the permission, on an insecure page", async () => {
    Object.defineProperty(globalThis, "isSecureContext", {
      value: false,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: new FakeMediaDevices(),
      configurable: true,
      writable: true,
    });
    await mountPicker();

    expect(screen.getByRole("status")).toHaveTextContent(
      "This page is not a secure origin",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the browser when there is no media device interface", async () => {
    install(undefined);
    await mountPicker();

    expect(screen.getByRole("status")).toHaveTextContent(
      "no media device interface",
    );
  });

  it("counts the inputs it can see and says why they are unnamed", async () => {
    install(twoDevices());
    await mountPicker();

    expect(screen.getByRole("status")).toHaveTextContent(
      "has not been requested",
    );
    expect(screen.getByText(/2 audio inputs are visible/i)).toHaveTextContent(
      "withheld by the browser until access is granted",
    );
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("opens a stream, names the device and hands the stream back", async () => {
    const media = twoDevices();
    install(media);
    const onStream = vi.fn();
    await mountPicker({ onStream });

    await grant();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Capturing from Built-in Microphone",
    );
    expect(onStream).toHaveBeenCalledWith(media.opened[0]);
    const picker = screen.getByRole("combobox", { name: /audio input/i });
    expect(picker).toHaveValue("built-in");
    expect(
      screen.getByRole("option", { name: "Comms Headset" }),
    ).toBeInTheDocument();
  });

  it("switches device on selection and stops the stream it replaces", async () => {
    const media = twoDevices();
    install(media);
    const onStream = vi.fn();
    await mountPicker({ onStream });
    await grant();

    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "headset" },
      });
    });

    expect(media.requests[1]).toMatchObject({ deviceId: { exact: "headset" } });
    expect(media.opened[0].track.stopped).toBe(true);
    expect(media.opened[1].track.stopped).toBe(false);
    expect(onStream).toHaveBeenLastCalledWith(media.opened[1]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Capturing from Comms Headset",
    );
  });

  it("keeps the running input when the one it was asked to switch to will not open", async () => {
    const media = twoDevices();
    install(media);
    await mountPicker();
    await grant();

    media.refuseWith = "NotReadableError";
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "headset" },
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Capturing from Built-in Microphone",
    );
    expect(screen.getByText(/NotReadableError/)).toHaveTextContent(
      "the previous input is still running",
    );
    expect(media.opened[0].track.stopped).toBe(false);
  });

  it("reports a refusal as held by the browser, and offers no second press", async () => {
    const media = twoDevices();
    media.refuseWith = "NotAllowedError";
    install(media);
    await mountPicker();

    await grant();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("was refused for this origin");
    expect(status).toHaveTextContent("without prompting");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("tells an absent device apart from a refusal", async () => {
    const media = new FakeMediaDevices();
    media.refuseWith = "NotFoundError";
    install(media);
    await mountPicker();

    await grant();

    expect(screen.getByRole("status")).toHaveTextContent(
      "No audio input device is present.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the browser's own error when a permitted device will not open, and stays askable", async () => {
    const media = twoDevices();
    media.refuseWith = "NotReadableError";
    install(media);
    await mountPicker();

    await grant();

    expect(screen.getByRole("status")).toHaveTextContent(
      "The browser reported NotReadableError",
    );
    expect(
      screen.getByRole("button", { name: /request microphone/i }),
    ).toBeEnabled();
  });

  it("falls back to a numbered name rather than a blank row", async () => {
    const media = new FakeMediaDevices();
    media.present = [{ deviceId: "anonymous", label: "" }];
    install(media);
    await mountPicker();

    await grant();

    expect(
      screen.getByRole("option", { name: "Input 1, name withheld" }),
    ).toBeInTheDocument();
  });

  it("follows the device list down to nothing when the input is unplugged", async () => {
    const media = twoDevices();
    install(media);
    const onStream = vi.fn();
    await mountPicker({ onStream });
    await grant();

    media.present = [];
    await media.emitDeviceChange();

    expect(screen.getByRole("status")).toHaveTextContent(
      "No audio input device is present.",
    );
    expect(media.opened[0].track.stopped).toBe(true);
    expect(onStream).toHaveBeenLastCalledWith(null);
  });

  it("ends the capture, without claiming there is nothing left, when the open device alone goes", async () => {
    const media = twoDevices();
    install(media);
    const onStream = vi.fn();
    await mountPicker({ onStream });
    await grant();

    media.present = [{ deviceId: "headset", label: "Comms Headset" }];
    await media.emitDeviceChange();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Microphone access is granted for this origin. No input is open.",
    );
    expect(media.opened[0].track.stopped).toBe(true);
    expect(onStream).toHaveBeenLastCalledWith(null);
    expect(
      screen.getByRole("button", { name: /request microphone/i }),
    ).toBeEnabled();
  });

  it("stops the capture when it unmounts", async () => {
    const media = twoDevices();
    install(media);
    const onStream = vi.fn();
    const { unmount } = await mountPicker({ onStream });
    await grant();

    unmount();

    expect(media.opened[0].track.stopped).toBe(true);
    expect(onStream).toHaveBeenLastCalledWith(null);
  });

  it("has no axe violations before or after access is granted", async () => {
    const media = twoDevices();
    install(media);
    const { container } = await mountPicker();

    await expectNoA11yViolations(container);
    await grant();
    await expectNoA11yViolations(container);
  });
});
