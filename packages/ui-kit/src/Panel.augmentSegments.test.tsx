import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAugments, registerAugment } from "./augments";
import { Panel, WidgetSections } from "./Panel";
import { WidgetMetaContext } from "./WidgetMetaContext";

beforeEach(() => clearAugments());

/**
 * A widget mounted the way the dashboard mounts one: identified by
 * `WidgetMetaContext`, rendering a plain `Panel` and declaring no slot of its
 * own. Everything below turns on the widget having said NOTHING, which is what
 * makes the two segments universal.
 */
function HostWidget({
  componentId = "host-widget",
  children,
  ...panelProps
}: {
  componentId?: string;
  children?: React.ReactNode;
} & Record<string, unknown>) {
  return (
    <WidgetMetaContext.Provider value={{ componentId, contributionSlots: [] }}>
      <Panel panelTitle="HOST" {...panelProps}>
        {children ?? <div>body</div>}
      </Panel>
    </WidgetMetaContext.Provider>
  );
}

describe("Panel: the universal `sections` augment segment", () => {
  it("renders an augment bound to `<componentId>.sections` with no widget-side wiring", () => {
    registerAugment({
      id: "sections-aug",
      augments: "host-widget.sections",
      component: () => <div>appended section</div>,
    });

    render(<HostWidget />);

    expect(screen.getByText("appended section")).toBeInTheDocument();
  });

  it("scopes the segment to the mounting widget: another widget's binder does not render", () => {
    registerAugment({
      id: "other-sections-aug",
      augments: "other-widget.sections",
      component: () => <div>wrong host</div>,
    });

    render(<HostWidget />);

    expect(screen.queryByText("wrong host")).not.toBeInTheDocument();
  });

  it("renders once, not twice, when the widget places its own `WidgetSections`", () => {
    registerAugment({
      id: "sections-aug-dedupe",
      augments: "host-widget.sections",
      component: () => <div>appended section</div>,
    });

    render(
      <HostWidget panelSections={false}>
        <div>body</div>
        <WidgetSections />
      </HostWidget>,
    );

    expect(screen.getAllByText("appended section")).toHaveLength(1);
  });

  it("renders TWICE when a widget places its own and forgets to turn the default off, which is why the prop exists", () => {
    registerAugment({
      id: "sections-aug-double",
      augments: "host-widget.sections",
      component: () => <div>appended section</div>,
    });

    render(
      <HostWidget>
        <div>body</div>
        <WidgetSections />
      </HostWidget>,
    );

    expect(screen.getAllByText("appended section")).toHaveLength(2);
  });

  it("reaches a headerless panel too", () => {
    registerAugment({
      id: "sections-aug-headerless",
      augments: "host-widget.sections",
      component: () => <div>appended section</div>,
    });

    render(
      <WidgetMetaContext.Provider
        value={{ componentId: "host-widget", contributionSlots: [] }}
      >
        <Panel>
          <div>body</div>
        </Panel>
      </WidgetMetaContext.Provider>,
    );

    expect(screen.getByText("appended section")).toBeInTheDocument();
  });
});

describe("Panel: the universal `actions` augment segment", () => {
  it("renders an augment bound to `<componentId>.actions` in the header", () => {
    registerAugment({
      id: "actions-aug",
      augments: "host-widget.actions",
      component: () => <button type="button">Layers</button>,
    });

    render(<HostWidget />);

    expect(screen.getByRole("button", { name: "Layers" })).toBeInTheDocument();
  });

  it("gives an unbound panel no aside at all, so no widget grows an empty header box", () => {
    const { container } = render(<HostWidget />);

    expect(container.querySelector("[data-panel-aside-expand]")).toBeNull();
  });

  it("gives a bound panel a header even with no title of its own", () => {
    registerAugment({
      id: "actions-aug-headerless",
      augments: "host-widget.actions",
      component: () => <button type="button">Layers</button>,
    });

    render(
      <WidgetMetaContext.Provider
        value={{ componentId: "host-widget", contributionSlots: [] }}
      >
        <Panel>
          <div>body</div>
        </Panel>
      </WidgetMetaContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "Layers" })).toBeInTheDocument();
  });
});

describe("Panel: neither segment fires outside a widget context", () => {
  it("renders nothing for a bare panel, the settings-modal / station-connect case", () => {
    registerAugment({
      id: "sections-aug-bare",
      augments: "host-widget.sections",
      component: () => <div>appended section</div>,
    });
    registerAugment({
      id: "actions-aug-bare",
      augments: "host-widget.actions",
      component: () => <button type="button">Layers</button>,
    });

    render(
      <Panel panelTitle="BARE">
        <div>body</div>
      </Panel>,
    );

    expect(screen.queryByText("appended section")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Layers" })).toBeNull();
  });
});
