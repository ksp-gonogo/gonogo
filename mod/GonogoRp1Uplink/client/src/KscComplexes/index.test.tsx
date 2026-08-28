import {
  act,
  getAugmentsForSlot,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { KscComplexes, RP1_COMPLEX_RUSH_COMMAND } from "./index";

const TOPICS = ["rp1.available", "rp1.complexes", RP1_COMPLEX_RUSH_COMMAND];

const COMPLEXES = [
  {
    engineers: 18,
    isOperational: true,
    isRushing: false,
    kscName: "Cape",
    lcId: "lc-1",
    lcType: "Pad",
    maxEngineers: 60,
    name: "LC-1",
  },
  {
    engineers: 6,
    isOperational: true,
    isRushing: false,
    kscName: "Cape",
    lcId: "lc-2",
    lcType: "Pad",
    maxEngineers: 40,
    name: "LC-2",
  },
];

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <KscComplexes />
    </fixture.Provider>,
  );
  return { fixture, view };
}

function withComplexes(rows: readonly Record<string, unknown>[] = COMPLEXES) {
  const mounted = mount();
  act(() => {
    mounted.fixture.emit("rp1.available", true);
    mounted.fixture.emit("rp1.complexes", rows);
  });
  return mounted;
}

describe("KscComplexes", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("rushes a whole complex on one press, and says the mode is per complex", async () => {
    const user = userEvent.setup();
    const { fixture } = withComplexes();

    // One press, unlike the vehicle controls in Vehicle Assembly, and the
    // difference is real: rushing spends nothing when it lands. It raises the
    // rate and doubles the salary, so the cost arrives later as payroll.
    await user.click(
      await screen.findByRole("button", {
        name: "Rush work at LC-1, at double the salary",
      }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_COMPLEX_RUSH_COMMAND,
    );
    // The COMPLEX, never a vehicle: IsRushing is a bool on the launch complex,
    // so a per-vehicle rush would be a lie about what the game does.
    expect(sent?.args).toEqual({ lcId: "lc-1", rushing: true });
  });

  it("offers the way out of rush mode to a complex already in it", async () => {
    const user = userEvent.setup();
    const { fixture } = withComplexes([
      { ...COMPLEXES[0], isRushing: true },
      COMPLEXES[1],
    ]);

    await waitFor(() => {
      expect(screen.getByText("RUSHING")).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: "Stop rushing work at LC-1" }),
    );

    // A SET and not a toggle on the wire: the command carries the state asked
    // for, so it lands on that state however stale the view it was pressed
    // from.
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_COMPLEX_RUSH_COMMAND,
      )?.args,
    ).toEqual({ lcId: "lc-1", rushing: false });
  });

  it("offers a rush control for every complex, idle ones included", async () => {
    const { view } = withComplexes();

    await waitFor(() => {
      // The row is named for the COMPLEX. "LC-1 rush" read as a second thing
      // called LC-1 rush that happened to have a rush button beside it; what
      // the press does is the button's own job to say.
      expect(
        screen.getByRole("button", { name: /Rush work at LC-1/ }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("LC-1")).toBeInTheDocument();
    expect(screen.queryByText("LC-1 rush")).not.toBeInTheDocument();
    // An idle complex is exactly the one worth taking OUT of rush mode, so a
    // control drawn only beside vehicles would hide the useful half. This
    // section holds no vehicles at all, which is the point of the split.
    expect(screen.getByText("LC-2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Rush work at LC-2/ }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(view.container);
  });

  it("lists no vehicles: those moved to Vehicle Assembly", async () => {
    // The half of the split that is easy to half-do. This section answers what
    // infrastructure the career has and how it is run; a craft named here would
    // put the same card in two widgets.
    withComplexes();

    await waitFor(() => {
      expect(screen.getByText("LAUNCH COMPLEXES")).toBeInTheDocument();
    });
    expect(screen.queryByText("IN THE WAREHOUSE")).not.toBeInTheDocument();
    expect(screen.queryByText("UNDER INTEGRATION")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /[Bb]uild/ }),
    ).not.toBeInTheDocument();
  });

  it("draws nothing at all for a career with no launch complexes", async () => {
    // Not an empty heading: RP-1 gives a fresh career its complexes with the
    // space centre, so an empty list is the Uplink not having answered rather
    // than a career state worth a sentence.
    const { view } = withComplexes([]);

    await waitFor(() => {
      expect(view.container).toBeEmptyDOMElement();
    });
  });

  it("registers itself into the space centre's section slot", () => {
    const ids = getAugmentsForSlot("space-center-status.sections").map(
      (a) => a.id,
    );
    expect(ids).toContain("rp1-ksc-complexes");
  });
});
