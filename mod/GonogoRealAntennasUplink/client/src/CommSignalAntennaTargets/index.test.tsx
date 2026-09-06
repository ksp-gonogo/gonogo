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
   * The cost, stated once. An unaimed dish takes no pointing loss at all and an
   * aimed one loses the link outright once the far end leaves the beam, so a
   * card that presented aiming as a pure gain would be misleading.
   */
  it("says what aiming costs", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);

    expect(screen.getByText(/drops outside its beam/)).toBeTruthy();
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
