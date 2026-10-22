import { fireEvent, render, screen, within } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { onSettingsRequested } from "../settings/settingsRequest";
import type { UplinkIntegrityFailure } from "./integrity";
import {
  __resetUplinkOutcomes,
  setUplinkOutcome,
  setUplinksSettled,
  type UplinkLoadOutcome,
} from "./loaderState";
import { UplinkIntegrityBanner } from "./UplinkIntegrityBanner";

const BYTES_HASH = "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VOUCHED_HASH = "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function tampered(
  overrides: Partial<UplinkIntegrityFailure> = {},
): UplinkIntegrityFailure {
  return {
    subject: "bundle",
    observed: BYTES_HASH,
    expected: VOUCHED_HASH,
    vouchedBy: ["installed-mod", "hub-index"],
    ...overrides,
  };
}

function record(outcome: UplinkLoadOutcome): void {
  setUplinkOutcome(outcome);
}

/*
 * The clear runs BEFORE each test, not after. The outcome store is module
 * scoped and notifies its `useSyncExternalStore` subscribers, and vitest runs
 * `afterEach` hooks in reverse registration order, so this file's own teardown
 * would run before Testing Library's auto-cleanup and clear the store into a
 * tree that was still mounted: an act warning every time. Here the previous
 * test's tree is already gone and nothing is listening.
 */
beforeEach(() => {
  __resetUplinkOutcomes();
});

describe("UplinkIntegrityBanner", () => {
  it("says nothing when nothing has been loaded", () => {
    const { container } = render(<UplinkIntegrityBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing when everything loaded", () => {
    record({ id: "widget-a", name: "Widget A", status: "loaded" });
    const { container } = render(<UplinkIntegrityBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  /*
   * The distinction the whole surface exists for. An Uplink that could not run
   * here is disappointing and belongs in the Settings list an operator opens
   * when they miss a widget. Firing this banner for one would spend the loud
   * channel on the ordinary case and leave the operator unable to tell the two
   * apart, which is where this started.
   */
  it("stays silent for an ordinary quarantine, however it was worded", () => {
    record({
      id: "widget-a",
      name: "Widget A",
      status: "quarantined",
      reason: "apiVersion major mismatch: client 2.0.0, host 1.2.0",
    });
    record({
      id: "widget-b",
      name: "Widget B",
      status: "quarantined",
      reason: "bundle fetch failed: HTTP 404",
    });
    record({
      id: "widget-y",
      name: "Widget Y",
      status: "quarantined",
      reason: "consent declined",
    });

    const { container } = render(<UplinkIntegrityBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shouts, names the Uplink, and carries both hashes for a hash mismatch", () => {
    record({
      id: "widget-a",
      name: "Widget A",
      version: "1.0.0",
      status: "quarantined",
      reason: `bundle hash ${BYTES_HASH} != index ${VOUCHED_HASH} (tampered or wrong URL)`,
      integrity: tampered(),
    });

    render(<UplinkIntegrityBanner />);

    expect(screen.getByText("Integrity failure")).toBeInTheDocument();
    expect(
      screen.getByText("1 Uplink client quarantined before import"),
    ).toBeInTheDocument();
    expect(screen.getByText("Widget A")).toBeInTheDocument();
    expect(screen.getByText("widget-a@1.0.0")).toBeInTheDocument();
    expect(screen.getByText(`bundle bytes: ${BYTES_HASH}`)).toBeInTheDocument();
    expect(
      screen.getByText(`installed mod and Hub index: ${VOUCHED_HASH}`),
    ).toBeInTheDocument();
  });

  /*
   * The two parties are not interchangeable, and the banner is where an
   * operator reads which one was disagreed with: a bundle that does not match
   * its own published descriptor is a broken release, and a bundle that does
   * not match the mod they installed is the bytes not being the vouched ones.
   */
  it("names the Hub index alone where the mod vouched no hash", () => {
    record({
      id: "widget-a",
      name: "Widget A",
      status: "quarantined",
      reason: "hash mismatch",
      integrity: tampered({ vouchedBy: ["hub-index"] }),
    });

    render(<UplinkIntegrityBanner />);

    expect(
      screen.getByText(
        "The bundle served at this URL is not the one the Hub index named",
      ),
    ).toBeInTheDocument();
  });

  it("names the installed mod alone for a third-party bundle", () => {
    record({
      id: "widget-y",
      name: "Widget Y",
      status: "quarantined",
      reason: "hash mismatch",
      integrity: tampered({ vouchedBy: ["installed-mod"] }),
    });

    render(<UplinkIntegrityBanner />);

    expect(
      screen.getByText(
        "The bundle served at this URL is not the one the installed mod named",
      ),
    ).toBeInTheDocument();
  });

  it("names both when the bytes disagree with the mod and the index at once", () => {
    record({
      id: "widget-a",
      name: "Widget A",
      status: "quarantined",
      reason: "hash mismatch",
      integrity: tampered(),
    });

    render(<UplinkIntegrityBanner />);

    expect(
      screen.getByText(
        "The bundle served at this URL is not the one the installed mod and the Hub index named",
      ),
    ).toBeInTheDocument();
  });

  it("distinguishes a manifest that disagreed before any bytes were fetched", () => {
    record({
      id: "widget-y",
      name: "Widget Y",
      status: "quarantined",
      reason: "manifest-declared integrity != mod-vouched",
      integrity: tampered({
        subject: "manifest",
        vouchedBy: ["installed-mod"],
      }),
    });

    render(<UplinkIntegrityBanner />);

    expect(
      screen.getByText(
        "The bundle's own manifest declares a different client from the one the installed mod named",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`bundle manifest: ${BYTES_HASH}`),
    ).toBeInTheDocument();
  });

  it("counts every failure rather than reporting only the first", () => {
    record({
      id: "widget-a",
      name: "Widget A",
      status: "quarantined",
      reason: "hash mismatch",
      integrity: tampered(),
    });
    record({
      id: "widget-y",
      name: "Widget Y",
      status: "quarantined",
      reason: "hash mismatch",
      integrity: tampered({ vouchedBy: ["installed-mod"] }),
    });

    render(<UplinkIntegrityBanner />);

    expect(
      screen.getByText("2 Uplink clients quarantined before import"),
    ).toBeInTheDocument();
    expect(screen.getByText("Widget A")).toBeInTheDocument();
    expect(screen.getByText("Widget Y")).toBeInTheDocument();
  });

  /*
   * A quarantine is a persistent state, not a notification, so there is nothing
   * to press that makes the fact go away while the fault stays. The banner
   * clears when the store clears and not before.
   */
  it("offers no control that dismisses the finding", () => {
    record({
      id: "widget-a",
      name: "Widget A",
      status: "quarantined",
      reason: "hash mismatch",
      integrity: tampered(),
    });

    render(<UplinkIntegrityBanner />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  /*
   * Polite, not assertive. The loader already refused before `import()`, so
   * nothing from the bundle is running and there is no in-flight action to
   * abort: this is a completed refusal being reported, which is the polite
   * channel's case. The assertive one stays reserved for ABORT.
   */
  it("reports through the polite channel, leaving the interrupting one to ABORT", () => {
    record({
      id: "widget-a",
      name: "Widget A",
      status: "quarantined",
      reason: "hash mismatch",
      integrity: tampered(),
    });

    render(<UplinkIntegrityBanner />);

    const note = screen.getByRole("note", { name: "Uplink integrity" });
    const announcer = document.querySelector("[data-live-region]");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer?.textContent).toContain(
      within(note).getByText(/Widget A/).textContent ?? "missing",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("has no a11y violations", async () => {
    record({
      id: "widget-a",
      name: "Widget A",
      version: "1.0.0",
      status: "quarantined",
      reason: "hash mismatch",
      integrity: tampered(),
    });

    const { container } = render(<UplinkIntegrityBanner />);
    await expectNoA11yViolations(container);
  });

  describe("the line counting other quarantines", () => {
    const refused = (id: string): UplinkLoadOutcome => ({
      id,
      name: `Widget ${id}`,
      status: "quarantined",
      reason: "no mod-vouched client hash",
    });

    it("stands alone when nothing failed integrity and something else is quarantined", () => {
      record(refused("a"));
      record(refused("b"));
      setUplinksSettled();

      render(<UplinkIntegrityBanner />);

      expect(
        screen.getByText("2 Uplinks quarantined, see"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Settings > Uplinks" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Integrity failure")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("note", { name: "Uplink integrity" }),
      ).not.toBeInTheDocument();
    });

    it("follows the integrity failures as a count of more", () => {
      record({
        id: "t",
        name: "Tampered",
        status: "quarantined",
        reason: "hash mismatch",
        integrity: tampered(),
      });
      record(refused("a"));
      setUplinksSettled();

      render(<UplinkIntegrityBanner />);

      const region = screen.getByRole("note", { name: "Uplink integrity" });
      expect(
        within(region).getByText("1 more quarantined, see"),
      ).toBeInTheDocument();
    });

    it("says nothing about the count until a load pass has settled", () => {
      record(refused("a"));
      record({
        id: "t",
        name: "Tampered",
        status: "quarantined",
        reason: "hash mismatch",
        integrity: tampered(),
      });

      render(<UplinkIntegrityBanner />);

      expect(screen.queryByText(/quarantined, see/)).not.toBeInTheDocument();
      expect(screen.getByText("Integrity failure")).toBeInTheDocument();
    });

    it("counts neither an Uplink the operator skipped nor a zero", () => {
      record({ ...refused("a"), skippedByOperator: true });
      setUplinksSettled();

      const { container } = render(<UplinkIntegrityBanner />);

      expect(container).toBeEmptyDOMElement();
    });

    it("opens Settings on the Uplinks page", () => {
      const asked: (string | undefined)[] = [];
      const off = onSettingsRequested((tab) => asked.push(tab));
      record(refused("a"));
      setUplinksSettled();
      render(<UplinkIntegrityBanner />);

      fireEvent.click(
        screen.getByRole("button", { name: "Settings > Uplinks" }),
      );
      off();

      expect(asked).toEqual(["uplinks"]);
    });

    it("has no a11y violations", async () => {
      record(refused("a"));
      setUplinksSettled();
      const { container } = render(<UplinkIntegrityBanner />);
      await expectNoA11yViolations(container);
    });
  });

  describe("a mod and a client of the same version built from different clients", () => {
    const sameVersion = (): UplinkLoadOutcome => ({
      id: "widget-k",
      name: "Widget K",
      version: "1.0.0-rc.3",
      status: "quarantined",
      reason: "manifest-declared integrity != mod-vouched",
      integrity: tampered({
        subject: "manifest",
        vouchedBy: ["installed-mod"],
        sameVersion: "1.0.0-rc.3",
      }),
    });

    it("says the mod was built from a different client and what to do, not that it was tampered with", () => {
      record(sameVersion());

      render(<UplinkIntegrityBanner />);

      expect(
        screen.getByText(
          "The installed mod was built from a different client than the one served. Both say 1.0.0-rc.3",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Reinstall the mod and its Uplinks from one release."),
      ).toBeInTheDocument();
      expect(screen.queryByText("Integrity failure")).not.toBeInTheDocument();
    });

    it("still shouts an integrity failure for a bundle whose bytes are not the vouched ones", () => {
      record({
        ...sameVersion(),
        integrity: tampered({ sameVersion: "1.0.0-rc.3" }),
      });

      render(<UplinkIntegrityBanner />);

      expect(screen.getByText("Integrity failure")).toBeInTheDocument();
      expect(
        screen.queryByText(/built from a different client/),
      ).not.toBeInTheDocument();
    });

    it("still shouts an integrity failure for a manifest of another version", () => {
      record({
        ...sameVersion(),
        integrity: tampered({
          subject: "manifest",
          vouchedBy: ["installed-mod"],
        }),
      });

      render(<UplinkIntegrityBanner />);

      expect(screen.getByText("Integrity failure")).toBeInTheDocument();
    });

    it("has no a11y violations", async () => {
      record(sameVersion());
      const { container } = render(<UplinkIntegrityBanner />);
      await expectNoA11yViolations(container);
    });
  });
});
