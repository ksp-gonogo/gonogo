import { ControlFrameKind } from "@ksp-gonogo/sitrep-sdk";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ControlFrameSettings } from "./ControlFrameSettings";

const TOPIC = "system.frame";

const KERBIN_INERTIAL = {
  kind: ControlFrameKind.BodyCentredInertial,
  centreBody: "Kerbin",
  primaryBody: null,
  secondaryBody: null,
  targetFrameSelected: null,
};

const KERBIN_MUN_BARYCENTRIC = {
  kind: ControlFrameKind.BarycentricRotating,
  centreBody: null,
  primaryBody: "Kerbin",
  secondaryBody: "Mun",
  targetFrameSelected: null,
};

/** What stock reports: its one frame, and nothing it can be put in. */
const STOCK_FRAME = {
  kind: ControlFrameKind.BodyCentredInertial,
  centreBody: "Kerbin",
  targetFrameSelected: false,
  settableFrames: [],
};

const SETTABLE_FRAME = {
  kind: ControlFrameKind.BodyCentredInertial,
  centreBody: "Kerbin",
  targetFrameSelected: false,
  settableFrames: [KERBIN_INERTIAL, KERBIN_MUN_BARYCENTRIC],
};

async function mount(payload: unknown) {
  const fixture = setupStreamFixture();
  const view = render(
    <fixture.Provider>
      <ControlFrameSettings />
    </fixture.Provider>,
  );
  await waitFor(() => expect(fixture.transport.isSubscribed(TOPIC)).toBe(true));
  act(() => fixture.emit(TOPIC, payload));
  return { fixture, view };
}

function setButton() {
  return screen.getByRole("button", { name: /Control Frame to/ });
}

describe("ControlFrameSettings", () => {
  it("on a stream that can be put in no frame, shows the frame and offers nothing to press", async () => {
    const { fixture, view } = await mount(STOCK_FRAME);

    expect(
      await screen.findByText("Kerbin-Centred Inertial"),
    ).toBeInTheDocument();
    expect(screen.getByText("Settable frames")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(fixture.transport.sentCommands).toHaveLength(0);
    await expectNoA11yViolations(view.container);
  });

  it("does not claim None for a source that did not say what it can take", async () => {
    await mount({ ...STOCK_FRAME, settableFrames: null });

    expect(
      await screen.findByText("Kerbin-Centred Inertial"),
    ).toBeInTheDocument();
    expect(screen.getByText("Settable frames")).toBeInTheDocument();
    expect(screen.queryByText("None")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("offers exactly the settable frames other than the one in force", async () => {
    await mount(SETTABLE_FRAME);

    const select = await screen.findByRole("combobox", {
      name: "Set Control Frame",
    });
    const options = Array.from(
      select.querySelectorAll("option"),
      (o) => o.textContent,
    );
    expect(options).toEqual(["Barycentric rotating, Kerbin-Mun"]);
  });

  it("offers nothing when the one settable frame is the one in force", async () => {
    await mount({ ...SETTABLE_FRAME, settableFrames: [KERBIN_INERTIAL] });

    expect(
      await screen.findByText("Kerbin-Centred Inertial"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("None")).not.toBeInTheDocument();
  });

  it("arms before it sends, then sends the chosen frame as the command takes it", async () => {
    const { fixture, view } = await mount(SETTABLE_FRAME);
    fixture.transport.setCommandHandler(() => ({ success: true }));

    await screen.findByRole("combobox", { name: "Set Control Frame" });
    fireEvent.click(setButton());
    expect(fixture.transport.sentCommands).toHaveLength(0);
    expect(
      screen.getByRole("button", {
        name: "Confirm: set Control Frame to Barycentric rotating, Kerbin-Mun",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /^Confirm: set Control Frame/ }),
    );
    await waitFor(() => expect(fixture.transport.sentCommands).toHaveLength(1));
    const [sent] = fixture.transport.sentCommands;
    expect(sent?.command).toBe("system.frame.set");
    expect(sent?.args).toEqual({
      kind: ControlFrameKind.BarycentricRotating,
      primaryBody: "Kerbin",
      secondaryBody: "Mun",
    });

    act(() =>
      fixture.emit(TOPIC, {
        kind: ControlFrameKind.BarycentricRotating,
        primaryBody: "Kerbin",
        secondaryBody: "Mun",
        targetFrameSelected: false,
        settableFrames: SETTABLE_FRAME.settableFrames,
      }),
    );
    // The view is now in the pair, so the pair reads as the frame in force and Kerbin is what is left to offer.
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Kerbin-Centred Inertial" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Barycentric rotating, Kerbin-Mun"),
    ).toBeInTheDocument();
    await expectNoA11yViolations(view.container);
  });

  it("states a refusal from a source that listed the frame", async () => {
    const { fixture } = await mount(SETTABLE_FRAME);
    fixture.transport.setCommandHandler(() => ({
      success: false,
      errorCode: "modeUnavailable",
    }));

    await screen.findByRole("combobox", { name: "Set Control Frame" });
    fireEvent.click(setButton());
    fireEvent.click(
      screen.getByRole("button", { name: /^Confirm: set Control Frame/ }),
    );

    expect(await screen.findByText("Refused")).toBeInTheDocument();
  });
});
