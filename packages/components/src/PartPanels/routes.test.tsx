import { getPartPanels } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import "./index";
import { gameWindowFallback } from "./GameWindowPanel";

describe("built-in part panels", () => {
  it("are registered under the core client's id, as an Uplink's are under its own", () => {
    const panels = getPartPanels();
    expect(panels.map((p) => p.id)).toEqual(["core:review-data"]);
    expect(panels.every((p) => p.owner !== undefined)).toBe(true);
  });

  it("leave a game's Rename Vessel to the game window fallback", () => {
    const claimed = getPartPanels().some((p) =>
      p.replaces?.some((r) => r.event === "RenameVessel"),
    );
    expect(claimed).toBe(false);

    const fallback = gameWindowFallback({
      module: "ModuleCommand",
      event: "RenameVessel",
      label: "Rename Vessel",
    });
    expect(fallback?.id).toBe("game-window:ModuleCommand:RenameVessel");
  });
});
