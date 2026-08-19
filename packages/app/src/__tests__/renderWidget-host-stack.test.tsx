import {
  clearRegistry,
  registerComponent,
  render,
  renderWidget,
  screen,
  useDashboardItemId,
} from "@ksp-gonogo/sitrep-testing";
import { usePanelStatusStore } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `renderWidget` exists because `render` mounts a widget somewhere the app
 * never mounts one: with no dashboard providers above it. The failure that
 * causes is silent rather than loud, which is why it needs its own test.
 *
 * A widget's `Panel` reads its stream status off the store
 * `PanelStatusStoreProvider` mounts. With no store the badge never renders, so
 * a `waitFor` for that badge resolves immediately having proved nothing at all.
 * The check passes whatever the widget does, for as long as it exists.
 *
 * The store's PRESENCE is what is asserted, not a particular status value. A
 * non-null status additionally needs a mounted telemetry stream, because
 * `useWidgetStreamStatus` derives it from a live store: `renderWidget` puts the
 * plumbing up, and `setupStreamFixture` puts data through it.
 *
 * Everything comes from the HARNESS rather than `@ksp-gonogo/core`, assertions
 * included. The harness bundles its own copy of core, so a registry written
 * through the app's copy is a different Map and a context read through it is a
 * different object: both read empty whatever the host does. An Uplink only ever
 * has the harness, so going through it is also the faithful thing to do.
 */

const PROBE_ID = "render-widget-host-probe";
const ITEM_PROBE_ID = "render-widget-item-probe";

/** Reports whether it can see the dashboard's status store. */
function HostProbe({ id }: { id?: string }) {
  const store = usePanelStatusStore();
  return (
    <div>
      <span data-testid="status">
        {store ? "HAS-STATUS-STORE" : "NO-STATUS-STORE"}
      </span>
      <span data-testid="id-prop">{id ?? "NO-ID-PROP"}</span>
    </div>
  );
}

/**
 * Calls `useDashboardItemId`, which THROWS outside a dashboard item by design.
 * Its own widget so the hook is never called conditionally: it is only ever
 * rendered through `renderWidget`, where the context is guaranteed.
 */
function ItemProbe() {
  return <span data-testid="instance">{useDashboardItemId()}</span>;
}

function register(id: string, component: (props: never) => JSX.Element): void {
  registerComponent({
    id,
    name: id,
    description: "Reports which dashboard providers it can see.",
    tags: [],
    component: component as never,
    dataRequirements: [],
    behaviors: [],
    defaultConfig: {},
  });
}

afterEach(() => {
  clearRegistry();
});

describe("renderWidget mounts the dashboard's provider stack", () => {
  it("bare render sees NO status store, which is the silent failure", () => {
    render(<HostProbe />);
    expect(screen.getByTestId("status")).toHaveTextContent("NO-STATUS-STORE");
  });

  it("renderWidget supplies it, so a status assertion can actually fail", () => {
    register(PROBE_ID, HostProbe as never);
    renderWidget(PROBE_ID, { instanceId: "probe-7" });
    expect(screen.getByTestId("status")).toHaveTextContent("HAS-STATUS-STORE");
  });

  it("wires instanceId through to the widget's own id prop", () => {
    register(PROBE_ID, HostProbe as never);
    renderWidget(PROBE_ID, { instanceId: "probe-7" });
    expect(screen.getByTestId("id-prop")).toHaveTextContent("probe-7");
  });

  it("provides the item context, which a widget reads for its instance", () => {
    register(ITEM_PROBE_ID, ItemProbe);
    renderWidget(ITEM_PROBE_ID, { instanceId: "probe-9" });
    expect(screen.getByTestId("instance")).toHaveTextContent("probe-9");
  });

  it("defaults the instance id rather than leaving the widget without one", () => {
    register(ITEM_PROBE_ID, ItemProbe);
    renderWidget(ITEM_PROBE_ID);
    expect(screen.getByTestId("instance")).toHaveTextContent(
      `${ITEM_PROBE_ID}-test`,
    );
  });

  it("names the likely cause when the id was never registered", () => {
    expect(() => renderWidget("not-a-registered-widget")).toThrow(
      /no component is registered under that id/,
    );
    expect(() => renderWidget("not-a-registered-widget")).toThrow(
      /nothing imported it/,
    );
  });
});
