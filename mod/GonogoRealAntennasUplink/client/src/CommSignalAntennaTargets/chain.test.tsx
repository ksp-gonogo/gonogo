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
 * `comms.delay` is carried because the chain command is delayed like the two
 * single-target ones, and `useCommand` reads its one-way delay off that channel.
 */
const CARRIED = [
  "realantennas.antennas",
  "realantennas.antennaChains",
  "comms.delay",
];

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
    availableTargetModes: ["BodyCenter", "AzEl", "BodyLatLonAlt"],
    meta: { source: "vessel:1", quality: 1 },
    ...overrides,
  };
}

/** One chain as the mod publishes it, hydrated the way the decode path leaves it. */
function chain(overrides: Record<string, unknown> = {}) {
  return {
    antennaId: "4021/0",
    steps: [
      { mode: "BodyCenter" },
      {
        mode: "BodyLatLonAlt",
        bodyName: "Mun",
        latitude: value("°", -0.5),
        longitude: value("°", 121.25),
        altitude: value("m", 1500),
      },
    ],
    activeStep: undefined,
    state: "holding",
    detail: undefined,
    settleSeconds: value("s", 30),
    lastAppliedUt: undefined,
    laps: value("count", 0),
    connected: true,
    carrying: true,
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

async function emit(
  stream: ReturnType<typeof mount>,
  antennas: ReturnType<typeof antenna>[],
  chains: ReturnType<typeof chain>[] = [],
) {
  act(() => {
    stream.emit("realantennas.antennas", antennas);
    stream.emit("realantennas.antennaChains", chains);
  });
  await screen.findByLabelText("Antenna targeting");
}

describe("an antenna with no fallback chain", () => {
  it("says so rather than showing an empty list", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);

    expect(screen.getByText("None set")).toBeTruthy();
    expect(screen.queryByLabelText(/^Fallback chain for/)).toBeNull();
  });

  /**
   * A clear is the same command with an empty list, so it must not be offered
   * where there is nothing to clear: a press that provably does nothing reads as
   * a control that failed.
   */
  it("is offered no clear, there being nothing to clear", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);

    expect(screen.queryByRole("button", { name: /CLEAR CHAIN/ })).toBeNull();
  });
});

describe("an antenna holding a fallback chain", () => {
  it("lists the entries in the order the craft tries them", async () => {
    const stream = mount();
    await emit(stream, [antenna()], [chain()]);

    const entries = screen
      .getByLabelText("Fallback chain for HG-55 High Gain Antenna")
      .querySelectorAll("li");
    expect(entries).toHaveLength(2);
    expect(entries[0].textContent).toContain("Body centre");
    expect(entries[1].textContent).toContain("Surface point");
    expect(entries[1].textContent).toContain("Mun");
  });

  /**
   * Each coordinate renders through the unit renderer rather than as a bare
   * number, which is what the nested hydration on this channel exists for: a
   * latitude and an altitude side by side are otherwise two indistinguishable
   * numbers.
   */
  it("renders each entry's coordinates with their units", async () => {
    const stream = mount();
    await emit(stream, [antenna()], [chain()]);

    const entry = screen
      .getByLabelText("Fallback chain for HG-55 High Gain Antenna")
      .querySelectorAll("li")[1];
    expect(entry.textContent).toContain("°");
    expect(entry.textContent).toContain("m");
  });

  it("names the walk's state in words rather than the wire's own token", async () => {
    const stream = mount();
    await emit(stream, [antenna()], [chain({ state: "walking" })]);

    expect(screen.getByText("Walking")).toBeTruthy();
    expect(screen.queryByText("walking")).toBeNull();
  });

  /**
   * The entry currently in place is marked, because the list alone cannot say
   * which of five targets the dish is actually on, and that is the first thing
   * an operator looking at a walking chain wants.
   */
  it("marks the entry the antenna is aimed at now", async () => {
    const stream = mount();
    await emit(
      stream,
      [antenna()],
      [chain({ state: "walking", activeStep: value("count", 1) })],
    );

    const entries = screen
      .getByLabelText("Fallback chain for HG-55 High Gain Antenna")
      .querySelectorAll("li");
    expect(entries[0].textContent).not.toContain("aimed here now");
    expect(entries[1].textContent).toContain("aimed here now");
  });

  /**
   * A walk that has never started has no active entry, and nothing is marked.
   * That is the resting state of a working fallback, so marking the first entry
   * would claim the chain had moved the dish when it had not.
   */
  it("marks nothing while the walk has never started", async () => {
    const stream = mount();
    await emit(stream, [antenna()], [chain()]);

    const list = screen.getByLabelText(
      "Fallback chain for HG-55 High Gain Antenna",
    );
    expect(list.textContent).not.toContain("aimed here now");
  });

  it("shows the craft's own reason when the walk cannot act", async () => {
    const stream = mount();
    await emit(
      stream,
      [antenna()],
      [
        chain({
          state: "blocked",
          connected: false,
          detail: "This craft is not loaded, so the chain is held until it is.",
        }),
      ],
    );

    expect(screen.getByText(/This craft is not loaded/)).toBeTruthy();
  });

  /**
   * The lap count is the number that says the chain has stopped being a
   * fallback and become a search, so it appears once it is not zero and stays
   * out of the way when it is.
   */
  it("reports full passes with no link, and only once there are any", async () => {
    const stream = mount();
    await emit(stream, [antenna()], [chain()]);
    expect(screen.queryByText(/passes with no link/)).toBeNull();

    act(() => {
      stream.emit("realantennas.antennaChains", [
        chain({ state: "walking", connected: false, laps: value("count", 3) }),
      ]);
    });

    expect(await screen.findByText("3 full passes with no link")).toBeTruthy();
  });

  it("says how long each target gets before the next is tried", async () => {
    const stream = mount();
    await emit(stream, [antenna()], [chain()]);

    expect(
      screen.getByText(/to produce a link before the craft tries the next/),
    ).toBeTruthy();
  });

  it("offers a clear once the craft says it is holding something", async () => {
    const stream = mount();
    await emit(stream, [antenna()], [chain()]);

    expect(screen.getByRole("button", { name: /CLEAR CHAIN/ })).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    const stream = mount();
    await emit(
      stream,
      [antenna()],
      [chain({ state: "walking", activeStep: value("count", 1) })],
    );

    await expectNoA11yViolations(stream.container);
  });
});

describe("composing a chain", () => {
  /**
   * The staging list is separate from what the craft is holding, and has to be:
   * the command rides light-time, so for as long as it is in flight the list the
   * operator built and the list the craft holds are two different things, and
   * showing them as one would make a chain look armed the moment it was pressed.
   */
  it("stages the target the aim controls are composing, without sending it", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);

    await userEvent.click(
      screen.getByRole("button", { name: "ADD TARGET ABOVE" }),
    );

    const staged = screen.getByLabelText(
      "Chain being composed for HG-55 High Gain Antenna",
    );
    expect(staged.querySelectorAll("li")).toHaveLength(1);
    expect(staged.textContent).toContain("Body centre");
    expect(screen.getByText("None set")).toBeTruthy();
  });

  it("offers the send only once something has been staged", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);
    expect(screen.queryByRole("button", { name: /SET CHAIN/ })).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "ADD TARGET ABOVE" }),
    );

    expect(screen.getByRole("button", { name: /SET CHAIN/ })).toBeTruthy();
  });

  it("drops the last staged entry on request", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);
    const add = screen.getByRole("button", { name: "ADD TARGET ABOVE" });
    await userEvent.click(add);
    await userEvent.click(add);

    await userEvent.click(screen.getByRole("button", { name: "REMOVE LAST" }));

    expect(
      screen
        .getByLabelText("Chain being composed for HG-55 High Gain Antenna")
        .querySelectorAll("li"),
    ).toHaveLength(1);
  });

  /**
   * A staged entry takes whatever the mode selector is on, so the aim controls
   * are the one place a target is described. Two sets of fields saying the same
   * thing is how they drift.
   */
  it("takes the mode the aim controls are currently on", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);

    await userEvent.selectOptions(
      screen.getByLabelText("Mode"),
      "BodyLatLonAlt",
    );
    await userEvent.type(screen.getByLabelText("Lat °"), "12.5");
    await userEvent.type(screen.getByLabelText("Lon °"), "-60.25");
    await userEvent.click(
      screen.getByRole("button", { name: "ADD TARGET ABOVE" }),
    );

    const staged = screen.getByLabelText(
      "Chain being composed for HG-55 High Gain Antenna",
    );
    expect(staged.textContent).toContain("Surface point");
    expect(staged.textContent).toContain("12.5");
    expect(staged.textContent).toContain("-60.25");
  });

  /**
   * A draft entry's numbers are plain, because a command carries plain numbers,
   * so the staging list has to mint them into quantities to render them. If it
   * did not, a staged latitude would print bare beside a held one that printed
   * with its unit.
   */
  it("renders a staged entry's coordinates with their units, like a held one", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);

    await userEvent.selectOptions(
      screen.getByLabelText("Mode"),
      "BodyLatLonAlt",
    );
    await userEvent.type(screen.getByLabelText("Lat °"), "12.5");
    await userEvent.type(screen.getByLabelText("Lon °"), "-60.25");
    await userEvent.click(
      screen.getByRole("button", { name: "ADD TARGET ABOVE" }),
    );

    expect(
      screen.getByLabelText("Chain being composed for HG-55 High Gain Antenna")
        .textContent,
    ).toContain("°");
  });

  it("has no accessibility violations with a staged entry", async () => {
    const stream = mount();
    await emit(stream, [antenna()]);
    await userEvent.click(
      screen.getByRole("button", { name: "ADD TARGET ABOVE" }),
    );

    await expectNoA11yViolations(stream.container);
  });
});

describe("an antenna that cannot be aimed", () => {
  /**
   * No chain controls on an omni. The whole feature is about where a dish is
   * pointed, and the mod refuses a chain entry for an antenna it will not
   * confirm is steerable, so a live control here would be a press that provably
   * goes nowhere.
   */
  it("is offered no chain controls at all", async () => {
    const stream = mount();
    await emit(stream, [antenna({ steerable: false, targeted: false })]);

    expect(screen.queryByText("Fallback chain")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "ADD TARGET ABOVE" }),
    ).toBeNull();
  });

  it("is offered none when its shape could not be read either", async () => {
    const stream = mount();
    await emit(stream, [antenna({ steerable: null, targeted: null })]);

    expect(screen.queryByText("Fallback chain")).toBeNull();
  });
});
