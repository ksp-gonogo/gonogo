import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { MissionDate } from "./MissionDate";

describe("MissionDate time context", () => {
  it("renders the bare time when no context is given", () => {
    const { container } = render(<MissionDate value={9_201_600} />);
    expect(container.textContent).not.toMatch(/SCET|AT /);
  });

  it("qualifies a craft-clock instant as SCET", () => {
    render(<MissionDate value={9_201_600} context={{ frame: "scet" }} />);
    expect(screen.getByText("SCET")).toBeInTheDocument();
  });

  it("names the vantage on an arrival-clock instant", () => {
    render(
      <MissionDate
        value={9_201_600}
        context={{ frame: "received", vantage: "KSC" }}
      />,
    );
    expect(screen.getByText("AT KSC")).toBeInTheDocument();
  });

  /* A frame can arrive before the roster naming its centre does. Saying the
     time is an arrival time without saying whose still beats saying nothing,
     so the unnamed form is a rendering rather than a reason to drop the
     qualifier. */
  it("still qualifies an arrival time whose vantage has not been named", () => {
    render(<MissionDate value={9_201_600} context={{ frame: "received" }} />);
    expect(screen.getByText("RECEIVED")).toBeInTheDocument();
  });

  /* The token is written for the eye: read aloud it is "ess see ee tee". The
     phrase replaces it in the accessibility tree the same way `<Unit>`'s word
     replaces a symbol, so the two are never announced together. */
  it("announces the phrase rather than the token", () => {
    const { container } = render(
      <MissionDate value={9_201_600} context={{ frame: "scet" }} />,
    );
    expect(screen.getByText("SCET")).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent).toContain("spacecraft event time");
  });
});
