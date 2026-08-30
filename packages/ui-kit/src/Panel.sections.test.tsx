import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAugments, registerAugment } from "./augments";
import { Panel } from "./Panel";
import { SECTION_FULL_ATTR, Section } from "./Section";
import { WidgetMetaContext } from "./WidgetMetaContext";

/**
 * `sections` is the preferred way to give a panel a body, and the shape a
 * `body` (children) is being retired in favour of. What is asserted here is the
 * CONTRACT rather than the layout: jsdom runs no layout at all, so the number
 * of columns the grid resolves to is not observable from a test and is checked
 * by rendering instead. What IS observable is that the sections are all there,
 * in order, in one grid box, with their titles as real headings.
 */
describe("Panel sections", () => {
  it("takes a single section without an array around it", () => {
    render(
      <Panel
        panelTitle="ONE"
        sections={<Section title="Only">just the one</Section>}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Only", level: 4 }),
    ).toBeInTheDocument();
    expect(screen.getByText("just the one")).toBeInTheDocument();
  });

  it("takes an array, keeps its order, and needs no keys from the caller", () => {
    render(
      <Panel
        panelTitle="MANY"
        sections={[
          <Section key="a" title="Alpha">
            a body
          </Section>,
          <Section key="b" title="Beta">
            b body
          </Section>,
        ]}
      />,
    );
    const headings = screen
      .getAllByRole("heading", { level: 4 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Alpha", "Beta"]);
  });

  it("drops a conditional section that resolved to null", () => {
    render(
      <Panel
        panelTitle="COND"
        sections={[
          <Section key="a" title="Alpha">
            a body
          </Section>,
          null,
          false,
        ]}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(1);
  });

  it("puts every section in ONE grid box, which is what makes the panel own the flow", () => {
    const { container } = render(
      <Panel
        panelTitle="GRID"
        sections={[<Section key="a">a</Section>, <Section key="b">b</Section>]}
      />,
    );
    const a = screen.getByText("a");
    const b = screen.getByText("b");
    expect(a.parentElement).toBe(b.parentElement);
    /* The grid is a box of its own inside the body, not the body itself: the
       body also carries the header and the delay rail, and columnising those is
       exactly what a grid on the body would do. */
    expect(a.parentElement).not.toBe(
      container.querySelector("[data-panel-body]"),
    );
  });

  it("marks a `full` section so the grid can span it across every column", () => {
    render(
      <Panel
        panelTitle="FULL"
        sections={[
          <Section key="a" full>
            wide
          </Section>,
          <Section key="b">narrow</Section>,
        ]}
      />,
    );
    expect(screen.getByText("wide")).toHaveAttribute(SECTION_FULL_ATTR);
    expect(screen.getByText("narrow")).not.toHaveAttribute(SECTION_FULL_ATTR);
  });

  it("renders no grid box at all when no sections were passed", () => {
    const { container } = render(
      <Panel panelTitle="CHILDREN">
        <div>body</div>
      </Panel>,
    );
    const body = container.querySelector("[data-panel-body]");
    expect(screen.getByText("body").parentElement).toBe(body);
  });

  it("renders sections under a headerless panel too", () => {
    render(<Panel sections={<Section title="Loose">content</Section>} />);
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});

describe("Section", () => {
  it("renders no heading box when it has no title", () => {
    render(<Section>bare</Section>);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("heads at h4 by default, the level under a panel's own h3", () => {
    render(<Section title="Group">rows</Section>);
    expect(
      screen.getByRole("heading", { name: "Group", level: 4 }),
    ).toBeInTheDocument();
  });

  it("takes a different level for the modals that head their sections higher", () => {
    render(
      <Section title="Group" titleAs="h3">
        rows
      </Section>,
    );
    expect(
      screen.getByRole("heading", { name: "Group", level: 3 }),
    ).toBeInTheDocument();
  });

  it("keeps the `as` passthrough, which a wrapper element would have eaten", () => {
    const { container } = render(
      <Section as="section" title="Group">
        rows
      </Section>,
    );
    const box = container.querySelector("section");
    expect(box).not.toBeNull();
    // Still the Stack, so it still lays its children out as a column with the
    // kit's gap rather than becoming a bare unstyled element.
    expect(getComputedStyle(box as Element).flexDirection).toBe("column");
  });
});

describe("Panel sections and the universal augment segment", () => {
  beforeEach(() => clearAugments());

  function HostWidget(props: { sections?: React.ReactNode }) {
    return (
      <WidgetMetaContext.Provider
        value={{ componentId: "host-widget", contributionSlots: [] }}
      >
        <Panel panelTitle="HOST" {...props}>
          {props.sections === undefined ? <div>body</div> : undefined}
        </Panel>
      </WidgetMetaContext.Provider>
    );
  }

  /**
   * An Uplink's appended section is a section, so it joins the flow rather than
   * always landing in a full-width block under the host's own. That is the
   * whole reason the segment is named `sections`.
   */
  it("puts a bound augment inside the grid, beside the host's sections", () => {
    registerAugment({
      id: "sections-aug",
      augments: "host-widget.sections",
      component: () => <div>appended</div>,
    });
    render(<HostWidget sections={<Section key="a">own</Section>} />);
    expect(screen.getByText("appended").parentElement).toBe(
      screen.getByText("own").parentElement,
    );
  });

  /** Both mounts firing would render every bound augment twice, silently. */
  it("mounts the segment exactly once", () => {
    registerAugment({
      id: "sections-aug",
      augments: "host-widget.sections",
      component: () => <div>appended</div>,
    });
    render(<HostWidget sections={<Section key="a">own</Section>} />);
    expect(screen.getAllByText("appended")).toHaveLength(1);
  });

  it("still mounts it after the body when the widget passes no sections", () => {
    registerAugment({
      id: "sections-aug",
      augments: "host-widget.sections",
      component: () => <div>appended</div>,
    });
    render(<HostWidget />);
    expect(screen.getAllByText("appended")).toHaveLength(1);
  });
});
