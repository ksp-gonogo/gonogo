import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";
import {
  CHUNK_MS,
  clipSeconds,
  closeAll,
  FAR_SECONDS,
  keyDown,
  keyUp,
  NAMES,
  NEAR,
  NEAR_SECONDS,
  openConversation,
  openScreen,
  publishScene,
  reception,
  type Screen,
  speak,
  waitForReception,
} from "./commcast-radio-scene";
import { getHostPeerId } from "./helpers";

/**
 * A screen that joins while somebody is already talking hears them from the
 * point it joined, one light-time later at its own vantage.
 *
 * Mission control keys to the near craft and keeps talking. The far craft, nine
 * seconds out, is not on the mesh when the key goes down: it opens partway
 * through. It never saw the first chunk go past, and it must still place and
 * decode every chunk spoken after it joined, hearing the first of them nine
 * seconds after it was spoken and nothing of what was said before.
 */

/** Thirty seconds of talking: long enough to open a whole screen partway through. */
const CHUNKS = 1_500;

/** How far into the keying the far craft starts opening. */
const JOIN_AFTER_MS = 4_000;

test.use({ video: "off", trace: "off" });
test.describe.configure({ timeout: 300_000 });

/** Chromium only, for the peer-link reason `commcast-radio.spec.ts` records. */
test.describe("commcast radio: a screen joining mid-transmission @chromium-only", () => {
  test("hears the rest of it from where it joined, after its own light-time", async ({
    browser,
  }, testInfo) => {
    await publishScene([
      PORTS.radioStream.ksc,
      PORTS.radioStream.near,
      PORTS.radioStream.far,
    ]);
    const videoDir = testInfo.outputPath("videos");
    const control = await openScreen(browser, {
      name: "mission-control",
      url: "/?uplinkLoaderIds=",
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir,
      clip: { name: "ground to near craft", chunks: CHUNKS },
    });
    const shareCode = await getHostPeerId(control.page);
    const near = await openScreen(browser, {
      name: "near-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.near,
      videoDir,
      clip: { name: "near craft", chunks: 10 },
      host: control.page,
    });
    const screens: Screen[] = [control, near];

    try {
      await openConversation(control.page, NAMES[NEAR]);
      const keyedAt = await keyDown(control.page);
      await speak(control.page, CHUNKS);

      await control.page.waitForTimeout(JOIN_AFTER_MS);
      const joiningFrom = Date.now();
      const far = await openScreen(browser, {
        name: "far-craft",
        url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
        dashboardKey: "gonogo:dashboard:main",
        sitrepPort: PORTS.radioStream.far,
        videoDir,
        clip: { name: "far craft", chunks: 10 },
        host: control.page,
      });
      screens.push(far);
      const joinedBy = Date.now();
      const spokenBeforeJoin = (await reception(control.page)).spoken;
      expect(
        spokenBeforeJoin,
        "the far craft must join with the transmission still running",
      ).toBeLessThan(CHUNKS - 100);

      await waitForReception(far.page, (r) => r.firstDecodeAt !== null, {
        timeout: 40_000,
        message: "the far craft never heard the transmission it joined",
      });

      await control.page.waitForTimeout(
        Math.max(0, keyedAt + clipSeconds(CHUNKS) * 1000 - Date.now()) + 300,
      );
      await keyUp(control.page);
      // The far craft is still hearing the last nine seconds of it.
      await far.page.waitForTimeout(FAR_SECONDS * 1000 + 2_000);

      const nearHeard = await reception(near.page);
      const farHeard = await reception(far.page);
      const firstIndex = farHeard.decoded[0] as number;
      const spokenAt = keyedAt + firstIndex * CHUNK_MS;
      const crossing = (farHeard.firstDecodeAt as number) - spokenAt;
      console.info(
        `[radio-joiner] far craft joined ${((joinedBy - keyedAt) / 1000).toFixed(2)}s into the keying, first heard chunk ${firstIndex} ${(crossing / 1000).toFixed(2)}s after it was spoken (separation ${FAR_SECONDS}s)`,
      );

      // The near craft was there from the start and heard all of it.
      expect(nearHeard.decoded).toEqual(
        Array.from({ length: CHUNKS }, (_, i) => i),
      );

      /*
       * From the join point, not from the top: nothing spoken before the far
       * craft was on the mesh, and every chunk after it, in order, on one lane.
       */
      expect(firstIndex).toBeGreaterThan(0);
      expect(spokenAt).toBeGreaterThan(joiningFrom - 1_000);
      expect(spokenAt).toBeLessThan(joinedBy + 2_000);
      expect(farHeard.decoded).toEqual(
        Array.from({ length: CHUNKS - firstIndex }, (_, i) => firstIndex + i),
      );
      expect(farHeard.decoderLengths).toEqual([CHUNKS - firstIndex]);

      // And after its own light-time, not the near craft's.
      expect(crossing).toBeGreaterThan(FAR_SECONDS * 1000 - 800);
      expect(crossing).toBeLessThan(FAR_SECONDS * 1000 + 1_500);
      expect(crossing - NEAR_SECONDS * 1000).toBeGreaterThan(
        (FAR_SECONDS - NEAR_SECONDS) * 1000 - 1_000,
      );
      // Its lamp lit on the audio, never on the replayed envelope.
      expect(farHeard.litAt as number).toBeGreaterThanOrEqual(
        (farHeard.firstDecodeAt as number) - 100,
      );
    } finally {
      await closeAll(screens);
    }
  });
});
