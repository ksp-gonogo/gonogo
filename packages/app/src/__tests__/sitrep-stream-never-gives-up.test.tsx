import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
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
  vi,
} from "vitest";
import { SustainedFailureBanner } from "../components/SustainedFailureBanner";
import { sitrepStreamSource } from "../dataSources/sitrep";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import {
  getSitrepTransportStatus,
  resetSitrepRuntimeForTests,
} from "../telemetry/sitrepRuntime";

/**
 * A page left open while the game is down for longer than any fixed retry
 * budget: a heavily modded cold boot takes about four and a half minutes, so an
 * ordinary restart outlasts a five-minute give-up once the page has been
 * waiting a little before it. The transport must still be knocking when the
 * game comes back, and the operator must be able to knock now.
 */

const link = ws.link("ws://localhost:8090");
const server = setupServer();
let attempts = 0;

beforeAll(() => server.listen());
beforeEach(() => {
  attempts = 0;
  // Counts every socket the page opens, whether or not a server answers it.
  // Taken per test: MSW swaps the global in when the server starts listening.
  const InterceptedWebSocket = globalThis.WebSocket;
  vi.stubGlobal(
    "WebSocket",
    class extends InterceptedWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        attempts++;
        super(url, protocols);
      }
    },
  );
  registerDataSource(sitrepStreamSource);
  takeServerDown();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  server.resetHandlers();
  clearRegistry();
  resetSitrepRuntimeForTests();
  vi.useRealTimers();
});
afterAll(() => server.close());

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The game is down: every socket the page opens is closed before it opens. */
function takeServerDown() {
  server.resetHandlers(
    link.addEventListener("connection", ({ client }) => client.close(1011)),
  );
}

/** The game is back: the next socket the page opens is accepted. */
function bringServerUp() {
  server.resetHandlers(link.addEventListener("connection", () => {}));
}

function mount() {
  return render(
    <SitrepTelemetryProvider enabled host="localhost" port={8090}>
      <SustainedFailureBanner />
    </SitrepTelemetryProvider>,
  );
}

describe("the Sitrep stream never stops reconnecting", () => {
  it("is still retrying after the old five-minute cap and connects once the game returns", async () => {
    mount();
    for (let i = 0; i < 40; i++) await advance(10_000);
    const attemptsAtSixAndAHalfMinutes = attempts;

    await advance(120_000);
    expect(attempts).toBeGreaterThan(attemptsAtSixAndAHalfMinutes);
    expect(getSitrepTransportStatus()).toBe("reconnecting");

    bringServerUp();
    await advance(31_000);
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
  });

  it("retries at once when the network comes back, without waiting out the backoff", async () => {
    mount();
    for (let i = 0; i < 40; i++) await advance(10_000);
    bringServerUp();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
  });

  it("offers Retry now on the offline banner, and pressing it reconnects without waiting out the backoff", async () => {
    const { container } = mount();
    for (let i = 0; i < 40; i++) await advance(10_000);

    expect(screen.getByText(/SOURCE OFFLINE/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /retry .* now/i });
    await expectNoA11yViolations(container);

    bringServerUp();
    const before = attempts;
    fireEvent.click(button);
    expect(attempts).toBe(before + 1);
    await waitFor(() => expect(getSitrepTransportStatus()).toBe("connected"));
    await waitFor(() =>
      expect(screen.queryByText(/SOURCE OFFLINE/)).not.toBeInTheDocument(),
    );
  });
});
