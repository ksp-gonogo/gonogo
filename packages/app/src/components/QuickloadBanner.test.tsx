import { TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { type GameLoaded, value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { QuickloadSentence } from "./QuickloadBanner";

function event(over: Partial<GameLoaded>): GameLoaded {
  return {
    loadId: "l1",
    outcome: "loaded",
    failReason: null,
    saveUt: value("ut", 100),
    fromUt: value("ut", 500),
    requestedBy: "",
    ...over,
  } as GameLoaded;
}

describe("the quickload banner's words", () => {
  it("names the station that loaded and how far it moved", () => {
    render(<QuickloadSentence event={event({ requestedBy: "Station 3" })} />);
    expect(document.body.textContent).toContain("Quickloaded by Station 3");
    expect(document.body.textContent).toContain("moved");
  });

  it("omits the name for the main screen", () => {
    render(<QuickloadSentence event={event({})} />);
    expect(document.body.textContent).toContain("Quickloaded ·");
  });

  it("says why a load failed", () => {
    render(
      <QuickloadSentence
        event={event({
          outcome: "failed",
          failReason: "the save is not compatible",
        })}
      />,
    );
    expect(document.body.textContent).toBe(
      "Quickload failed: the save is not compatible",
    );
  });

  it("says a load was cancelled", () => {
    render(<QuickloadSentence event={event({ outcome: "cancelled" })} />);
    expect(document.body.textContent).toBe(
      "Quickload cancelled: the scene changed first",
    );
  });
});
