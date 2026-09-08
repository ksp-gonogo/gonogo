import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { CommSignalAntennaTargets } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

/**
 * `comms.delay` is carried because `useCommand` reads its one-way delay off it,
 * and a targeting command is delayed. A fixture without it reports every vantage
 * as instant.
 */
const CARRIED = ["realantennas.antennas", "comms.delay"];

/** One antenna as the mod publishes it, hydrated the way the decode path leaves it. */
function antenna(overrides: Record<string, unknown> = {}) {
  return {
    antennaId: "4021/0",
    index: 0,
    name: "HG-55 High Gain Antenna",
    steerable: true,
    targeted: true,
    gain: value("dB", 34.5),
    techLevel: value("count", 4),
    beamwidth: value("°", 2.5),
    cone3Db: value("°", 1.25),
    cone10Db: value("°", 2.5),
    minimumDistance: value("m", 22903),
    targetKind: "BodyLatLonAlt",
    targetLabel: "Kerbin:(0.00:0.00:-600000)",
    targetBodyName: "Kerbin",
    availableTargetModes: ["BodyCenter", "AzEl"],
    meta: { source: "vessel:1", quality: 1 },
    ...overrides,
  };
}

function mount() {
  const stream = setupStreamFixture({ carriedChannels: CARRIED });
  const result = render(
    <stream.Provider>
      <CommSignalAntennaTargets />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { ...stream, container: result.container };
}

/**
 * Emits and waits, because delivery is asynchronous: the sample reaches the
 * store after the emit returns, so a synchronous assertion would read the
 * pending state on every test here.
 */
async function emit(
  stream: ReturnType<typeof mount>,
  antennas: ReturnType<typeof antenna>[],
) {
  act(() => {
    stream.emit("realantennas.antennas", antennas);
  });
  await screen.findByLabelText("Antenna targeting");
}

describe("the antenna targeting section", () => {
  it("renders nothing until the craft reports an antenna", () => {
    const { container } = mount();

    expect(container.textContent).toBe("");
  });

  it("renders nothing for a craft whose antenna list is empty", async () => {
    const stream = mount();
    act(() => {
      stream.emit("realantennas.antennas", []);
    });

    expect(stream.container.textContent).toBe("");
  });

  it("names each antenna and what it is aimed at", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);

    expect(screen.getByText("HG-55 High Gain Antenna")).toBeTruthy();
    expect(screen.getByText("Kerbin:(0.00:0.00:-600000)")).toBeTruthy();
  });

  it("says so when a steerable antenna holds no target", async () => {
    const stream = mount();
    await emit(stream, [
      antenna({ targeted: false, targetKind: null, targetLabel: null }),
    ]);

    expect(screen.getByText("Not aimed")).toBeTruthy();
  });

  /**
   * A card per antenna, because RealAntennas stores one target per antenna with
   * no arbitration: two dishes aimed two ways are two candidate links, not a
   * conflict, so one control for the craft would be a lie about the model.
   */
  it("gives every antenna its own controls", async () => {
    const stream = mount();
    await emit(stream, [
      antenna(),
      antenna({
        antennaId: "4022/0",
        index: 1,
        name: "Communotron 88-88",
        targeted: false,
        targetKind: null,
        targetLabel: null,
      }),
    ]);

    expect(screen.getAllByLabelText("Mode")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /AIM/ })).toHaveLength(2);
  });

  /**
   * An omni cannot hold a target at all, so it gets the row and no controls.
   * Showing it a disabled AIM would suggest the capability exists and is
   * momentarily unavailable.
   */
  it("gives an omni antenna no targeting controls", async () => {
    const stream = mount();
    await emit(stream, [
      antenna({
        antennaId: "4030/0",
        name: "Communotron 16",
        steerable: false,
        targeted: false,
        targetKind: null,
        targetLabel: null,
        availableTargetModes: [],
      }),
    ]);

    expect(screen.getByText("Communotron 16")).toBeTruthy();
    expect(screen.getByText("Omni")).toBeTruthy();
    expect(screen.queryByLabelText("Mode")).toBeNull();
  });

  // ── The tech-level gate, both directions ─────────────────────────────────
  //
  // RealAntennas' own gate is advisory: only its window filters the mode list,
  // while the property setter checks nothing. Our refusal is therefore the only
  // one an operator meets, so it has to be visible rather than an option that
  // silently is not there.

  it("shows a mode the antenna has not earned, marked locked and unselectable", async () => {
    const stream = mount();
    await emit(stream, [
      antenna({ availableTargetModes: ["BodyCenter", "AzEl"] }),
    ]);

    const locked = screen.getByRole("option", { name: "Vessel (locked)" });
    expect((locked as HTMLOptionElement).disabled).toBe(true);
  });

  it("leaves an earned mode selectable and unlabelled", async () => {
    const stream = mount();
    await emit(stream, [
      antenna({ availableTargetModes: ["BodyCenter", "AzEl"] }),
    ]);

    const unlocked = screen.getByRole("option", {
      name: "Azimuth / elevation",
    });
    expect((unlocked as HTMLOptionElement).disabled).toBe(false);
  });

  /**
   * The gate is CONFIG, not code: Realism Overhaul moves three of the five
   * levels, so the same antenna offers a different set on a different install.
   * The card reads what the mod published rather than a table of its own.
   */
  it("follows the install's own mode list rather than a fixed one", async () => {
    const stream = mount();
    await emit(stream, [
      antenna({
        availableTargetModes: [
          "Vessel",
          "BodyCenter",
          "BodyLatLonAlt",
          "AzEl",
          "OrbitRelative",
        ],
      }),
    ]);

    expect(
      (screen.getByRole("option", { name: "Vessel" }) as HTMLOptionElement)
        .disabled,
    ).toBe(false);
    expect(screen.queryByRole("option", { name: /locked/ })).toBeNull();
  });

  /** Each mode asks for its own arguments and no others. */
  it("swaps the argument fields with the mode", async () => {
    const stream = mount();
    await emit(stream, [
      antenna({
        availableTargetModes: ["BodyCenter", "AzEl", "OrbitRelative"],
      }),
    ]);

    expect(screen.getByLabelText("Body")).toBeTruthy();
    expect(screen.queryByLabelText("Az °")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Mode"), "AzEl");

    expect(screen.getByLabelText("Az °")).toBeTruthy();
    expect(screen.getByLabelText("El °")).toBeTruthy();
    expect(screen.queryByLabelText("Body")).toBeNull();
  });

  /**
   * The section carries no explanatory line at all. It reports what each
   * antenna is and where it points; a sentence teaching what aiming costs is
   * the operator's to know, not the panel's to say.
   */
  it("explains nothing", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);

    expect(screen.queryByText(/drops outside its beam/)).toBeNull();
  });

  /**
   * An omni is labelled because nothing else on its card says why it has no
   * controls. A dish is not: the controls are the mark, and a badge repeating
   * it was decoration.
   */
  it("labels an omni and leaves a dish unbadged", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);

    expect(screen.queryByText("Dish")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const stream = mount();
    await emit(stream, [
      antenna(),
      antenna({
        antennaId: "4030/0",
        name: "Communotron 16",
        steerable: false,
        targeted: false,
        targetKind: null,
        targetLabel: null,
        availableTargetModes: [],
      }),
    ]);

    await expectNoA11yViolations(stream.container);
  });
});

/**
 * `steerable` and `targeted` are three-valued: null is the mod saying it could
 * not read the antenna, which the card used to draw as the reassuring half of a
 * two-valued flag. An antenna nobody could read was badged "Omni" and had its
 * targeting controls hidden, both of them claims about hardware nobody had
 * looked at.
 */
describe("an antenna whose flags could not be read", () => {
  /** The unreadable case as the mod publishes it: the flags absent, the rest present. */
  function unread(overrides: Record<string, unknown> = {}) {
    return antenna({
      antennaId: "4040/0",
      name: "HG-5 High Gain Antenna",
      steerable: null,
      targeted: null,
      targetKind: null,
      targetLabel: null,
      availableTargetModes: [],
      ...overrides,
    });
  }

  it("is not called an omni", async () => {
    const stream = mount();
    await emit(stream, [unread()]);

    expect(screen.getByText("HG-5 High Gain Antenna")).toBeTruthy();
    expect(screen.queryByText("Omni")).toBeNull();
  });

  /**
   * No controls, because the mod refuses both commands for this antenna too, so
   * a live AIM would be a press that provably goes nowhere. What it must not do
   * is hide them silently: that is the omni's presentation, and it reads as a
   * settled fact about the hardware.
   */
  it("has no targeting controls, and says why not", async () => {
    const stream = mount();
    await emit(stream, [unread()]);

    expect(screen.queryByLabelText("Mode")).toBeNull();
    expect(screen.queryByRole("button", { name: /AIM/ })).toBeNull();
    expect(
      screen.getByText(/would not say whether this antenna can be aimed/),
    ).toBeTruthy();
  });

  /** "Not aimed" is a statement about the dish, reserved for a dish that said so. */
  it("does not report an unread target as not aimed", async () => {
    const stream = mount();
    await emit(stream, [antenna({ targeted: null, targetLabel: null })]);

    expect(screen.queryByText("Not aimed")).toBeNull();
    expect(screen.getByText("Could not be read")).toBeTruthy();
  });

  /** The dish keeps its controls: only the unread flag holds them. */
  it("leaves a readable dish beside it untouched", async () => {
    const stream = mount();
    await emit(stream, [antenna(), unread()]);

    expect(screen.getAllByLabelText("Mode")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /AIM/ })).toHaveLength(1);
  });

  it("has no accessibility violations", async () => {
    const stream = mount();
    await emit(stream, [unread()]);

    await expectNoA11yViolations(stream.container);
  });
});
