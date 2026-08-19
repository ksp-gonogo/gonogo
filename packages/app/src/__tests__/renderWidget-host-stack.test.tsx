// Registry helpers come from the HARNESS, not from core directly: the harness
// bundles its own copy of core, so a component registered through core's
// module here would land in a different registry from the one `renderWidget`
// reads. That is exactly the trap an Uplink author would hit.
import {
  clearRegistry,
  DashboardItemContext,
  registerComponent,
  render,
  renderWidget,
  screen,
} from "@ksp-gonogo/sitrep-testing";
import { usePanelStatusStore } from "@ksp-gonogo/ui-kit";
import { useContext } from "react";
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
 * The store's PRESENCE is what is asserted here, not a particular status value.
 * A non-null status additionally needs a mounted telemetry stream, because
 * `useWidgetStreamStatus` derives it from a live store: `renderWidget` puts the
 * plumbing up, and `setupStreamFixture` puts data through it.
 *
 * So this asserts BOTH directions. Asserting only that `renderWidget` supplies
 * the context would pass just as well if `render` supplied it too, and would
 * then be measuring nothing: the negative case is what proves the positive one
 * is load-bearing.
 */

const PROBE_ID = "render-widget-host-probe";

/** Prints what it can see of the dashboard host, or the absence of it. */
function HostProbe() {
  const store = usePanelStatusStore();
  // The context rather than `useDashboardItemId`, which throws outside a
  // dashboard item by design: the absent case is half of what is under test
  // here, and a hook cannot be called conditionally to catch it.
  const item = useContext(DashboardItemContext);
  return (
    <div>
      <span data-testid="status">
        {store ? "HAS-STATUS-STORE" : "NO-STATUS-STORE"}
      </span>
      <span data-testid="instance">
        {item?.instanceId ?? "NO-ITEM-CONTEXT"}
      </span>
    </div>
  );
}

function registerProbe(): void {
  registerComponent({
    id: PROBE_ID,
    name: "Render Widget Host Probe",
    description: "Reports which dashboard providers it can see.",
    tags: [],
    component: HostProbe,
    dataRequirements: [],
    behaviors: [],
    defaultConfig: {},
  });
}

afterEach(() => {
  clearRegistry();
});

describe("renderWidget mounts the dashboard's provider stack", () => {
  it("bare render sees NEITHER the status context nor the item context", () => {
    render(<HostProbe />);
    expect(screen.getByTestId("status")).toHaveTextContent("NO-STATUS-STORE");
    expect(screen.getByTestId("instance")).toHaveTextContent("NO-ITEM-CONTEXT");
  });

  it("renderWidget supplies both, so a status assertion can actually fail", () => {
    registerProbe();
    renderWidget(PROBE_ID, { instanceId: "probe-7" });
    expect(screen.getByTestId("status")).toHaveTextContent("HAS-STATUS-STORE");
    expect(screen.getByTestId("instance")).toHaveTextContent("probe-7");
  });

  it("defaults the instance id rather than leaving the widget without one", () => {
    registerProbe();
    renderWidget(PROBE_ID);
    expect(screen.getByTestId("instance")).toHaveTextContent(
      `${PROBE_ID}-test`,
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
