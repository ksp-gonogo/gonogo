import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

/**
 * Mobile sizing regression — CameraFeed at full mobile width.
 *
 * The 2026-05-18 self-test surfaced a regression where the CameraFeed
 * widget rendered as a flat ~2:0.5 band on portrait phones instead of
 * a useful 3:2 box. Root cause was the missing `mobileHeight` on the
 * component registration: MobileDashboard defaults to
 * `defaultSize.h * ROW_HEIGHT` (6 * 25 = 150px) which is too short for
 * a 16:9 hullcam frame. Fix shipped in commit 1f19556 sets
 * `mobileHeight: 240`.
 *
 * This spec catches that regression in CI by booting a touch-emulated
 * context (which routes through MobileDashboard rather than the
 * responsive grid) and asserting the CameraFeed container actually
 * gets the height it asks for.
 *
 * Doesn't exercise the WebRTC media pipe — `camera-stream.spec.ts`
 * already covers that. Doesn't depend on the relay either, since the
 * sizing assertion fires whether a track arrives or not (the
 * placeholder + video both fill the Feed container).
 */

// CameraFeed.registerComponent has `mobileHeight: 240`. MobileDashboard
// subtracts its own per-row chrome (reorder buttons, padding) from the
// rendered inner container, so the actual measured height comes out
// around ~200 in practice (208 observed locally). We don't pin the
// exact value — what we care about is catching the #25 regression
// where defaultSize.h=6 * ROW_HEIGHT=25 produced ~150 px.
//
// Lower bound 180: well above the 150-px regression band, still
// loose enough not to flake on minor padding tweaks.
// Upper bound 300: catches a hypothetical mobileHeight=600 mistake
// that would push the widget off-screen on a 812-px viewport.
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 300;

const MOBILE_VIEWPORT = { width: 375, height: 812 } as const;

test.describe("CameraFeed mobile sizing", () => {
  test("renders at the registered mobileHeight on host + station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "camera-feed", {
      widget: {
        config: {
          mode: "single",
          // Same camera id the fake OCISLY serves; we don't assert on
          // the stream content (just sizing), but specifying the id
          // means the widget reaches the Feed render path rather than
          // staying on the Placeholder forever waiting for a stream
          // pick. With no relay reachable the widget shows
          // "Waiting for X…" inside the Feed container — and the
          // container itself still has the mobileHeight box.
          cameraId: "cam-test-1",
        },
      },
      contextOptions: {
        viewport: MOBILE_VIEWPORT,
        hasTouch: true,
        // Without isMobile=true, Playwright still emulates touch but
        // doesn't set the mobile UA quirks that some sites use. The
        // gonogo isTouch detector is `'ontouchstart' in window`, so
        // `hasTouch: true` is enough — `isMobile` is here just so the
        // context reads as "real phone" if anything downstream depends
        // on it. Cheap and avoids future surprises.
        isMobile: true,
      },
      waitForMain: async (page) => {
        // Wait for the dashboard scaffold; the widget specifically
        // renders inside a list item the MobileDashboard creates.
        await page.waitForSelector(
          "[data-testid='mobile-widget'], video, [role='img']",
          {
            timeout: 30_000,
          },
        );
      },
    });

    for (const page of [pair.main, pair.station]) {
      // Measure the CameraFeed widget's bounding box. The
      // MobileDashboard wraps each widget in a styled component; we
      // grab the closest container of the rendered widget content.
      // The CameraFeed's <Feed> div is the outermost widget chrome —
      // <video> sits inside it. Climb until we hit the wrapper.
      const height = await page.evaluate(() => {
        // Find any element belonging to the camera-feed widget.
        // CameraFeed renders either a <video> (when a stream lands)
        // or a Placeholder (otherwise). Either case gives us a way
        // in.
        const seed =
          (document.querySelector("video") as HTMLElement | null) ??
          (document.querySelector(
            "[role='img'][aria-label]",
          ) as HTMLElement | null);
        if (!seed) return null;
        // Walk up to the MobileDashboard's per-widget row. That row
        // is the element whose inline style sets `height` from the
        // widget's mobileHeight; it's the closest ancestor with an
        // explicit pixel height greater than the seed's own.
        let cursor: HTMLElement | null = seed;
        while (cursor && cursor !== document.body) {
          const rect = cursor.getBoundingClientRect();
          // Heuristic: the widget row is the first ancestor at least
          // 200px tall whose width spans most of the viewport. That
          // skips the inner overlay/canvas wrappers (which fill the
          // parent but match the parent's dimensions exactly).
          if (rect.height >= 200 && rect.width >= window.innerWidth * 0.8) {
            return rect.height;
          }
          cursor = cursor.parentElement;
        }
        return null;
      });

      expect(height, `widget container height on ${page.url()}`).not.toBeNull();
      expect(height ?? 0).toBeGreaterThanOrEqual(MIN_HEIGHT);
      expect(height ?? 0).toBeLessThanOrEqual(MAX_HEIGHT);
    }

    await teardownPair(pair);
  });
});
