import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { ThemeProvider } from "styled-components";
import { describe, expect, it, vi } from "vitest";
import { defaultDarkTheme } from "../defaultDarkTheme";
import { render, screen } from "../test/render";
import {
  ScienceExperimentRow,
  type ScienceInstrument,
} from "./ScienceExperimentRow";

// Rows read `theme.space` (via the kit's `Inline`), so every render needs the
// real `ThemeProvider` — same as the app's actual mount (`main.tsx`).
function renderRow(ui: ReactElement) {
  return render(
    <ThemeProvider theme={defaultDarkTheme}>
      <ul>{ui}</ul>
    </ThemeProvider>,
  );
}

function instrument(
  overrides: Partial<ScienceInstrument> = {},
): ScienceInstrument {
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

  it("calls onDeploy with the partId when Deploy is clicked", async () => {
    const user = userEvent.setup();
    const onDeploy = vi.fn();
    renderRow(
      <ScienceExperimentRow
        instrument={instrument({ partId: "42" })}
        onDeploy={onDeploy}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Deploy" }));
    expect(onDeploy).toHaveBeenCalledWith("42");
  });

  it("requires arm-then-confirm before calling onTransmit", async () => {
    const user = userEvent.setup();
    const onTransmit = vi.fn();
    renderRow(
      <ScienceExperimentRow
        instrument={instrument({ partId: "99", hasData: true })}
        onTransmit={onTransmit}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Transmit" }));
    expect(onTransmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Confirm transmit/i }));
    expect(onTransmit).toHaveBeenCalledWith("99");
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
});
