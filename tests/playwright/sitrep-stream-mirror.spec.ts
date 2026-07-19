/**
 * Recorded-flight-style Sitrep stream test — successor to
 * `replay-mirror.spec.ts` (removed), which proved a real `TelemachusDataSource`
 * decoding a replayed flight and PBDS mirroring representative key shapes
 * (string/number/boolean) to the station over PeerJS.
 *
 * Both halves of that premise changed with the R6 cutover
 * (`806e7fe2`, "delete the legacy Telemachus data source"):
 *
 *   1. The app's only telemetry source is now the Sitrep stream
 *      (`SitrepTelemetryProvider` / `WebSocketTransport` /
 *      `TimelineStore`), not `TelemachusDataSource` — so this test replays
 *      against `sitrep-stream-server.mjs` instead.
 *   2. `main.tsx`'s `__gonogo_get_value__` debug hook — the mechanism the
 *      old test used to read decoded values directly off the window,
 *      bypassing the DOM — was deleted alongside the `DataSource` (its only
 *      consumer). There is no replacement; this test reads rendered DOM
 *      text instead, same as every other widget-DOM-mirror spec.
 *
 * What this test still proves: a REAL `WebSocketTransport` decoding REAL
 * wire frames across the shapes the wire protocol carries — string + array
 * (`vessel.crew.{count,crew[].name}`) and boolean
 * (`vessel.comms.connected`) — reaching a real `TimelineStore` and
 * rendering correctly through `useTelemetry` into the DOM.
 * (Number and nested-object shapes get their own dedicated coverage in
 * `widgets/semi-major-axis.spec.ts` and `widgets/thermal-status.spec.ts`
 * respectively — not duplicated here.) That's the SDK's decode path, end
 * to end, the same guarantee the old test gave for Telemachus's wire
 * format.
 *
 * What it does NOT (yet) prove: station-side mirroring of that data. Only
 * the MAIN screen mounts `SitrepTelemetryProvider` — station stream
 * forwarding over PeerJS is a documented pending gap (see that provider's
 * own doc comment, "a later task"). The station half of this test still
 * boots a real peer connection and confirms the station's dashboard mounts
 * — the same connectivity proof `main-station.spec.ts` gives — just not a
 * value-equality assertion on Sitrep-stream data, which the app doesn't
 * carry to the station yet.
 */
import { expect, test } from "@playwright/test";
import { bootstrapPair, teardownPair } from "./helpers";

test.describe("Sitrep stream — recorded flight mirror", () => {
  test("host renders every representative value shape; station connects", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "crew-manifest", {
      waitForMain: async (page) => {
        await expect(page.getByText("CREW", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    // String + array shape: vessel.crew.crew[0].name via CrewManifest,
    // already on the dashboard.
    await expect(
      pair.main.getByText("Bob Kerman", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      pair.main.getByText("1 / 1 aboard", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Station proves real connectivity — the dashboard mounts, the widget
    // renders its static chrome — without asserting on stream-derived
    // content (see module doc comment for why).
    await expect(pair.station.getByText("CREW", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await teardownPair(pair);
  });

  test("host renders the boolean stream shape", async ({ browser }) => {
    const pair = await bootstrapPair(browser, "comm-signal", {
      waitForMain: async (page) => {
        await expect(page.getByText("COMMNET", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    // Boolean shape: vessel.comms.connected === false -> LOS state.
    await expect(pair.main.getByText("LOS", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await teardownPair(pair);
  });
});
