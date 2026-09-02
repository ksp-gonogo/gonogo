import {
  act,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { RP1_TOOLING_REFIT_COMMAND, ToolingSection } from "./Tooling";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const CARRIED = ["rp1.available", "rp1.tooling", RP1_TOOLING_REFIT_COMMAND];

function mount(tooling: Record<string, unknown>) {
  const stream = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 1000,
  });
  const result = render(
    <stream.Provider>
      <ToolingSection />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  act(() => {
    stream.emit("rp1.available", true, { validAt: 1000 });
    stream.emit("rp1.tooling", tooling, { validAt: 1000 });
  });
  return { ...stream, container: result.container };
}

/** One untooled part with two owned sizes it could be reshaped onto. */
function payload(part: Record<string, unknown> = {}) {
  return {
    toolAllCost: 9000,
    untooledCount: 1,
    parts: [
      {
        partTitle: "Procedural Tank",
        toolingType: "Tank-Sep-1",
        toolingTypeTitle: "Separate tank",
        parameterSummary: "3.400m x 5.200m",
        tooled: false,
        toolingCost: 9000,
        untooledSurcharge: 4100,
        partId: "part-1",
        symmetryCounterparts: 1,
        refittable: true,
        refitTargets: [
          { diameter: 3, length: 5, rfType: "Tank-Sep-1" },
          { diameter: 3.6, length: 6, rfType: "Tank-Sep-1" },
        ],
        ...part,
      },
    ],
  };
}

async function openRefit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", {
      name: "Refit Procedural Tank to a size the career already owns",
    }),
  );
}

describe("refitting a part onto tooling the career already owns", () => {
  it("sends the size and the material RP-1's own picker chose", async () => {
    const user = userEvent.setup();
    const { container, transport } = mount(payload());
    await openRefit(user);

    await user.click(
      await screen.findByRole("button", {
        name: "Refit Procedural Tank to d=3.000m, L=5.000m in Tank-Sep-1",
      }),
    );

    /*
     * The material is the producer's answer, not the client's: PickRfType is what
     * decides whether the part can use a tooling at all, tech locks included, and
     * a client guessing at it would offer a refit RP-1 refuses.
     */
    expect(
      transport.sentCommands.find(
        (c) => c.command === RP1_TOOLING_REFIT_COMMAND,
      )?.args,
    ).toEqual({
      diameter: 3,
      length: 5,
      partId: "part-1",
      rfType: "Tank-Sep-1",
    });
    await expectNoA11yViolations(container);
  });

  /*
   * The spend statement, and for this command it is that there ISN'T one.
   * ToolingPartResizer.Resize changes geometry and a tank type and touches no
   * currency anywhere: read on the shipped RP-1 v4.6.0.0 RP0.dll. So what the
   * control says is what the operator GAINS, which is the per-build surcharge
   * that stops being charged.
   */
  it("says it spends nothing, and names the per-build charge it drops", async () => {
    const user = userEvent.setup();
    const { container } = mount(payload());
    await openRefit(user);

    await waitFor(() => {
      expect(container.textContent).toMatch(/costs nothing|spends nothing/i);
    });
    expect(container.textContent).toContain("4,100");
  });

  it("says how many other parts the refit takes with it, before the press", async () => {
    const user = userEvent.setup();
    const { container } = mount(payload());
    await openRefit(user);

    /*
     * RP-1 resizes every symmetry counterpart and applies the material to the
     * part's whole GROUP, and discloses both AFTERWARDS in a screen message. The
     * count is on the wire so it can be said while it can still change the
     * answer.
     */
    await waitFor(() => {
      expect(container.textContent).toMatch(/1 other part|symmetry/i);
    });
  });

  it("offers nothing when the career owns no size this part could move to", async () => {
    const user = userEvent.setup();
    mount(payload({ refitTargets: [] }));

    await waitFor(() => {
      expect(screen.getByText("TOOLING")).toBeInTheDocument();
    });
    /*
     * EMPTY is a real answer and it is not the same as null: the career owns
     * nothing to move to, so buying the tooling is the only way to close the gap
     * and a control offering no options would be a dead expander.
     */
    expect(
      screen.queryByRole("button", {
        name: "Refit Procedural Tank to a size the career already owns",
      }),
    ).not.toBeInTheDocument();
    expect(user).toBeDefined();
  });

  it("offers nothing where RP-1 does not answer the question", async () => {
    mount(payload({ refitTargets: undefined }));

    await waitFor(() => {
      expect(screen.getByText("TOOLING")).toBeInTheDocument();
    });
    // Null: a part already tooled, one nothing can reshape, or a tooling type
    // RP-1 offers no refit for. None of the three is a control.
    expect(
      screen.queryByRole("button", {
        name: "Refit Procedural Tank to a size the career already owns",
      }),
    ).not.toBeInTheDocument();
  });
});
