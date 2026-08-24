import { clearRegistry } from "@ksp-gonogo/core";
import { render, waitFor } from "@ksp-gonogo/test-utils";
import { ws } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { SitrepTelemetryProvider } from "./SitrepTelemetryProvider";
import { resetSitrepRuntimeForTests } from "./sitrepRuntime";

/**
 * Proves the play-blocking gap from `806e7fe2` (legacy source deletion) is
 * actually closed: with the `VITE_SITREP_STREAM` gate removed, the stream
 * must connect with ZERO configuration, no `enabled` prop, no `host`/`port`
 * prop, no env var. This test passes none of those and asserts a REAL
 * `WebSocketTransport` opens a socket to the build-time default
 * (`localhost:8090`), observed over MSW's `ws` interceptor exactly like
 * `sitrep-stream-wire.test.tsx` does for the explicit-`enabled` case.
 */

const SITREP_URL = "ws://localhost:8090";
const link = ws.link(SITREP_URL);
const server = setupServer();

beforeAll(() => server.listen());
beforeEach(() => {
  localStorage.clear();
  resetSitrepRuntimeForTests();
  // Cleared here, not in `afterEach`: see UplinkHubWizard.test.tsx for why the hook
  // matters. The previous test's tree is already unmounted by the time this runs.
  clearRegistry();
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => server.close());

describe("SitrepTelemetryProvider: on by default", () => {
  it("opens a real socket to localhost:8090 with no props and no env flags set", async () => {
    let connected = false;
    server.use(
      link.addEventListener("connection", () => {
        connected = true;
      }),
    );

    render(
      <SitrepTelemetryProvider>
        <div>child</div>
      </SitrepTelemetryProvider>,
    );

    await waitFor(() => expect(connected).toBe(true));

    // `connected` is the SERVER's view: it flips in MSW's connection handler, so
    // `waitFor` can resolve while the client-side open is still queued. That open mints a
    // store frame, which re-renders the provider's own `KspCalendarObserver`, and with
    // nothing left holding an act scope it lands during teardown. Flush it inside one.
  });
});
