import { SerialDeviceService } from "@ksp-gonogo/serial";
import { render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
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
import { SettingsService } from "../settings/SettingsService";
import { axe } from "../test/axe";
import { UplinkHubWizardHost } from "./UplinkHubWizardHost";
import {
  __resetUplinkHubWizardFirstRunForTests,
  hasSeenUplinkHubWizard,
  markUplinkHubWizardSeen,
} from "./wizardFirstRun";

/**
 * Proves the first-run auto-open host (design §1: "auto-opens once on first
 * boot", deferred by Task C to this task) — real `ModalProvider` +
 * `SettingsModal`, only the Hub registry HTTP fetch intercepted (MSW), same
 * boundary `SettingsModal.test.tsx`'s own Uplink Hub describe block uses.
 */

const server = setupServer(
  http.get("*/uplinks/registry.local.json", () =>
    HttpResponse.json({ uplinks: [] }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    length: m.size,
    clear: () => m.clear(),
    key: () => null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  } as Storage;
}

function renderHost() {
  const settingsService = new SettingsService(memoryStorage());
  const serialService = new SerialDeviceService({ screenKey: "test" });
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ModalProvider>
        <UplinkHubWizardHost
          settingsService={settingsService}
          serialService={serialService}
        />
      </ModalProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  __resetUplinkHubWizardFirstRunForTests();
});

describe("UplinkHubWizardHost", () => {
  it("auto-opens the Settings modal pre-selected to the Uplink Hub tab on first run", async () => {
    renderHost();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Uplink Hub", selected: true }),
    ).toBeInTheDocument();
    // firstRun bookend — the Welcome step, not the plain "setup" step Task C
    // shipped for the persistent entry point.
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("marks the first-run flag the instant it opens (idempotent even if never finished)", async () => {
    renderHost();
    await screen.findByRole("dialog");
    expect(hasSeenUplinkHubWizard()).toBe(true);
  });

  it("does not open when the flag is already seen", () => {
    markUplinkHubWizardSeen();
    renderHost();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not re-auto-open after the operator closes it, even from a fresh host mount", async () => {
    const { unmount } = renderHost();
    const dialog = await screen.findByRole("dialog");
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    unmount();
    renderHost();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("has no axe violations on the auto-opened first-run modal", async () => {
    renderHost();
    await screen.findByRole("dialog");
    // The modal renders via a portal into `document.body`, not into RTL's
    // `container` — same reason `Modal.tsx`'s own dialog implementation
    // uses `createPortal`.
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
