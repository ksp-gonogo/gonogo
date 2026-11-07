import {
  clearUplinkBanner,
  defineUplinkClient,
  raiseUplinkBanner,
  UPLINK_BANNER_LIMITS,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UplinkBanners } from "./UplinkBanners";
import { resetUplinkBannersForTest } from "./uplinkBannerStore";

/*
 * The widget side imports from the published barrel, exactly as an Uplink does,
 * and the call resolves through the host `src/test/setup.ts` installs.
 */
const UPLINK = defineUplinkClient({
  id: "banner-test",
  version: "0.0.0-test",
  name: "Imaginary Uplink",
  description: "Raises banners in tests.",
});
const OTHER = defineUplinkClient({
  id: "banner-other",
  version: "0.0.0-test",
  name: "Other Uplink",
  description: "Raises banners in tests.",
});

afterEach(() => {
  act(() => resetUplinkBannersForTest());
});

describe("Uplink banners", () => {
  it("shows a raised banner labelled with the Uplink and removes it when cleared", () => {
    render(<UplinkBanners />);
    expect(screen.queryByText("Link lost")).toBeNull();
    act(() =>
      raiseUplinkBanner(UPLINK, {
        id: "link",
        severity: "warning",
        text: "Link lost",
      }),
    );
    expect(screen.getByText("Imaginary Uplink")).toBeInTheDocument();
    expect(screen.getByText("Link lost")).toBeInTheDocument();
    act(() => clearUplinkBanner(UPLINK, "link"));
    expect(screen.queryByText("Link lost")).toBeNull();
  });

  it("updates the banner when the same id is raised again instead of stacking a copy", () => {
    render(<UplinkBanners />);
    act(() => {
      raiseUplinkBanner(UPLINK, { id: "link", severity: "info", text: "One" });
      raiseUplinkBanner(UPLINK, {
        id: "link",
        severity: "critical",
        text: "Two",
      });
    });
    expect(screen.queryByText("One")).toBeNull();
    expect(screen.getAllByText("Two")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Two");
  });

  it("keeps ids of different Uplinks apart", () => {
    render(<UplinkBanners />);
    act(() => {
      raiseUplinkBanner(UPLINK, { id: "x", severity: "info", text: "Mine" });
      raiseUplinkBanner(OTHER, { id: "x", severity: "info", text: "Theirs" });
    });
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.getByText("Theirs")).toBeInTheDocument();
  });

  it("caps one Uplink's banners and leaves another Uplink's alone", () => {
    render(<UplinkBanners />);
    act(() => {
      for (let i = 0; i < UPLINK_BANNER_LIMITS.maxBanners + 2; i++) {
        raiseUplinkBanner(UPLINK, {
          id: `b${i}`,
          severity: "info",
          text: `Flood ${i}`,
        });
      }
      raiseUplinkBanner(OTHER, {
        id: "ok",
        severity: "info",
        text: "Still here",
      });
    });
    expect(screen.getAllByText(/^Flood /)).toHaveLength(
      UPLINK_BANNER_LIMITS.maxBanners,
    );
    expect(screen.getByText("Still here")).toBeInTheDocument();
    // Updating a banner it already has is still allowed at the cap.
    act(() =>
      raiseUplinkBanner(UPLINK, {
        id: "b0",
        severity: "info",
        text: "Updated",
      }),
    );
    expect(screen.getByText("Updated")).toBeInTheDocument();
  });

  it("cuts text past the limit", () => {
    render(<UplinkBanners />);
    const long = "x".repeat(UPLINK_BANNER_LIMITS.maxTextLength + 50);
    act(() =>
      raiseUplinkBanner(UPLINK, { id: "long", severity: "info", text: long }),
    );
    const shown = screen.getByText(/^x+\.\.\.$/).textContent ?? "";
    expect(shown).toHaveLength(UPLINK_BANNER_LIMITS.maxTextLength);
  });

  it("runs the action, and stays dismissed until the text changes", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<UplinkBanners />);
    const raise = (text: string) =>
      act(() =>
        raiseUplinkBanner(UPLINK, {
          id: "link",
          severity: "warning",
          text,
          action: { label: "Retry", onAction },
        }),
      );
    raise("Link lost");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onAction).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: "Dismiss Imaginary Uplink banner" }),
    );
    expect(screen.queryByText("Link lost")).toBeNull();
    raise("Link lost");
    expect(screen.queryByText("Link lost")).toBeNull();
    raise("Link lost again");
    expect(screen.getByText("Link lost again")).toBeInTheDocument();
  });
});
