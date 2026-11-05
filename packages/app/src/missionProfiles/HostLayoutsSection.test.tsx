import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HostLayout } from "../peer/protocol";
import { HostLayoutsSection } from "./HostLayoutsSection";

const launch: HostLayout = { id: "l1", name: "Launch", items: [], layout: [] };

describe("HostLayoutsSection", () => {
  it("offers each layout the main screen has saved and hands the chosen one back", async () => {
    const onUse = vi.fn();
    render(
      <HostLayoutsSection
        client={{ requestHostLayouts: () => Promise.resolve([launch]) }}
        onUse={onUse}
      />,
    );
    expect(await screen.findByText("Launch")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Use Launch" }));
    expect(onUse).toHaveBeenCalledWith(launch);
  });

  it("says the main screen has none saved when it answers with none", async () => {
    render(
      <HostLayoutsSection
        client={{ requestHostLayouts: () => Promise.resolve([]) }}
        onUse={vi.fn()}
      />,
    );
    expect(
      await screen.findByText("No layouts saved on the main screen"),
    ).toBeVisible();
  });

  it("says the layouts could not be read when the main screen does not answer", async () => {
    render(
      <HostLayoutsSection
        client={{ requestHostLayouts: () => Promise.reject(new Error("x")) }}
        onUse={vi.fn()}
      />,
    );
    expect(
      await screen.findByText("Could not read the main screen's layouts"),
    ).toBeVisible();
  });
});
