import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { CommitLayer, REGIME_TONE } from "./CommitLayer";

const live = {
  // These cases are about which instruction the hero shows; the refusal is covered in `stale.test.tsx`.
  mayInstruct: true,
  regime: "live" as const,
  live: true,
  suicideBurnCountdown: 8,
  commitInSeconds: null,
  committed: false,
};

describe("CommitLayer", () => {
  it("shows the ignition countdown as the hero when live", () => {
    render(<CommitLayer {...live} />);
    expect(screen.getByText("SUICIDE BURN")).toBeInTheDocument();
  });

  describe("with no engine to burn", () => {
    it("says nothing of a burn: no countdown caption and no best-burn impact line", () => {
      render(<CommitLayer {...live} engine={false} impactSpeed={12} />);
      expect(screen.queryByText("SUICIDE BURN")).toBeNull();
      expect(screen.queryByText("BURN GO IN")).toBeNull();
      expect(screen.queryByText("BEST-BURN IMPACT")).toBeNull();
    });

    it("says nothing of a burn under delay either", () => {
      render(
        <CommitLayer
          {...live}
          regime="staged"
          live={false}
          commitInSeconds={14}
          engine={false}
        />,
      );
      expect(screen.queryByText("BURN GO IN")).toBeNull();
      expect(screen.queryByText("BEST-BURN IMPACT")).toBeNull();
    });

    it("holds the same one row before and after the touchdown, so LANDED arriving moves nothing below it", () => {
      const { container, rerender } = render(
        <CommitLayer {...live} engine={false} />,
      );
      const rows = () => container.querySelectorAll("[role=status] > *").length;
      const before = rows();
      expect(before).toBe(1);
      expect(screen.queryByText("LANDED")).toBeNull();
      rerender(<CommitLayer {...live} engine={false} landed />);
      expect(rows()).toBe(before);
    });

    describe("its parachutes", () => {
      const chute = (
        deployment: string | null,
        safety: string | null = null,
        fullDeployAltitude: number | null = null,
      ) => ({
        deployment,
        safety,
        fullDeployAltitude:
          fullDeployAltitude === null ? null : value("m", fullDeployAltitude),
      });

      it.each([
        ["none", "NO PARACHUTE"],
        ["stowed", "CHUTE STOWED"],
        ["armed", "CHUTE ARMED"],
        ["semi-deployed", "CHUTE SEMI-DEPLOYED"],
        ["deployed", "CHUTE DEPLOYED"],
        ["cut", "CHUTE CUT"],
      ])("says a %s parachute in the headline row", (deployment, words) => {
        render(
          <CommitLayer
            {...live}
            engine={false}
            parachute={chute(deployment)}
          />,
        );
        expect(screen.getByText(words)).toBeInTheDocument();
      });

      it("says whether opening it now is safe while it is not yet open, and the height it opens fully at", () => {
        const { container } = render(
          <CommitLayer
            {...live}
            engine={false}
            parachute={chute("armed", "unsafe", 1000)}
          />,
        );
        expect(container.querySelector("[role=status]")?.textContent).toContain(
          "CHUTE ARMED UNSAFE TO OPEN · FULL AT 1 km",
        );
      });

      it("keeps the one row in every parachute state, so nothing below moves", () => {
        const { container, rerender } = render(
          <CommitLayer {...live} engine={false} parachute={chute(null)} />,
        );
        const rows = () =>
          container.querySelectorAll("[role=status] > *").length;
        expect(rows()).toBe(1);
        for (const d of ["armed", "semi-deployed", "deployed"]) {
          rerender(
            <CommitLayer
              {...live}
              engine={false}
              parachute={chute(d, "safe", 1000)}
            />,
          );
          expect(rows()).toBe(1);
        }
      });

      it("says nothing of a parachute it has no reading for, and LANDED once down", () => {
        const { rerender } = render(
          <CommitLayer {...live} engine={false} parachute={chute(null)} />,
        );
        expect(screen.queryByText(/CHUTE|PARACHUTE/)).toBeNull();
        rerender(
          <CommitLayer
            {...live}
            engine={false}
            landed
            parachute={chute("deployed")}
          />,
        );
        expect(screen.getByText("LANDED")).toBeInTheDocument();
        expect(screen.queryByText("CHUTE DEPLOYED")).toBeNull();
      });
    });

    it("still says LANDED once down", () => {
      render(<CommitLayer {...live} engine={false} landed />);
      expect(screen.getByText("LANDED")).toBeInTheDocument();
      expect(screen.queryByText("BEST-BURN IMPACT")).toBeNull();
    });

    it("keeps the rows for a craft that has an engine, and when it is not said", () => {
      const { rerender } = render(<CommitLayer {...live} engine />);
      expect(screen.getByText("BEST-BURN IMPACT")).toBeInTheDocument();
      rerender(<CommitLayer {...live} />);
      expect(screen.getByText("BEST-BURN IMPACT")).toBeInTheDocument();
    });
  });

  describe("while the engines are lit", () => {
    it("reads BURNING in place of the countdown, keeping the best-burn impact line", () => {
      render(<CommitLayer {...live} burning impactSpeed={0} />);
      expect(screen.getByText("BURNING")).toBeInTheDocument();
      expect(screen.queryByText("SUICIDE BURN")).toBeNull();
      expect(screen.getByText("BEST-BURN IMPACT")).toBeInTheDocument();
    });

    it("reads BURNING in place of the burn-GO clock under delay too", () => {
      render(
        <CommitLayer
          {...live}
          regime="staged"
          live={false}
          commitInSeconds={14}
          burning
        />,
      );
      expect(screen.getByText("BURNING")).toBeInTheDocument();
      expect(screen.queryByText("BURN GO IN")).toBeNull();
    });

    it("keeps the countdown when the engines are off or not known to be lit", () => {
      const { rerender } = render(<CommitLayer {...live} burning={false} />);
      expect(screen.getByText("SUICIDE BURN")).toBeInTheDocument();
      expect(screen.queryByText("BURNING")).toBeNull();
      rerender(<CommitLayer {...live} />);
      expect(screen.getByText("SUICIDE BURN")).toBeInTheDocument();
      expect(screen.queryByText("BURNING")).toBeNull();
    });

    it("leaves a landing the burn cannot make, and a touchdown, as they read", () => {
      const { rerender } = render(
        <CommitLayer {...live} burning noLandingVector />,
      );
      expect(screen.getByText("NO LANDING VECTOR")).toBeInTheDocument();
      rerender(<CommitLayer {...live} burning landed />);
      expect(screen.getByText("LANDED")).toBeInTheDocument();
      expect(screen.queryByText("BURNING")).toBeNull();
    });
  });

  it("shows BURN LOCKED once the burn-GO deadline has passed under delay", () => {
    render(
      <CommitLayer
        {...live}
        regime="autonomous"
        live={false}
        commitInSeconds={-2}
        committed
      />,
    );
    expect(screen.getByText("BURN LOCKED")).toBeInTheDocument();
  });

  it("reads NO LANDING VECTOR when no viable safe trajectory exists", () => {
    render(
      <CommitLayer
        {...live}
        regime="autonomous"
        live={false}
        commitInSeconds={-2}
        committed
        noLandingVector
      />,
    );
    expect(screen.getByText("NO LANDING VECTOR")).toBeInTheDocument();
    // It supersedes the nominal committed hero, not both.
    expect(screen.queryByText("BURN LOCKED")).toBeNull();
  });

  it("keeps BURN LOCKED for a nominal committed burn (a vector still exists)", () => {
    render(
      <CommitLayer
        {...live}
        regime="autonomous"
        live={false}
        commitInSeconds={-2}
        committed
        noLandingVector={false}
      />,
    );
    expect(screen.getByText("BURN LOCKED")).toBeInTheDocument();
    expect(screen.queryByText("NO LANDING VECTOR")).toBeNull();
  });

  // A sustained delay state announces politely; only the instantaneous ignition cue may interrupt.
  it("announces a sustained delay state politely, not assertively", () => {
    render(
      <CommitLayer
        {...live}
        regime="autonomous"
        live={false}
        suicideBurnCountdown={3}
        commitInSeconds={-1.2}
        committed
      />,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent(/BURN LOCKED/i);
  });

  it("interrupts only for the ignition cue", () => {
    // The one ABORT-class event in this widget.
    render(<CommitLayer {...live} suicideBurnCountdown={0} />);
    const region = screen.getByRole("alert");
    expect(region).toHaveAttribute("aria-live", "assertive");
    expect(region).toHaveTextContent(/IGNITE/i);
  });

  const delayedDescent = {
    ...live,
    regime: "autonomous" as const,
    live: false,
    suicideBurnCountdown: null,
    commitInSeconds: 40,
    committed: false,
  };

  it("counts down to the burn-GO deadline while still descending", () => {
    render(<CommitLayer {...delayedDescent} landed={false} />);
    expect(screen.getByText(/BURN GO IN/i)).toBeInTheDocument();
  });

  it("shows a landed state instead of stale descent countdowns once down", () => {
    // Same props as the descent above except `landed`, so the burn-GO line that test sees must be absent here.
    render(<CommitLayer {...delayedDescent} landed />);
    expect(screen.getByText("LANDED")).toBeInTheDocument();
    expect(screen.getByText(/touchdown confirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/BURN GO IN/i)).toBeNull();
  });

  describe("the best-burn impact line", () => {
    const states = {
      "burn go clock": { ...delayedDescent },
      "burn locked": {
        ...delayedDescent,
        commitInSeconds: -2,
        committed: true,
      },
      "no landing vector": {
        ...delayedDescent,
        commitInSeconds: -2,
        committed: true,
        noLandingVector: true,
      },
      "ignition countdown": { ...live },
      landed: { ...delayedDescent, landed: true },
    };

    it.each(
      Object.entries(states),
    )("is present in the %s state, so the block never changes height", (_name, props) => {
      render(<CommitLayer {...props} impactSpeed={null} />);
      expect(screen.getAllByText("BEST-BURN IMPACT")).toHaveLength(1);
    });

    it("holds the absent-value token while there is no figure, and the speed once there is", () => {
      const { rerender } = render(
        <CommitLayer {...states["burn locked"]} impactSpeed={null} />,
      );
      expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
      rerender(<CommitLayer {...states["burn locked"]} impactSpeed={14} />);
      expect(screen.getByText(/14/)).toBeInTheDocument();
    });

    it("withholds the figure while any input to the burn solve is dated", () => {
      render(
        <CommitLayer
          {...states["no landing vector"]}
          mayInstruct={false}
          impactSpeed={14}
        />,
      );
      expect(screen.getByText("BEST-BURN IMPACT")).toBeInTheDocument();
      expect(screen.queryByText(/14/)).toBeNull();
    });

    it("lays both rows out the same way in every state", () => {
      const rows = (props: object) => {
        const { container, unmount } = render(
          <CommitLayer {...(props as typeof live)} impactSpeed={null} />,
        );
        const region = container.querySelector("[aria-live]") as HTMLElement;
        const shape = Array.from(region.querySelectorAll("*")).filter((el) =>
          el.textContent?.includes("BEST-BURN IMPACT"),
        ).length;
        const parentTag = region.firstElementChild?.tagName;
        unmount();
        return `${parentTag}:${shape}`;
      };
      const shapes = new Set(Object.values(states).map(rows));
      expect(shapes.size).toBe(1);
    });
  });

  it("keeps two rows in every state, and lets a row's words wrap rather than cutting them off in a narrow tile", () => {
    const { container } = render(
      <CommitLayer
        {...live}
        regime="autonomous"
        live={false}
        commitInSeconds={-2}
        committed
        noLandingVector
        impactSpeed={211}
      />,
    );
    const block = container.querySelector("[role=alert], [role=status]");
    expect(block?.querySelectorAll(":scope > * > *").length).toBe(2);
    for (const words of ["NO LANDING VECTOR", "BEST-BURN IMPACT"]) {
      const row = screen.getByText(words);
      expect(row.style.whiteSpace).not.toBe("nowrap");
      expect(row.style.textOverflow).not.toBe("ellipsis");
    }
  });

  it("calls the autonomous regime a warning, not a failure", () => {
    expect(REGIME_TONE.autonomous).toBe("warn");
  });

  it("holds no command controls, Landing is an instrument, not a command surface", () => {
    render(<CommitLayer {...live} />);
    // Gear/brakes are fired from the operator's own action-group widgets; the commit layer must expose no toggle buttons of its own.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/configuration/i)).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<CommitLayer {...live} />);
    await expectNoA11yViolations(container);
  });
});
