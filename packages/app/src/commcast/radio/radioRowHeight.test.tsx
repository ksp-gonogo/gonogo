/**
 * The audio controls sit in one bar, and they have to be one height.
 *
 * They were three: the key and the mute are small toggles sized by a 14px glyph
 * and a 2px inset, the transmission light is a bordered readout sized by its own
 * 6px one, and the microphone disclosure is a third. Nothing declared a height,
 * so each control ended up as tall as whatever happened to be inside it and the
 * bar came out ragged.
 *
 * jsdom lays nothing out, so what is asserted here is the DECLARATION every one
 * of them now carries: one shared control height from the kit, resolved through
 * the real styled-components cascade. A row where each control names the same
 * height cannot go ragged; a row where none of them names one always can.
 */
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { RadioIndicator } from "./RadioIndicator";
import { RadioMute } from "./RadioMute";
import { RadioPtt } from "./RadioPtt";
import type { RadioControl } from "./useRadio";

const CONTROL: RadioControl = {
  transmitting: false,
  opening: false,
  amplitudes: [],
  reception: { live: [], backlogSeconds: 0, droppedChunks: 0 },
  unavailable: null,
  fault: null,
  toggle: () => {},
  isMuted: () => false,
  setMuted: () => {},
  inputDeviceId: null,
  setInputDevice: () => {},
};

describe("the audio controls share one height", () => {
  it("declares the same control height on the key, the mute and the transmission light", () => {
    const { container } = render(
      <>
        <RadioPtt radio={CONTROL} />
        <RadioMute muted={false} threadName="Ares 4" onToggle={() => {}} />
        <RadioIndicator live={[]} nameFor={(id) => id} onOpen={() => {}} />
      </>,
    );
    const talk = screen.getByRole("button", { name: "Talk" });
    const mute = screen.getByRole("button", { name: "Mute Ares 4" });
    const light = container.querySelector("[data-tone]") as HTMLElement;

    const heights = [talk, mute, light].map(
      (el) => getComputedStyle(el).minHeight,
    );
    // Not merely equal: three controls that all declare NOTHING are equal too
    // (they compute to `auto` alike), and that is the state this exists to
    // fail, so the shared floor has to be a real one.
    expect(heights[0]).not.toBe("auto");
    expect(heights[0]).not.toBe("");
    expect(new Set(heights).size).toBe(1);
  });
});
