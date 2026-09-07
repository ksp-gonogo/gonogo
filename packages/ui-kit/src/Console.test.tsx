import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import type { InFlightListItem } from "./CommandDelay/InFlightList";
import { Console } from "./Console";
import { expectNoA11yViolations } from "./expectNoA11yViolations";

const OUT: InFlightListItem[] = [
  { id: "1", label: "run boot.ks", etaSeconds: 90, phase: "in-transit" },
];

describe("Console", () => {
  it("renders its scrollback", () => {
    render(
      <Console>
        <p>scrollback</p>
      </Console>,
    );
    expect(screen.getByText("scrollback")).toBeInTheDocument();
  });

  it("grows no foot at all when the caller passes no composer", () => {
    // The inbox case: a list of conversations with nothing to type at it. An
    // empty padded band under the surface is height taken from the list.
    const { container } = render(
      <Console>
        <p>scrollback</p>
      </Console>,
    );
    const frame = container.querySelector("[data-console-frame]");
    expect(frame?.children).toHaveLength(1);
  });

  it("keeps the foot for a composer that is given but currently absent", () => {
    /*
     * A terminal in character mode composes nothing, and it is a MODE of a
     * console that has a composer: the surface above must not change height
     * when the operator toggles it.
     */
    const { container } = render(<Console composer={false} />);
    const frame = container.querySelector("[data-console-frame]");
    expect(frame?.children).toHaveLength(2);
  });

  it("holds the composer inside itself, with the scrollback", () => {
    const { container } = render(
      <Console composer={<input aria-label="Message" />}>
        <p>scrollback</p>
      </Console>,
    );
    const frame = container.querySelector("[data-console-frame]");
    expect(frame?.contains(screen.getByLabelText("Message"))).toBe(true);
  });

  describe("the one reading of the delay", () => {
    it("chips a separation too short to count down, and lists nothing", () => {
      render(<Console oneWaySeconds={0.4} inFlight={OUT} />);
      expect(screen.getByLabelText("Signal delay")).toBeInTheDocument();
      expect(screen.queryByLabelText("Uplink queue")).toBeNull();
    });

    it("lists what is crossing at a long separation, and chips nothing", () => {
      render(<Console oneWaySeconds={240} inFlight={OUT} />);
      expect(screen.getByLabelText("Uplink queue")).toBeInTheDocument();
      expect(screen.queryByLabelText("Signal delay")).toBeNull();
    });

    it("hangs the chip in the console's corner, not in the foot", () => {
      // WHERE the reading hangs is what the two consoles disagreed about, and
      // it is invisible to a role query: both drew a perfectly good chip.
      const { container } = render(
        <Console oneWaySeconds={0.4} composer={<input aria-label="Msg" />} />,
      );
      const corner = container.querySelector("[data-console-corner]");
      expect(corner?.contains(screen.getByLabelText("Signal delay"))).toBe(
        true,
      );
    });

    it("draws neither on a link with no measurable path", () => {
      render(<Console oneWaySeconds={null} inFlight={OUT} />);
      expect(screen.queryByLabelText("Signal delay")).toBeNull();
      expect(screen.queryByLabelText("Uplink queue")).toBeNull();
    });

    it("gives a console that cannot queue neither reading at a long delay", () => {
      // A read-only viewer dispatches nothing, so there is no queue to draw and
      // a standing chip would quote a cost it never pays.
      render(<Console oneWaySeconds={240} canQueue={false} inFlight={OUT} />);
      expect(screen.queryByLabelText("Signal delay")).toBeNull();
      expect(screen.queryByLabelText("Uplink queue")).toBeNull();
    });

    it("chips at any separation when the console composes nothing to queue", () => {
      render(<Console oneWaySeconds={240} alwaysBadge inFlight={OUT} />);
      expect(screen.getByLabelText("Signal delay")).toBeInTheDocument();
      expect(screen.queryByLabelText("Uplink queue")).toBeNull();
    });
  });

  describe("inFlightFrozenAtDispatch", () => {
    it("keeps listing entries after the live reading has gone", () => {
      // Words put out at four light-minutes are still four light-minutes out
      // after the path drops, and this queue is the only place they appear.
      render(
        <Console
          oneWaySeconds={null}
          inFlight={OUT}
          inFlightFrozenAtDispatch
        />,
      );
      expect(screen.getByLabelText("Uplink queue")).toBeInTheDocument();
    });

    it("still never draws the queue beside the chip", () => {
      render(
        <Console oneWaySeconds={0.4} inFlight={OUT} inFlightFrozenAtDispatch />,
      );
      expect(screen.getByLabelText("Signal delay")).toBeInTheDocument();
      expect(screen.queryByLabelText("Uplink queue")).toBeNull();
    });

    it("is what a queue derived from the live route does NOT get", () => {
      render(<Console oneWaySeconds={null} inFlight={OUT} />);
      expect(screen.queryByLabelText("Uplink queue")).toBeNull();
    });
  });

  it("puts the queue above the composer, never below it", () => {
    const { container } = render(
      <Console
        oneWaySeconds={240}
        inFlight={OUT}
        composer={<input aria-label="Message" />}
      />,
    );
    const queue = screen.getByLabelText("Uplink queue");
    const input = screen.getByLabelText("Message");
    expect(
      queue.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelector("[data-console-frame]")).not.toBeNull();
  });

  it("has no axe violations with every slot filled", async () => {
    const { container } = render(
      <Console
        oneWaySeconds={240}
        inFlight={OUT}
        composer={<input aria-label="Message" />}
      >
        <p>scrollback</p>
      </Console>,
    );
    await expectNoA11yViolations(container);
  });
});
