import { TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { type GameLoaded, value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { isNews, QuickloadSentence } from "./QuickloadBanner";

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

  it("says a game load with no requester plainly", () => {
    render(<QuickloadSentence event={event({})} />);
    expect(document.body.textContent).toContain("Game loaded ·");
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

describe("which loads are news", () => {
  it("is news when the view clock is at the load", () => {
    expect(isNews(event({}), value("ut", 510))).toBe(true);
  });

  it("is a replay when the view clock is far past the load", () => {
    expect(isNews(event({}), value("ut", 700))).toBe(false);
  });
});
