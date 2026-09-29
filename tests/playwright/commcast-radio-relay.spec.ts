import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";
import {
  closeAll,
  decodedVerdict,
  keyDown,
  keyUp,
  NAMES,
  NEAR,
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
 * One keying from a PEER is heard exactly once, everywhere.
 *
 * A station reaches the mod only through its host: its batches go up as the
 * host's commands, and what the mod sends back reaches it through the host's
 * relay. Every hop is a place a copy can be repeated, and a chunk carries no id
 * a listener could dedupe on, so a repeat is heard as a stutter. Kept as its own
 * scene, with no film and no light-time, because it is a property of the wire
 * and wants to fail in seconds.
 */

/** Short: this is a count, not a timing measurement. */
const CHUNKS = 25;

test.describe.configure({ timeout: 240_000 });

test.describe("commcast radio: the relay repeats a peer once @chromium-only", () => {
  test("a station keying is heard exactly once at the host and once at another peer", async ({
    browser,
  }, testInfo) => {
    await publishScene([PORTS.radioStream.ksc, PORTS.radioStream.near]);

    const videoDir = testInfo.outputPath("videos");
    const control = await openScreen(browser, {
      name: "mission-control",
      url: "/?uplinkLoaderIds=",
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir,
      clip: { name: "relay control", chunks: CHUNKS },
    });
    const shareCode = await getHostPeerId(control.page);
    const station = await openScreen(browser, {
      name: "station",
      url: `/station?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:station",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir,
      clip: { name: "relay station", chunks: CHUNKS },
      host: control.page,
    });
    const pilot = await openScreen(browser, {
      name: "near-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.near,
      videoDir,
      clip: { name: "relay pilot", chunks: CHUNKS },
      host: control.page,
    });
    const screens: Screen[] = [station, control, pilot];

    try {
      await openConversation(station.page, NAMES[NEAR]);
      await keyDown(station.page);
      await speak(station.page, CHUNKS);
      /*
       * The HOST is the sharper of the two readings and the one that says where
       * the duplication is. It is co-located with the station, so its copy is
       * due immediately and owes nothing to a light-time; and every extra copy
       * it holds is one extra registered listener, since a host mesh both
       * repeats the frame and hands it to its own log.
       */
      await waitForReception(control.page, (r) => r.decoded.length >= CHUNKS, {
        timeout: 20_000,
        message: "mission control never heard the station",
      });
      await waitForReception(pilot.page, (r) => r.decoded.length >= CHUNKS, {
        timeout: 30_000,
        message: "the craft never heard the station",
      });
      await keyUp(station.page);
      // Long enough that a duplicate would have arrived and been counted. A
      // count asserted the instant the first copy lands would pass on a wire
      // sending four.
      await control.page.waitForTimeout(3_000);

      const atControl = await reception(control.page);
      const atPilot = await reception(pilot.page);
      console.info(
        `[radio-relay] ${CHUNKS} chunks keyed from the station: ${atControl.decoded.length} decoded at the host, ${atPilot.decoded.length} at the craft`,
      );
      /*
       * Read as a verdict rather than a bare `toEqual`, because a repeat is this
       * scene's subject and is not the only way the list can differ: a chunk
       * released out of order, or lost, fails the same diff and is a different
       * defect in a different place.
       */
      expect(
        decodedVerdict(atControl.decoded, CHUNKS),
        "what mission control decoded (a REPEAT is the host echoing the station to itself)",
      ).toBeNull();
      expect(
        decodedVerdict(atPilot.decoded, CHUNKS),
        "what the craft decoded (a REPEAT is the host relaying the station more than once)",
      ).toBeNull();
      // And the station still never hears itself, on either path.
      expect((await reception(station.page)).decoded).toEqual([]);
    } finally {
      await closeAll(screens);
    }
  });
});
