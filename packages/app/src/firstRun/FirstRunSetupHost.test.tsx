import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { AnalyticsConsentModal } from "../analytics/AnalyticsConsentModal";
import { AnalyticsConsentService } from "../analytics/AnalyticsConsentService";
import { FirstRunSetupHost } from "./FirstRunSetupHost";
import {
  __resetFirstRunSetupForTests,
  hasSeenFirstRunSetup,
  markFirstRunSetupSeen,
} from "./firstRunFlag";

/**
 * Proves the first-run auto-open host: real `ModalProvider` + the real setup
 * flow, nothing mocked. No telemetry provider is mounted, which is fine here:
 * these cases are about whether and when the modal opens, and the flow opens on
 * its Welcome step, which reads nothing.
 */

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

function renderHost(analyticsConsent?: AnalyticsConsentService) {
  // Answered by default: these cases are about the first-run flag, not the
  // consent gate, and an unanswered gate deliberately holds the auto-open.
  const consent = analyticsConsent ?? answeredConsent();
  return render(
    <ModalProvider>
      <FirstRunSetupHost analyticsConsent={consent} />
    </ModalProvider>,
  );
}

function answeredConsent(): AnalyticsConsentService {
  const svc = new AnalyticsConsentService(memoryStorage());
  svc.set("disabled");
  return svc;
}

beforeEach(() => {
  __resetFirstRunSetupForTests();
});

describe("FirstRunSetupHost", () => {
  it("auto-opens the setup flow on its first step on first run", async () => {
    renderHost();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 4: Welcome")).toBeInTheDocument();
  });

  it("marks the first-run flag the instant it opens (idempotent even if never finished)", async () => {
    renderHost();
    await screen.findByRole("dialog");
    expect(hasSeenFirstRunSetup()).toBe(true);
  });

  it("does not open when the flag is already seen", () => {
    markFirstRunSetupSeen();
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

  it("closes the modal when the flow's own last step finishes", async () => {
    renderHost();
    await screen.findByRole("dialog");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Check Uplinks" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("has no axe violations on the auto-opened first-run modal", async () => {
    renderHost();
    await screen.findByRole("dialog");
    /*
     * The modal renders via a portal into `document.body`, not into RTL's
     * `container`: same reason `Modal.tsx`'s own dialog implementation uses
     * `createPortal`.
     */
    await expectNoA11yViolations(document.body);
  });

  it("holds the auto-open while the analytics consent gate is unanswered", async () => {
    const consent = new AnalyticsConsentService(memoryStorage());
    renderHost(consent);
    // Nothing opens, and crucially the one first-run auto-open is not spent
    // on a modal the operator never got to see.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(hasSeenFirstRunSetup()).toBe(false);
  });

  it("opens as soon as the operator answers the consent gate", async () => {
    const consent = new AnalyticsConsentService(memoryStorage());
    renderHost(consent);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      consent.set("disabled");
    });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(hasSeenFirstRunSetup()).toBe(true);
  });

  it("never leaves two aria-modal dialogs reachable at once on first boot", async () => {
    const consent = new AnalyticsConsentService(memoryStorage());
    const { container } = render(<ConsentThenSetup consent={consent} />);
    expect(container).toBeTruthy();

    // Boot: the consent gate is the only modal in the tree.
    await screen.findByRole("dialog", { name: /improve gonogo/i });
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Decline" }));

    // Consent answered: the setup flow takes its place, still exactly one.
    await waitFor(() =>
      expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1),
    );
    expect(screen.getByText("Step 1 of 4: Welcome")).toBeInTheDocument();
  });
});

/**
 * The first-boot pairing as `MainScreen` mounts it: the analytics gate and the
 * setup host as siblings, both live at once. `AnalyticsConsentHost` itself
 * needs a `PeerHostService`, which has nothing to do with the modal ordering
 * under test, so this stands in with the modal and the same "render while
 * unanswered" rule.
 */
function ConsentThenSetup({
  consent,
}: Readonly<{ consent: AnalyticsConsentService }>) {
  return (
    <ModalProvider>
      <ConsentGate service={consent} />
      <FirstRunSetupHost analyticsConsent={consent} />
    </ModalProvider>
  );
}

function ConsentGate({
  service,
}: Readonly<{ service: AnalyticsConsentService }>) {
  const [answered, setAnswered] = useState(() => service.hasAnswered());
  useEffect(
    () => service.subscribe(() => setAnswered(service.hasAnswered())),
    [service],
  );
  if (answered) return null;
  return <AnalyticsConsentModal service={service} />;
}
