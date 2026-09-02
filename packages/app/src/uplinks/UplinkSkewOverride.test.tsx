/*
 * The operator-facing half of the same line the loader draws.
 *
 * The control appears for a DECLARATION finding and for nothing else. Every
 * case below renders the real banner over the real outcome store and the real
 * localStorage-backed override module: no hook is mocked and no internal is
 * stubbed, because the whole question is whether the surface asks
 * `isOverridableIntegrityFailure` or decides for itself.
 */

import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UplinkIntegrityFailure } from "./integrity";
import {
  __resetUplinkOutcomes,
  setUplinkOutcome,
  type UplinkLoadOutcome,
} from "./loaderState";
import { __resetSkewOverrides, hasSkewOverride } from "./skewOverride";
import { UplinkIntegrityBanner } from "./UplinkIntegrityBanner";
import { UplinkSkewOverride } from "./UplinkSkewOverride";

const MOD_HASH = "sha256-1111111111111111111111111111111111111111";
const INDEX_HASH = "sha256-2222222222222222222222222222222222222222";
const BYTES_HASH = "sha256-3333333333333333333333333333333333333333";

const SKEW: UplinkIntegrityFailure = {
  subject: "declaration",
  observed: INDEX_HASH,
  observedBy: ["hub-index"],
  expected: MOD_HASH,
  vouchedBy: ["installed-mod"],
};

const TAMPERED: UplinkIntegrityFailure = {
  subject: "bundle",
  observed: BYTES_HASH,
  expected: INDEX_HASH,
  vouchedBy: ["installed-mod", "hub-index"],
};

function outcome(
  id: string,
  integrity: UplinkIntegrityFailure,
): UplinkLoadOutcome {
  return {
    id,
    name: id === "widget-a" ? "Widget A" : "Widget B",
    version: "1.0.0",
    status: "quarantined",
    reason: "hash disagreement",
    integrity,
  };
}

/*
 * Before, not after: the outcome store notifies its `useSyncExternalStore`
 * subscribers, and a clear in this file's own teardown would run before Testing
 * Library's auto-cleanup and fire into a tree that was still mounted.
 */
beforeEach(() => {
  __resetUplinkOutcomes();
  __resetSkewOverrides();
});

describe("the control appears for skew and not for a byte mismatch", () => {
  it("offers Use anyway for a declaration finding", () => {
    render(
      <UplinkSkewOverride
        outcome={outcome("widget-a", SKEW)}
        reload={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Use anyway" }),
    ).toBeInTheDocument();
  });

  it("renders nothing at all for a measured bytes mismatch", () => {
    const { container } = render(
      <UplinkSkewOverride
        outcome={outcome("widget-a", TAMPERED)}
        reload={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  /*
   * A version is half of what binds a grant to one build. Without one there is
   * no key that could be written down, so there is no decision to offer.
   */
  it("renders nothing when the loader never resolved a version", () => {
    const { container } = render(
      <UplinkSkewOverride
        outcome={{ ...outcome("widget-a", SKEW), version: undefined }}
        reload={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the prompt states both hashes, both parties, and what accepting does", () => {
  it("names the installed mod and the Hub index against their own hashes", () => {
    setUplinkOutcome(outcome("widget-a", SKEW));
    render(<UplinkIntegrityBanner />);

    expect(
      screen.getByText(
        /the Hub index and the installed mod name different clients/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(`Hub index: ${INDEX_HASH}`)).toBeInTheDocument();
    expect(screen.getByText(`installed mod: ${MOD_HASH}`)).toBeInTheDocument();
  });

  it("says nothing has been fetched, which is what makes it skew rather than tampering", () => {
    setUplinkOutcome(outcome("widget-a", SKEW));
    render(<UplinkIntegrityBanner />);

    expect(screen.getByText(/Nothing has been fetched/)).toBeInTheDocument();
    expect(screen.getByText(/No bytes were fetched/)).toBeInTheDocument();
  });

  it("states that the bundle is still hashed against the index", () => {
    setUplinkOutcome(outcome("widget-a", SKEW));
    render(<UplinkIntegrityBanner />);

    expect(
      screen.getByText(
        new RegExp(`still refused unless it hashes to ${INDEX_HASH}`),
      ),
    ).toBeInTheDocument();
  });
});

describe("the banner keeps the two findings apart", () => {
  it("shows a byte mismatch with no control beside it, even next to an overridable one", () => {
    setUplinkOutcome(outcome("widget-a", SKEW));
    setUplinkOutcome(outcome("widget-b", TAMPERED));
    render(<UplinkIntegrityBanner />);

    expect(
      screen.getByText(/the bytes on the wire are not the bytes/i),
    ).toBeInTheDocument();
    // One control, for the one overridable finding.
    expect(screen.getAllByRole("button", { name: "Use anyway" })).toHaveLength(
      1,
    );
  });

  it("grades the headline critical only when something was measured", () => {
    setUplinkOutcome(outcome("widget-a", SKEW));
    const skewOnly = render(<UplinkIntegrityBanner />);
    expect(
      skewOnly.getByText("Hash disagreement", { exact: false }),
    ).toBeInTheDocument();

    skewOnly.unmount();
    __resetUplinkOutcomes();
    setUplinkOutcome(outcome("widget-b", TAMPERED));
    render(<UplinkIntegrityBanner />);
    expect(screen.getByText("Integrity failure")).toBeInTheDocument();
  });
});

describe("accepting records a decision about this pair only", () => {
  it("writes the grant and asks for the reload that applies it", async () => {
    const reload = vi.fn();
    const user = userEvent.setup();
    render(
      <UplinkSkewOverride
        outcome={outcome("widget-a", SKEW)}
        reload={reload}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Use anyway" }));

    expect(hasSkewOverride("widget-a", "1.0.0", SKEW)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not grant anything for a different pair of hashes", async () => {
    const user = userEvent.setup();
    render(
      <UplinkSkewOverride
        outcome={outcome("widget-a", SKEW)}
        reload={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Use anyway" }));

    const laterBuild: UplinkIntegrityFailure = {
      ...SKEW,
      observed: "sha256-4444444444444444444444444444444444444444",
    };
    expect(hasSkewOverride("widget-a", "1.0.0", laterBuild)).toBe(false);
  });

  it("offers a withdrawal once a decision is on record", async () => {
    const reload = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <UplinkSkewOverride
        outcome={outcome("widget-a", SKEW)}
        reload={reload}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Use anyway" }));
    view.rerender(
      <UplinkSkewOverride
        outcome={outcome("widget-a", SKEW)}
        reload={reload}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Withdraw override" }));
    expect(hasSkewOverride("widget-a", "1.0.0", SKEW)).toBe(false);
  });
});

describe("accessibility", () => {
  it("has no violations with both kinds of finding on screen", async () => {
    setUplinkOutcome(outcome("widget-a", SKEW));
    setUplinkOutcome(outcome("widget-b", TAMPERED));
    const { container } = render(<UplinkIntegrityBanner />);

    await expectNoA11yViolations(container);
  });
});
