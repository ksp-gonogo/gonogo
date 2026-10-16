import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlConfigForm } from "./WarpControlConfigForm";

const ROW = "Require an alarm to warp under delay";

function mount(delay?: { oneWaySeconds: number | null }) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  render(
    <fixture.Provider>
      <WarpControlConfigForm config={{}} onSave={vi.fn()} />
    </fixture.Provider>,
  );
  if (delay) {
    act(() => {
      fixture.emit("comms.delay", delay);
    });
  }
}

describe("WarpControlConfigForm at zero delay", () => {
  it("leaves the alarm setting out while the craft has no delay", () => {
    mount({ oneWaySeconds: 0 });

    expect(screen.queryByText(ROW)).toBeNull();
  });

  it("leaves the alarm setting out for a delay of a second or less", () => {
    mount({ oneWaySeconds: 1 });

    expect(screen.queryByText(ROW)).toBeNull();
  });

  it("says nothing about delay while the setting is out", () => {
    mount({ oneWaySeconds: 0 });

    expect(screen.queryByText(/delay/i)).toBeNull();
  });

  it("keeps the setting for a delay above a second", () => {
    mount({ oneWaySeconds: 1.5 });

    expect(screen.getByText(ROW)).toBeInTheDocument();
  });

  it("keeps the setting for a craft with no path, which is not a delay of zero", () => {
    mount({ oneWaySeconds: null });

    expect(screen.getByText(ROW)).toBeInTheDocument();
  });

  it("keeps the setting before any delay has been reported", () => {
    mount();

    expect(screen.getByText(ROW)).toBeInTheDocument();
  });
});
