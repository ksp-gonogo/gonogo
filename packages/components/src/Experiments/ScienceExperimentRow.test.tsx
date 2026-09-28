import {
  CommandErrorCode,
  type CommandReply,
  railTagsForCommand,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import type { CommandButtonHandle, CommandReplyLike } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Instrument } from "./instrument";
import { ScienceExperimentRow } from "./ScienceExperimentRow";

const OK: CommandReplyLike = { success: true };

// Read off the real command so the fixture tracks its declaration.
const TRANSMIT_TAGS = railTagsForCommand("science.experiment.transmit");

/** A structural command handle, the shape `useCommand` returns. */
function handle<Reply extends CommandReplyLike = CommandReplyLike>(
  send: CommandButtonHandle<Reply>["send"],
): CommandButtonHandle<Reply> {
  return { send, inFlight: [], tags: TRANSMIT_TAGS, effectiveDelaySeconds: 0 };
}

type TransmitReply = CommandReply<"science.experiment.transmit">;

const TRANSMITTED: TransmitReply = {
  success: true,
  errorCode: CommandErrorCode.None,
  payload: {
    subjectId: "mysteryGoo@KerbinSrfLandedLaunchPad",
    title: "Mystery Goo Observation from LaunchPad",
    startedAt: value("ut", 1000),
    streamSeconds: value("s", 4),
    dataAmount: value("Mit", 10),
  },
};

// A row is an `<li>` and needs its list parent to be valid.
function renderRow(ui: ReactElement) {
  return render(<ul>{ui}</ul>);
}

function instrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    partId: "1",
    partTitle: "Mystery Goo",
    expId: "mysteryGoo",
    deployed: false,
    hasData: false,
    rerunnable: true,
    inoperable: false,
    ...overrides,
  };
}

describe("ScienceExperimentRow", () => {
  it("renders the instrument's name", () => {
    renderRow(
      <ScienceExperimentRow
        instrument={instrument({ partTitle: "Thermometer" })}
      />,
    );
    expect(screen.getByText("Thermometer")).toBeInTheDocument();
  });

  it("shows DATA/DEPLOYED/ONE-SHOT/INOPERABLE badges per the instrument's state", () => {
    renderRow(
      <ScienceExperimentRow
        instrument={instrument({
          hasData: true,
          deployed: true,
          rerunnable: false,
          inoperable: true,
        })}
      />,
    );
    expect(screen.getByText("DATA")).toBeInTheDocument();
    expect(screen.getByText("DEPLOYED")).toBeInTheDocument();
    expect(screen.getByText("ONE-SHOT")).toBeInTheDocument();
    expect(screen.getByText("INOPERABLE")).toBeInTheDocument();
  });

  it("dispatches deploy with the partId when Deploy is clicked", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(OK));
    renderRow(
      <ScienceExperimentRow
        instrument={instrument({ partId: "42" })}
        deployCmd={handle(send)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Deploy" }));
    expect(send).toHaveBeenCalledWith(
      { partId: "42" },
      { label: "Deploy Mystery Goo" },
    );
  });

  it("requires arm-then-confirm before dispatching transmit", async () => {
    const user = userEvent.setup();
    const send = vi.fn(() => Promise.resolve(TRANSMITTED));
    renderRow(
      <ScienceExperimentRow
        instrument={instrument({ partId: "99", hasData: true })}
        transmitCmd={handle<TransmitReply>(send)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Transmit" }));
    expect(send).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Confirm transmit/i }));
    expect(send).toHaveBeenCalledWith(
      { partId: "99" },
      { label: "Transmit Mystery Goo" },
    );
  });

  it("hands a confirmed transmit's transmission on, so the rail can carry it home", async () => {
    const user = userEvent.setup();
    const onTransmitted = vi.fn();
    renderRow(
      <ScienceExperimentRow
        instrument={instrument({ partId: "99", hasData: true })}
        transmitCmd={handle<TransmitReply>(() => Promise.resolve(TRANSMITTED))}
        onTransmitted={onTransmitted}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Transmit" }));
    await user.click(screen.getByRole("button", { name: /Confirm transmit/i }));
    expect(onTransmitted).toHaveBeenCalledWith(TRANSMITTED.payload);
  });

  it("renders no controls at all for a read-only listing", () => {
    renderRow(
      <ScienceExperimentRow instrument={instrument({ hasData: true })} />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides the action cluster for an inoperable instrument", () => {
    renderRow(
      <ScienceExperimentRow instrument={instrument({ inoperable: true })} />,
    );
    expect(screen.queryByText("Deploy")).not.toBeInTheDocument();
    expect(screen.queryByText("Transmit")).not.toBeInTheDocument();
  });

  it("does not render Deploy once the instrument is already deployed or has data", () => {
    renderRow(
      <ScienceExperimentRow instrument={instrument({ deployed: true })} />,
    );
    expect(screen.queryByText("Deploy")).not.toBeInTheDocument();
  });

  // The full badge set is wider than the row, so the row must wrap rather than crush the name.
  it("lays the row and its badge cluster out to wrap, and keeps the whole name in reach", () => {
    renderRow(
      <ScienceExperimentRow
        instrument={instrument({
          partTitle: "Mystery Goo™ Containment Unit",
          hasData: true,
          deployed: true,
          rerunnable: false,
          inoperable: true,
        })}
      />,
    );
    const name = screen.getByText("Mystery Goo™ Containment Unit");
    expect(name).toHaveAttribute("title", "Mystery Goo™ Containment Unit");
    expect(getComputedStyle(screen.getByRole("listitem")).flexWrap).toBe(
      "wrap",
    );
    const badges = screen.getByText("INOPERABLE").parentElement;
    expect(badges).not.toBeNull();
    expect(getComputedStyle(badges as Element).flexWrap).toBe("wrap");
  });
  it("has no axe violations across instrument states", async () => {
    const { container } = renderRow(
      <>
        <ScienceExperimentRow instrument={instrument()} />
        <ScienceExperimentRow
          instrument={instrument({
            partId: "2",
            partTitle: "Thermometer",
            expId: "temperatureScan",
            deployed: true,
            hasData: true,
            rerunnable: false,
          })}
        />
        <ScienceExperimentRow
          instrument={instrument({
            partId: "3",
            partTitle: "Burned Sensor",
            expId: "x",
            rerunnable: false,
            inoperable: true,
          })}
        />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
