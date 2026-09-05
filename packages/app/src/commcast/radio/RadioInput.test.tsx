/**
 * Choosing the microphone the key transmits from.
 *
 * `AudioInputPicker` has its own suite in the kit; what this asserts is the
 * WIRING, which is the half that was missing: that the panel offers the
 * operator a real labelled control, that a device they select is reported as
 * the one that actually OPENED rather than the one that was asked for, and that
 * the radio's own capture constraints are the ones auditioned.
 *
 * The whole of `navigator.mediaDevices` is stubbed. A microphone cannot be
 * opened in jsdom or in CI, which is the same reason `RadioBackend` exists.
 */
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RadioInput } from "./RadioInput";

interface StubDevice {
  deviceId: string;
  label: string;
}

const DEVICES: StubDevice[] = [
  { deviceId: "builtin", label: "Built-in Microphone" },
  { deviceId: "headset", label: "Comms Headset" },
];

let asked: MediaStreamConstraints[] = [];
/** Which device `getUserMedia` will report having opened, whatever was asked
 *  for. A browser is free to honour a constraint loosely, and it does. */
let opens = "builtin";

/**
 * The stream a stubbed `getUserMedia` hands back.
 *
 * Only what the code under test reads, and not a `MediaStream`: the real
 * interface carries two dozen members none of this exercises, and asserting a
 * plain object into it would hide the day one of those members starts being
 * read. `navigator.mediaDevices` is installed through `defineProperty`, which
 * takes its value untyped, so nothing needs the wider type.
 */
function stubStream(deviceId: string) {
  const track = {
    kind: "audio",
    label: DEVICES.find((d) => d.deviceId === deviceId)?.label ?? "",
    stop: () => {},
    getSettings: () => ({ deviceId }),
  };
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  };
}

beforeEach(() => {
  asked = [];
  opens = "builtin";
  Object.defineProperty(globalThis, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: () =>
        Promise.resolve(
          DEVICES.map((d) => ({ ...d, kind: "audioinput", groupId: "" })),
        ),
      getUserMedia: (constraints: MediaStreamConstraints) => {
        asked.push(constraints);
        return Promise.resolve(stubStream(opens));
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the microphone picker on the radio", () => {
  it("offers a labelled control once access is granted", async () => {
    const user = userEvent.setup();
    render(<RadioInput id="mic" deviceId={null} onChoose={() => {}} />);

    await user.click(
      screen.getByRole("button", { name: "Request microphone access" }),
    );
    const select = await screen.findByRole("combobox", { name: "Microphone" });
    expect(select).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Comms Headset" }),
    ).toBeInTheDocument();
  });

  it("auditions the input through the radio's own capture constraints", async () => {
    /*
     * A picker that opened a raw stream would let an operator choose on the
     * strength of a level the radio never sends: echo cancellation and gain
     * control change what a microphone sounds like considerably.
     */
    const user = userEvent.setup();
    render(<RadioInput id="mic" deviceId={null} onChoose={() => {}} />);
    await user.click(
      screen.getByRole("button", { name: "Request microphone access" }),
    );
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0].audio).toMatchObject({
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it("opens the remembered device on the first request", async () => {
    // Otherwise a screen that already knows the operator's headset would open
    // the room's microphone and then have to be corrected.
    const user = userEvent.setup();
    render(<RadioInput id="mic" deviceId="headset" onChoose={() => {}} />);
    await user.click(
      screen.getByRole("button", { name: "Request microphone access" }),
    );
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0].audio).toMatchObject({ deviceId: { exact: "headset" } });
  });

  it("reports the device that OPENED, not the one that was asked for", async () => {
    /*
     * A browser may honour a `deviceId` loosely, and remembering the request
     * would write down a choice the operator never actually got. The track's
     * own settings are the only account of what is running.
     */
    const onChoose = vi.fn();
    const user = userEvent.setup();
    opens = "headset";
    render(<RadioInput id="mic" deviceId={null} onChoose={onChoose} />);
    await user.click(
      screen.getByRole("button", { name: "Request microphone access" }),
    );
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith("headset"));
  });

  it("keeps the remembered device when the panel closes", async () => {
    /*
     * Unmounting releases the audition stream, which the picker reports as a
     * null stream. That is the panel closing, not a choice being withdrawn.
     */
    const onChoose = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <RadioInput id="mic" deviceId={null} onChoose={onChoose} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Request microphone access" }),
    );
    await waitFor(() => expect(onChoose).toHaveBeenCalledTimes(1));
    unmount();
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalledWith(null);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <RadioInput id="mic" deviceId={null} onChoose={() => {}} />,
    );
    await expectNoA11yViolations(container);
  });
});
