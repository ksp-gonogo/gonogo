import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ProjectCard, ProjectCardList } from "./ProjectCard";

/**
 * The card two widgets draw RP-1's work with, tested where it lives rather than
 * once per consumer.
 *
 * <para>The rules that matter here are the ones a consumer cannot see it break:
 * a bar that is omitted rather than drawn empty, and list semantics that hold
 * whichever widget the card is mounted in.</para>
 */
describe("ProjectCard", () => {
  it("draws no bar at all when RP-1 has published no fraction", () => {
    // A full-width empty track says "no progress made", which is a different
    // claim from "we cannot see the progress". RP-1 leaves the fraction absent
    // on a project it has not costed yet, and drawing a zero bar for that is a
    // statement about the career it never made.
    render(
      <ProjectCardList>
        <ProjectCard
          name="Vehicle Assembly Building"
          progress={{ label: "Construction progress", ratio: null }}
          tone="go"
        />
      </ProjectCardList>,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("draws the bar, named, when there is a fraction to draw", async () => {
    const { container } = render(
      <ProjectCardList>
        <ProjectCard
          name="Atlas"
          progress={{ label: "Integration progress, Atlas", ratio: 0.25 }}
          tone="warning"
        />
      </ProjectCardList>,
    );

    const bar = screen.getByRole("progressbar", {
      name: "Integration progress, Atlas",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    await expectNoA11yViolations(container);
  });

  it("keeps its list item inside a list, whichever widget mounts it", async () => {
    // A card renders an `<li>`, so without the list around it a screen reader
    // is handed an orphan list item. The reset used to be a copy per widget;
    // asserting it here is what makes the third consumer safe.
    const { container } = render(
      <ProjectCardList>
        <ProjectCard badge={<span>BUILT</span>} name="Atlas" tone="go" />
        <ProjectCard
          badge={<span>INTEGRATING</span>}
          name="Vanguard"
          tone="warning"
        />
      </ProjectCardList>,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("list")).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("draws the name, the badge, the detail line and the children, in that order", () => {
    // The layout is the whole of what the card owns: a consumer supplies every
    // word, and the point of sharing it is that a facility upgrade and a rocket
    // read the same way down the card.
    render(
      <ProjectCardList>
        <ProjectCard
          badge={<span>INTEGRATING</span>}
          detail="LC-1 · costs 40,000f"
          name="Atlas"
          progress={{ label: "Integration progress, Atlas", ratio: 0.25 }}
          tone="warning"
        >
          <span>45d until integration finishes</span>
        </ProjectCard>
      </ProjectCardList>,
    );

    expect(visibleText()).toContain(
      "AtlasINTEGRATINGLC-1 · costs 40,000f45d until integration finishes",
    );
  });

  it("omits the detail line rather than drawing an empty one", () => {
    render(
      <ProjectCardList>
        <ProjectCard name="Atlas" tone="go">
          <span>nothing left to do</span>
        </ProjectCard>
      </ProjectCardList>,
    );

    expect(visibleText()).toBe("Atlasnothing left to do");
  });
});
