/**
 * DOM-snapshot regression tests for the LifeSupportSystems widget.
 *
 * Catches structural drift (rendered text, element order, attribute changes)
 * across every fixture × mode combination registered for the widget. The
 * matching PNG renders live in `local_docs/renders/life-support-widget/` and
 * cover the visual layer DOM snapshots can't (styled-components CSS, the
 * consumable meters paint, fonts).
 *
 * LifeSupportSystems reads the canonical `kerbalism.lifesupport` Topic via
 * useTelemetry, so the shared harness reshapes each fixture's flat `ls.*` keys
 * onto that Topic payload and streams them through a mounted TelemetryProvider
 * (setupStreamFixture) — see widgetDomSnapshot's kerbalism reshape. Missing
 * keys default to 0, so the ledger always renders populated.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/LifeSupportSystems/snapshots -u`.
 */
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { snapshotWidgetMode } from "../test/widgetDomSnapshot";
import critical from "./__fixtures__/critical.json";
import depleting from "./__fixtures__/depleting.json";
import nominal from "./__fixtures__/nominal.json";
import { LifeSupportSystemsComponent } from "./index";

const FIXTURES = {
  nominal,
  depleting,
  critical,
};

const config = getWidget("life-support");
if (!config) throw new Error("life-support missing from widgets.ts");

describe("LifeSupportSystems DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotWidgetMode({
          Widget: LifeSupportSystemsComponent,
          fixture,
          mode,
        });
        expect(html).toMatchSnapshot();
      });
    }
  }
});
