import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";
import {
  beat,
  caption,
  clipSeconds,
  closeAll,
  HOLD_MS,
  installCaption,
  KSC,
  keyDown,
  keyUp,
  muteKey,
  NAMES,
  NEAR,
  NEAR_SECONDS,
  openConversation,
  openScreen,
  publishScene,
  reception,
  type Screen,
  speak,
  stackVideos,
  talkKey,
  voiceRibbon,
  waitForReception,
} from "./commcast-radio-scene";
import { getHostPeerId } from "./helpers";

/**
 * The radio, driven from a STATION screen rather than from mission control.
 *
 * **A station is a different machine from the host in every way that the radio
 * touches.** It mounts `/station`, not `/`; its identity is a `stationKey` in
 * its own `localStorage` rather than the host's; it has no socket to the mod at
 * all, so its telemetry, its roster, its separations and its view clock all
 * arrive relayed over PeerJS through `PeerTransport`; and its `CommcastMesh` is
 * `forClient`, a spoke that reaches every other screen only because the host
 * repeats for it. Every previous radio scene ran the talking end on the host,
 * so none of that was under test: a station could have been unable to key, to
 * hear, to draw its own voice on the rail or to mute a loop, and every suite in
 * the tree would have stayed green.
 *
 * The vantage is the one thing a station does NOT have of its own, and that is
 * correct rather than a gap: it reads the host's relayed frames, so it observes
 * the host's vantage and the two are genuinely co-located. That is what makes
 * the last beat here possible at all, two operators at the same ground vantage
 * talking over each other at a craft three seconds away.
 *
 * ## The three screens
 *
 *   - the STATION at `ksc`, on `/station`, which does all the talking
 *   - mission control at `ksc`, on `/`, hosting the mesh and speaking once at
 *     the end so the craft has two people on top of each other
 *   - a pilot 3 s away at `vessel:near`, on `/pilot`
 *
 * ## What the film is asked to show, and where each of it is
 *
 *   - **talk**: the fixed-label key, latched from the station
 *   - **the delay**: the same utterance arriving one light-time later, audible
 *   - **the transmission light**: dark while the words are crossing, with the
 *     station provably already mid-sentence. A lamp lit by the `start` frame
 *     would announce a speaker before their first word could have arrived
 *   - **mute**: muted mid-transmission, the audio stops; unmuted, it resumes
 *     where the audio has GOT TO. The chunk indices either side of the gap are
 *     the proof, and they are read off the decoder rather than off the widget
 *   - **the delay rail ribbon**: the operator's own voice drawn crossing the
 *     gap, with the clip's own amplitude envelope under it
 *   - **two talkers at once**: the station and mission control keying together,
 *     both at `ksc`, so both land at the craft in the same instant and the
 *     widget says "2 at once"
 *
 * ## Paced, and readable off the picture
 *
 * The delay ARITHMETIC is untouched: three seconds is the claim and nothing
 * here stretches it. What is paced is everything around it, and every pane
 * carries a caption strip, its own identity, and a stopwatch running off one
 * shared epoch. That last one is what lets a reviewer take the light-time off
 * the FILM rather than off this file: keyed at T+MM:SS on the left-hand pane,
 * heard three seconds later on the right-hand one, in the same picture.
 */

/** The station's utterance: long enough that the lamp is readable on film. */
const STATION_CHUNKS = 225;
/**
 * The pilot's: long enough to be muted in the middle and still have a middle.
 *
 * The mute beat needs three readable spans inside one keying, heard before the
 * mute, silence during it, and heard after it, and each of them has to outlast
 * a human's reading of the caption that names it. Eight seconds is the shortest
 * clip that gives all three.
 */
const PILOT_CHUNKS = 400;

/** Voices low enough apart to tell by ear when they land together. */
/*
 * Cut at TWICE the utterance, because the station speaks twice.
 *
 * `ClipMic` never rewinds: it walks one clip once and returns false at the end,
 * so a screen that keys a second time carries on from where it stopped. A clip
 * cut to one utterance would leave the second keying emitting nothing at all,
 * and the scene would fail as a delivery failure rather than as an empty
 * microphone.
 */
const STATION_CLIP = {
  name: "station to near craft",
  chunks: STATION_CHUNKS * 2,
};
const CONTROL_CLIP = {
  name: "mission control to near craft",
  chunks: STATION_CHUNKS,
  baseHz: 260,
};
const PILOT_CLIP = {
  name: "near craft to the ground",
  chunks: PILOT_CHUNKS,
  baseHz: 620,
};

/** Wall ms into the station's playout that the mute goes on, and comes off. */
const MUTE_AT_MS = 2_000;
const MUTED_FOR_MS = 3_000;

/*
 * Video on, trace OFF. The film is the artefact here, and a trace of three
 * contexts over two minutes is a very large pile of screenshots written
 * concurrently into one directory at teardown, which is a source of failure of
 * its own and tells a reviewer nothing the film and the console lines do not.
 */
test.use({ video: "on", trace: "off" });

/*
 * Three page loads, a peer handshake each, four keyings and two light-times to
 * wait out, with a human's reading pace held at every beat. The slowness is the
 * subject and the film is the deliverable.
 */
test.describe.configure({ timeout: 600_000 });

/**
 * Chromium only, for the reason `commcast-radio.spec.ts` measured and records:
 * firefox loses the peer link between fresh contexts often enough that a timing
 * measurement silently loses its subject. Webkit is untried. The delay
 * arithmetic is engine-independent and covered per engine already; what is
 * scoped here is the three-context WebRTC scene it is measured over.
 */
test.describe("commcast radio from a station screen @chromium-only", () => {
  test("a station keys, mutes and is talked over, three seconds from the craft", async ({
    browser,
  }, testInfo) => {
    await publishScene([PORTS.radioStream.ksc, PORTS.radioStream.near]);

    const videoDir = testInfo.outputPath("videos");
    /*
     * The host first, because a station cannot exist without one to connect to.
     * It is a participant in its own right here, not scaffolding: it is at
     * `ksc` alongside the station and it speaks in the last beat.
     */
    const control = await openScreen(browser, {
      name: "mission-control",
      url: "/?uplinkLoaderIds=",
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir,
      clip: CONTROL_CLIP,
    });
    const shareCode = await getHostPeerId(control.page);
    /*
     * The station. No sitrep port of its own is reachable from here even
     * though one is seeded: `StationScreen` builds a `PeerTransport` and hands
     * it to `SitrepTelemetryProvider`, so every frame it observes has been
     * through the host. The seed is what a station carries anyway.
     */
    const station = await openScreen(browser, {
      name: "station",
      url: `/station?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:station",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir,
      clip: STATION_CLIP,
    });
    const pilot = await openScreen(browser, {
      name: "near-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.near,
      videoDir,
      clip: PILOT_CLIP,
    });
    // Left to right, and the order the pan positions are taken from.
    const screens: Screen[] = [station, control, pilot];

    /*
     * One epoch, installed after the last screen is up, and it is the same
     * instant the film is trimmed back to. So the stopwatch drawn on each pane
     * reads zero on the film's own first frame, and a reviewer can subtract two
     * numbers they can see rather than trusting a console line.
     */
    const epoch = Date.now();
    await installCaption(station.page, {
      title: "STATION SCREEN",
      subtitle: "/station · peer of the host · at KSC",
      accent: "#00ff88",
      epoch,
    });
    await installCaption(control.page, {
      title: "MISSION CONTROL",
      subtitle: "/ · hosts the mesh · at KSC",
      accent: "#ffd166",
      epoch,
    });
    await installCaption(pilot.page, {
      title: "NEAR CRAFT",
      subtitle: `/pilot · ${NEAR_SECONDS} s from KSC`,
      accent: "#66d9ff",
      epoch,
    });

    try {
      await beat(
        screens,
        "Three screens, one mesh. The STATION on the left is a peer: no socket to the game, everything relayed through the host.",
        HOLD_MS + 2_000,
      );

      /* ------------------------------------------------------------------ *
       * 1. The station can reach the key at all
       * ------------------------------------------------------------------ */
      await openConversation(station.page, NAMES[NEAR]);
      await beat(
        screens,
        `The station opens a conversation with the Near Craft, ${NEAR_SECONDS} seconds away.`,
      );
      /*
       * The key is reachable AND pressable. `unavailable` is what
       * `RadioPtt` disables it for, and every one of its reasons is a thing a
       * station could plausibly be missing where the host is not: no view
       * clock, no vantage, no recipient. A disabled key here would be the whole
       * finding, so it is asserted before anything is pressed rather than
       * inferred from a later timeout.
       */
      await expect(talkKey(station.page)).toBeEnabled();
      /*
       * The rail is EMPTY before the key, and that is half of the assertion
       * below. An idle transmitter publishes no crossing, so a ribbon here
       * would mean the rail was drawing something nobody registered.
       */
      await expect(voiceRibbon(station.page)).toHaveCount(0);

      /* ------------------------------------------------------------------ *
       * 2. Keyed from the station: the ribbon, and a craft that hears nothing
       * ------------------------------------------------------------------ */
      const keyedAt = await keyDown(station.page);
      await speak(station.page, STATION_CHUNKS);
      await caption(
        screens,
        "STATION keys the mic. Its own voice is drawn crossing the gap on its delay rail. The craft has been told NOTHING.",
      );
      /*
       * The other half: keyed, the operator's own voice is drawn crossing the
       * gap on the panel's delay rail, with the clip's measured envelope under
       * it. `RadioPtt` registers the crossing while the key is down and
       * `useRadio` carries the captured loudness into it; on a station both
       * ends of that wiring are running against a relayed clock.
       */
      await expect(voiceRibbon(station.page)).toBeVisible();

      /*
       * A second and a bit in: the station is provably mid-sentence and the
       * craft has been told nothing. That pairing is the assertion, not either
       * half of it. A dark lamp on its own is what a broken wire looks like,
       * and a talking transmitter on its own says nothing about the far end.
       */
      await station.page.waitForTimeout(1_200);
      const early = await reception(pilot.page);
      const sending = await reception(station.page);
      expect(
        sending.spoken,
        "the station should be mid-sentence by now",
      ).toBeGreaterThan(30);
      expect(early.firstDecodeAt, "the words have not arrived yet").toBeNull();
      expect(
        early.litAt,
        "and the craft's lamp must not announce a speaker before their first word",
      ).toBeNull();

      await caption(
        screens,
        `Still dark at the craft. The envelope crossed the internet instantly; the WORDS take ${NEAR_SECONDS} s.`,
      );
      await waitForReception(pilot.page, (r) => r.firstDecodeAt !== null, {
        timeout: 30_000,
        message: "the craft never heard the station",
      });
      await caption(
        screens,
        `+${NEAR_SECONDS} s: the words arrive and the lamp lights. It is lit by audio being PRESENTED, never by the start frame.`,
      );
      await station.page.waitForTimeout(HOLD_MS);
      /*
       * The craft's lamp names MISSION CONTROL for a transmission the station
       * sent, and that is the model rather than a mislabel: a station observes
       * its host's frames, so it stands at its host's vantage and the craft has
       * no other name for where the words came from. Said out loud on the film
       * because a reviewer who did not know that would read it as the wrong
       * screen talking.
       */
      await caption(
        screens,
        'The craft labels it "Mission Control" because that is the VANTAGE it came from: a station stands where its host stands.',
      );

      /*
       * Held to the end of the utterance, then released. It has to be the end:
       * a microphone whose capture is stopped mid-clip stops emitting, so an
       * early key-up would put half an utterance on the wire and the "arrived
       * whole, in order" assertion below would be asserting a different thing.
       */
      await station.page.waitForTimeout(
        Math.max(0, clipSeconds(STATION_CHUNKS) * 1000 - 1_200),
      );
      await keyUp(station.page);
      // And the ribbon goes with the key, rather than being left on the rail.
      await expect(voiceRibbon(station.page)).toHaveCount(0);
      await station.page.waitForTimeout(clipSeconds(STATION_CHUNKS) * 1000);

      const heard = await reception(pilot.page);
      const crossing = (heard.firstDecodeAt as number) - keyedAt;
      console.info(
        `[radio-station] the craft first heard the STATION ${(crossing / 1000).toFixed(2)}s after key-down (separation ${NEAR_SECONDS}s)`,
      );
      // Generous on both sides: the key catches a frame or two after the click,
      // and the clock is anchored on a stream re-emitting at 200 ms. Tight
      // enough that a missing delay (0 s) and a doubled one (6 s) both fail.
      expect(crossing).toBeGreaterThan(NEAR_SECONDS * 1000 - 800);
      expect(crossing).toBeLessThan(NEAR_SECONDS * 1000 + 1_500);
      /*
       * Whole, in order, on ONE listening chain, after a silence several times
       * longer than the playout: audio that was HELD and released on a clock. A
       * wire that had simply been dead for three seconds would have lost its
       * opening chunks, and a session rebuilt mid-transmission would split the
       * clip across two chains.
       */
      expect(heard.decoded).toEqual(
        Array.from({ length: STATION_CHUNKS }, (_, i) => i),
      );
      expect(heard.decoderLengths).toEqual([STATION_CHUNKS]);
      // The lamp went dark once the audio it named had finished, rather than at
      // the `end` frame that arrived seconds earlier.
      expect(heard.darkAt).not.toBeNull();
      expect(
        (heard.darkAt as number) - (heard.litAt as number),
      ).toBeGreaterThan(clipSeconds(STATION_CHUNKS) * 1000 * 0.5);
      // Nobody hears their own voice back off the relay, which is what
      // `authorStationKey` is repeated on every frame for. A station is the
      // screen most able to get this wrong: its own frames go out to the host
      // and come back repeated.
      const stationSelf = await reception(station.page);
      expect(stationSelf.decoded).toEqual([]);
      expect(stationSelf.litAt).toBeNull();

      await beat(
        screens,
        `Heard whole, in order, ${clipSeconds(STATION_CHUNKS).toFixed(1)} s of audio after ${NEAR_SECONDS} s of silence. The station never hears its own voice back.`,
        HOLD_MS + 1_000,
      );

      /* ------------------------------------------------------------------ *
       * 3. The craft replies, and the station mutes it mid-sentence
       * ------------------------------------------------------------------ */
      await openConversation(pilot.page, NAMES[KSC]);
      await beat(
        screens,
        "Now the craft replies to the ground. Both KSC screens will hear it: they are the same vantage.",
      );

      const replyKeyedAt = await keyDown(pilot.page);
      await speak(pilot.page, PILOT_CHUNKS);
      await expect(voiceRibbon(pilot.page)).toBeVisible();
      await caption(
        screens,
        `The craft is talking. ${NEAR_SECONDS} s until the ground hears a word of it.`,
      );

      await waitForReception(station.page, (r) => r.firstDecodeAt !== null, {
        timeout: 30_000,
        message: "the station never heard the craft",
      });
      const replyAt = (await reception(station.page)).firstDecodeAt as number;
      console.info(
        `[radio-station] the STATION first heard the craft ${((replyAt - replyKeyedAt) / 1000).toFixed(2)}s after key-down (separation ${NEAR_SECONDS}s)`,
      );
      expect(replyAt - replyKeyedAt).toBeGreaterThan(NEAR_SECONDS * 1000 - 800);
      expect(replyAt - replyKeyedAt).toBeLessThan(NEAR_SECONDS * 1000 + 1_500);
      await caption(
        screens,
        "The station is hearing the craft. Both KSC panes light on the same instant.",
      );

      // Two seconds into the playout, so there is audibly a "before".
      await station.page.waitForTimeout(MUTE_AT_MS);
      await muteKey(station.page, NAMES[NEAR]).click();
      await expect(muteKey(station.page, NAMES[NEAR])).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await caption(
        screens,
        "MUTED, mid-transmission. The audio stops at the station. Mission control, unmuted, keeps hearing every word.",
      );
      /*
       * Read the baseline AFTER the mute has landed, not before the click.
       * Audio is released on a 20 ms tick and a click takes tens of
       * milliseconds to reach the page, so a baseline taken before it counts
       * two chunks the operator heard perfectly correctly and then calls them a
       * leak. What the claim actually is, and what this measures, is that once
       * the mute is on nothing further reaches the speakers.
       */
      await station.page.waitForTimeout(400);
      const beforeMute = await reception(station.page);
      const controlBeforeMute = await reception(control.page);
      await station.page.waitForTimeout(MUTED_FOR_MS);
      const duringMute = await reception(station.page);
      /*
       * Nothing new reached the speakers while it was muted, and the craft did
       * not stop talking to achieve that: the transmitter is still emitting and
       * mission control, at the same vantage and unmuted, is still decoding.
       * Either half alone would pass on a wire that had simply died.
       */
      expect(
        duringMute.decoded.length,
        "the station heard nothing new while muted",
      ).toBe(beforeMute.decoded.length);
      const controlDuringMute = await reception(control.page);
      expect(
        controlDuringMute.decoded.length,
        "mission control, unmuted at the same vantage, kept hearing it",
      ).toBeGreaterThan(controlBeforeMute.decoded.length);

      await muteKey(station.page, NAMES[NEAR]).click();
      await expect(muteKey(station.page, NAMES[NEAR])).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await caption(
        screens,
        "UNMUTED. It resumes where the audio has GOT TO, not where it left off: the muted seconds are gone, not queued.",
      );
      await waitForReception(
        station.page,
        (r) => r.decoded.length > duringMute.decoded.length,
        {
          timeout: 15_000,
          message: "the station never resumed after unmuting",
        },
      );
      const afterMute = await reception(station.page);
      const lastBefore = duringMute.decoded[duringMute.decoded.length - 1];
      const firstAfter = afterMute.decoded[duringMute.decoded.length];
      console.info(
        `[radio-station] muted after chunk ${lastBefore}, resumed at chunk ${firstAfter} (${MUTED_FOR_MS} ms muted, 20 ms a chunk)`,
      );
      /*
       * The whole claim, in one comparison. A mute that merely PAUSED would
       * resume at the very next chunk and the operator would spend the rest of
       * the transmission that far behind everyone else at their own vantage. It
       * skips instead, so the gap is roughly the wall time the mute was on.
       */
      const skipped = firstAfter - lastBefore;
      expect(
        skipped,
        "unmuting resumed where the audio had got to, not where it left off",
      ).toBeGreaterThan((MUTED_FOR_MS / 20) * 0.5);
      /*
       * And on the SAME listening chain. A muted chunk ends the decode stream
       * without decoding it, so the next audible one starts a fresh stream on
       * the lane that was already there rather than opening a second lane
       * against a backlog. The reset count is where that shows as a positive
       * fact.
       */
      expect(afterMute.decoderLengths.length).toBe(
        beforeMute.decoderLengths.length,
      );
      expect(
        afterMute.decoderResets[afterMute.decoderResets.length - 1],
      ).toBeGreaterThan(1);

      await keyUp(pilot.page);
      await beat(
        screens,
        "The craft stops talking. The ground keeps hearing it for another three seconds: the end frame crosses instantly, the words do not.",
        HOLD_MS + 2_000,
      );

      /* ------------------------------------------------------------------ *
       * 4. Two talkers at once, both at KSC
       * ------------------------------------------------------------------ */
      await openConversation(control.page, NAMES[NEAR]);
      await beat(
        screens,
        "Last: the station AND mission control key together. Same vantage, same light-time, so both land at the craft in the same instant.",
        HOLD_MS + 1_000,
      );

      const lanesBefore = (await reception(pilot.page)).decoderLengths.length;
      await Promise.all([keyDown(station.page), keyDown(control.page)]);
      await Promise.all([
        speak(station.page, STATION_CHUNKS),
        speak(control.page, STATION_CHUNKS),
      ]);
      await caption(
        screens,
        "Both keyed. Two voices, one gap, no ducking and no per-source gain.",
      );

      await waitForReception(
        pilot.page,
        (r) => r.decoderLengths.length >= lanesBefore + 2,
        {
          timeout: 30_000,
          message: "the craft never heard two separate transmissions",
        },
      );
      /*
       * The widget's own reading of the same fact, and the one an operator
       * acts on: two unmuted lamps at once is not "two loops are busy", it is
       * "these two are on top of each other", and `RadioIndicator` says so in
       * as many words above one.
       */
      await expect(pilot.page.getByText("2 at once").first()).toBeVisible();
      await caption(
        screens,
        'The craft hears both, and says so: "2 at once". Two lanes decoded separately, then summed.',
      );
      await pilot.page.waitForTimeout(clipSeconds(STATION_CHUNKS) * 1000);
      await Promise.all([keyUp(station.page), keyUp(control.page)]);
      await pilot.page.waitForTimeout(clipSeconds(STATION_CHUNKS) * 1000);

      const both = await reception(pilot.page);
      const newLanes = both.decoderLengths.slice(lanesBefore);
      expect(
        newLanes.length,
        "one lane per simultaneous transmission",
      ).toBeGreaterThanOrEqual(2);
      /*
       * Each of them came out WHOLE. The mix is what the operator hears and is
       * unreadable by construction (two voices summed are one waveform), so
       * what is asserted is the property the mix depends on and cannot itself
       * demonstrate: neither transmission was truncated or dropped to make room
       * for the other.
       */
      for (const lane of newLanes.slice(0, 2)) {
        expect(lane).toBe(STATION_CHUNKS);
      }

      await beat(
        screens,
        "Both utterances arrived whole. Everything here was driven from the station on the left.",
        HOLD_MS + 2_000,
      );
    } finally {
      // Before anything is torn down: the film ends here, on the last held
      // frame, rather than at whatever the last chunk of audio happened to be.
      const endedAt = Date.now();
      await closeAll(screens);
      const film = await stackVideos(screens, testInfo, {
        epoch,
        endedAt,
        fileName: "radio-station-scene.mp4",
      });
      if (film) console.info(`[radio-station] FILM: ${film}`);
    }
  });
});
