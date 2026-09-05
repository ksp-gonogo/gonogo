#!/usr/bin/env tsx
/**
 * Render the Commcast widget through a real Chromium page.
 *
 * Run: `pnpm --filter @ksp-gonogo/app render-commcast`
 * Output: local_docs/renders/commcast/ (COMMCAST_RENDER_OUT overrides, which
 * is what a worktree wants: a reviewer needs the shots at the path they were
 * given, and a pruned worktree takes its own local_docs with it).
 *
 * Every scene here is a state somebody has to make a call about, and most are
 * two-pane because the widget's entire subject is that two vantages disagree.
 * A single-pane shot of a delayed log looks exactly like an undelayed one: you
 * cannot see what the other end is NOT showing, and under this model you also
 * cannot see that the other end does not HAVE it.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = resolve(HERE, "probe");
const PROBE_ENTRY = join(PROBE_DIR, "commcast-probe-entry.tsx");
const PROBE_HTML = join(PROBE_DIR, "commcast-probe.html");

/**
 * The theme package's SOURCE tokens.css. `global.css` only `@import`s it, so a
 * driver pointing at that file finds no `:root` and every probe renders
 * unthemed. Same file the settings driver reads, for the same reason.
 */
const THEME_TOKENS_CSS = resolve(HERE, "../../theme/src/tokens.css");

const OUT_DIR =
  process.env.COMMCAST_RENDER_OUT ??
  resolve(HERE, "../../../local_docs/renders/commcast");

/** Where the two ends of the headline scene are. */
const KSC = "ksc";
const ARES = "vessel:ares-4";
/** A second command centre, downrange and at its own vantage. */
const WOOMERA = "ground:woomera";
/**
 * A recovery ship a few hundred kilometres out, on a terrestrial link. Under a
 * second away, which is the whole reason it exists here: it is the only
 * correspondent whose delay gets the standing BADGE rather than the countdown
 * strip, and the two readings are never drawn together.
 */
const RECOVERY = "ground:recovery";

/** Four minutes each way, the separation the headline scenes are built on. */
const LIGHT_TIME = 240;

/** One message a pane's log holds. Mirrors the probe's `Held`. */
interface Held {
  from: string;
  to: string[];
  authorName: string;
  authorSeat: "mission-control" | "pilot";
  body: string;
  sentAt: number;
  lastSentAt?: number;
  attempts?: number;
  separationSeconds: number | null;
  acks?: { from: string; stationKey: string; at: number }[];
  neverLeft?: boolean;
}

interface Pane {
  seat: "mission-control" | "pilot";
  vantage?: string;
  name: string;
  sent?: Held[];
  received?: Held[];
  crossing?: Held[];
  noLog?: boolean;
  /** Correspondent whose conversation this pane is opened into. */
  openThread?: string;
  /** Walk into the recipient picker instead. */
  compose?: boolean;
  /** Names to select in the picker, in order. */
  pick?: string[];
  /** Press Open, landing in the conversation itself. */
  open?: boolean;
  /** Latch the push-to-talk key and speak a fixed clip through it. */
  key?: boolean;
}

interface Scene {
  name: string;
  panes: Pane[];
  separation?: { from: string; to: string; oneWaySeconds: number }[];
  roster?: { id: string; displayName: string; active: boolean }[];
  oneWaySeconds?: number;
  linkLost?: boolean;
  settleOn?: string | readonly string[];
  caption?: string;
  /** Force the radio's capability verdict, so the two refusals can be
   *  photographed on a machine that supports the radio perfectly well. */
  radioSupport?: "insecure-context" | "no-codec";
  pxW: number;
  pxH: number;
}

/** Every ordered pair among the three vantages the scenes use. */
const PAIRS = [
  { from: KSC, to: KSC, oneWaySeconds: 0 },
  { from: ARES, to: ARES, oneWaySeconds: 0 },
  { from: KSC, to: ARES, oneWaySeconds: LIGHT_TIME },
  { from: ARES, to: KSC, oneWaySeconds: LIGHT_TIME },
  { from: KSC, to: WOOMERA, oneWaySeconds: 12 },
  { from: WOOMERA, to: KSC, oneWaySeconds: 12 },
  { from: KSC, to: RECOVERY, oneWaySeconds: 0.4 },
  { from: RECOVERY, to: KSC, oneWaySeconds: 0.4 },
];

const ROSTER = [
  { id: KSC, displayName: "Kennedy", active: true },
  { id: ARES, displayName: "Ares 4", active: true },
  { id: WOOMERA, displayName: "Woomera Range", active: true },
  { id: RECOVERY, displayName: "Recovery 1", active: true },
];

/** From the ground to the craft, and back. */
const toAres = (body: string, sentAt: number): Held => ({
  from: KSC,
  to: [ARES],
  authorName: "Kennedy Flight",
  authorSeat: "mission-control",
  body,
  sentAt,
  separationSeconds: LIGHT_TIME,
});
const toKsc = (body: string, sentAt: number): Held => ({
  from: ARES,
  to: [KSC],
  authorName: "Jeb",
  authorSeat: "pilot",
  body,
  sentAt,
  separationSeconds: LIGHT_TIME,
});
/** The crew acknowledging, at the instant the message reached them. */
const acked = (sentAt: number) => [
  { from: ARES, stationKey: "pilot-1", at: sentAt + LIGHT_TIME },
];
const ackedByKsc = (sentAt: number) => [
  { from: KSC, stationKey: "ksc-1", at: sentAt + LIGHT_TIME },
];

/**
 * A settled exchange under every radio shot, so the key is photographed where
 * an operator meets it: at the foot of a conversation that is already running,
 * rather than in an empty console where it is the only thing on screen and its
 * relationship to the rest of the bar cannot be read.
 */
const RADIO_SENT: Held[] = [
  {
    ...toAres("Ares, Kennedy. You are go for the insertion burn.", -900),
    acks: acked(-900),
  },
];
const RADIO_RECEIVED: Held[] = [toKsc("Copy go. Starting the sequence.", -600)];

const SCENES: Scene[] = [
  {
    /*
     * The whole feature in one picture, and the state that did not exist
     * before: a message travelling from its AUTHOR's side.
     *
     * The ground has said something 60 s ago. It is NOT in the ground's own
     * log, because nothing has come back to say it arrived; it is in the
     * uplink queue below the console, climbing the outbound leg. The craft has
     * not got it either. Above it sits an exchange that DID complete, so the
     * two states are side by side: confirmed, with the round trip it actually
     * took, and still out.
     */
    name: "author-side-in-transit",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        openThread: "Ares 4",
        sent: [
          {
            ...toAres(
              "Ares, Kennedy. You are go for the insertion burn.",
              -900,
            ),
            acks: acked(-900),
          },
          toAres("Ares, Kennedy. Confirm residuals when you have them.", -60),
        ],
        received: [toKsc("Copy go. Starting the sequence.", -600)],
      },
      {
        seat: "pilot",
        vantage: ARES,
        name: "Jeb",
        openThread: "Kennedy",
        received: [
          toAres("Ares, Kennedy. You are go for the insertion burn.", -900),
        ],
        sent: [
          {
            ...toKsc("Copy go. Starting the sequence.", -600),
            acks: ackedByKsc(-600),
          },
        ],
        crossing: [
          toAres("Ares, Kennedy. Confirm residuals when you have them.", -60),
        ],
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    settleOn: "insertion burn",
    pxW: 900,
    pxH: 620,
  },
  {
    /*
     * The return leg, drawn from both ends at once. The craft's message
     * reached the ground 60 s ago and the ground has acknowledged it; that
     * acknowledgement is still 3 minutes from the craft, so at the craft the
     * message is in the queue on its `return` leg while at the ground it is
     * already read. Same instant, two vantages, two different truths.
     */
    name: "acknowledgement-coming-back",
    panes: [
      {
        seat: "pilot",
        vantage: ARES,
        name: "Jeb",
        openThread: "Kennedy",
        sent: [
          {
            ...toKsc(
              "Burn complete. Orbit is 249 by 251, residuals under a tenth.",
              -300,
            ),
            acks: ackedByKsc(-300),
          },
        ],
      },
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        openThread: "Ares 4",
        received: [
          toKsc(
            "Burn complete. Orbit is 249 by 251, residuals under a tenth.",
            -300,
          ),
        ],
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    settleOn: "Burn complete",
    pxW: 900,
    pxH: 620,
  },
  {
    /*
     * Nobody answered, and the operator gets their words back anyway.
     *
     * UNCONFIRMED is a state rather than an error: no warning colour, no
     * dismissal, and one action attached. The second row is the other reason a
     * message goes unconfirmed, which calls for a different judgement: nothing
     * left at all, because there was no path when it was sent. The third has
     * been sent twice and says so.
     */
    name: "unconfirmed-and-resend",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        openThread: "Ares 4",
        sent: [
          {
            ...toAres(
              "Ares, Kennedy. You are go for the insertion burn.",
              -3000,
            ),
            acks: acked(-3000),
          },
          toAres("Ares, Kennedy. Do you copy.", -1200),
          {
            ...toAres("Ares, Kennedy. Attitude looks wrong from here.", -900),
            separationSeconds: null,
            neverLeft: true,
          },
          {
            ...toAres("Ares, Kennedy. Say again your status.", -1800),
            lastSentAt: -700,
            attempts: 2,
          },
        ],
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    settleOn: "unconfirmed",
    pxW: 520,
    pxH: 620,
  },
  {
    /*
     * A vantage owns what reached IT, read off the two INBOXES rather than out
     * of two open threads: Kennedy holds ONE correspondence and Woomera holds
     * TWO, because what Woomera said to the craft never came to Kennedy at all.
     * A host-authoritative store would have shown both conversations in both
     * panes, which is the model this replaces, and the inbox is the view that
     * shows the difference at a glance. Opening a thread in each pane hid it:
     * the two then rendered as near-identical single threads.
     */
    name: "two-vantages-different-sets",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        received: [
          {
            from: WOOMERA,
            to: [KSC],
            authorName: "Woomera Range",
            authorSeat: "mission-control",
            body: "Kennedy, Woomera. We have the pass, tracking is locked.",
            sentAt: -900,
            separationSeconds: 12,
          },
        ],
      },
      {
        seat: "mission-control",
        vantage: WOOMERA,
        name: "Woomera Range",
        sent: [
          {
            from: WOOMERA,
            to: [KSC],
            authorName: "Woomera Range",
            authorSeat: "mission-control",
            body: "Kennedy, Woomera. We have the pass, tracking is locked.",
            sentAt: -900,
            separationSeconds: 12,
            acks: [{ from: KSC, stationKey: "ksc-1", at: -888 }],
          },
          {
            from: WOOMERA,
            to: [ARES],
            authorName: "Woomera Range",
            authorSeat: "mission-control",
            body: "Ares, Woomera. We have you over the range.",
            sentAt: -600,
            separationSeconds: LIGHT_TIME,
            acks: [{ from: ARES, stationKey: "pilot-1", at: -360 }],
          },
        ],
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    settleOn: "tracking is locked",
    pxW: 900,
    pxH: 620,
  },
  {
    /*
     * The link is CONFIRMED gone. Everything above the marker reached this
     * vantage; past it there may be words nobody here has heard, which is why
     * the log gets a terminator rather than a row. It has to be tellable at a
     * glance from the uplink queue below it, which is one named utterance with
     * an instant it lands at: this is a rule across the column, in the error
     * tone, saying only where knowledge stops.
     */
    name: "no-signal-terminator",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        openThread: "Ares 4",
        sent: [
          {
            ...toAres(
              "Ares, Kennedy. Expect loss of signal on the far side.",
              -1800,
            ),
            acks: acked(-1800),
          },
        ],
        received: [
          toKsc("Kennedy, Ares. Copy, see you on the other side.", -1500),
        ],
      },
      {
        seat: "pilot",
        vantage: ARES,
        name: "Jeb",
        openThread: "Kennedy",
        received: [
          toAres(
            "Ares, Kennedy. Expect loss of signal on the far side.",
            -1800,
          ),
        ],
      },
    ],
    linkLost: true,
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    settleOn: "no signal",
    pxW: 900,
    pxH: 620,
  },
  {
    /*
     * A conversation with a correspondent and nothing said in it yet, reached
     * out of the picker, and four light-minutes from the craft. The send button
     * says the verb and nothing else: the round trip used to be inside its
     * label, so the same control was two words at the pad and a sentence out
     * here.
     *
     * NO delay chip, and that is the point of the pair this makes with
     * `short-delay-badge` below. Past a second the countdown IS the reading and
     * the strip carries it, so nothing is drawn here until something is
     * actually crossing (see `author-side-in-transit`).
     */
    name: "empty-conversation",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        compose: true,
        pick: ["Ares 4"],
        open: true,
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    settleOn: "Nothing said yet",
    pxW: 460,
    pxH: 460,
  },
  {
    /*
     * The OTHER half of the delay switch, and the reason this scene sits beside
     * `empty-conversation`: the same view, the same control, a correspondent
     * under a second away, and now a standing chip on the composer saying how
     * long the words take to REACH them. Never both readings at once, which is
     * what the pair of pictures shows.
     *
     * ONE-WAY, not the round trip it used to say. A recovery ship acts on an
     * instruction the moment it lands; the acknowledgement coming back is a
     * separate wait, and quoting the sum of the two was quoting the wrong
     * number.
     */
    name: "short-delay-badge",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        compose: true,
        pick: ["Recovery 1"],
        open: true,
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: 0.4,
    settleOn: "Nothing said yet",
    pxW: 460,
    pxH: 460,
  },
  {
    /*
     * THE RADIO AT REST. The key is at the head of the composer bar so the
     * operator's eye finds "talk" before "type", and it is a LATCH rather than
     * hold-to-talk: press-and-hold on a real button has no keyboard
     * equivalent, and this widget is operable from the keyboard throughout.
     *
     * Four light-minutes away, so the same bar carries the delay reading the
     * text composer already had. Nothing about the radio replaces it.
     */
    name: "radio-idle",
    caption: "RADIO · at rest, four light-minutes from the craft",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        openThread: "Ares 4",
        sent: RADIO_SENT,
        received: RADIO_RECEIVED,
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    settleOn: ["Talk", "Starting the sequence"],
    pxW: 520,
    pxH: 480,
  },
  {
    /*
     * KEYED, and really keyed: the click below mints an envelope, freezes the
     * separation and streams a recorded clip through the shipped transmitter.
     * Only the microphone and the codec are stood in for.
     *
     * The key states its own two states in words as well as in tone, because a
     * latch an operator cannot leave by accident is a latch they have to be
     * able to read at a glance.
     */
    name: "radio-on-air",
    caption: "RADIO · keyed, streaming to the craft",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        openThread: "Ares 4",
        sent: RADIO_SENT,
        received: RADIO_RECEIVED,
        key: true,
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    settleOn: ["Transmitting", "Starting the sequence"],
    pxW: 520,
    pxH: 480,
  },
  {
    /*
     * NO PATH, AND STILL TALKING. This is a settled ruling rather than an
     * oversight: loss of path stops DELIVERY, never transmission. The bar turns
     * and flags it, the operator keeps their key, and every chunk still goes on
     * the wire, where a listener who does have a path to this vantage can hear
     * it. Refusing the press would be this end deciding something only the
     * other end can answer.
     *
     * What the LISTENER gets is silence and nothing else, which is why there is
     * no second pane here: there would be nothing in it. Announcing "somebody
     * is transmitting and you cannot hear them" would be the faster-than-light
     * channel the entire delay model exists to prevent.
     */
    name: "radio-no-path",
    caption: "RADIO · no path, and the key still open",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        openThread: "Ares 4",
        sent: RADIO_SENT,
        received: RADIO_RECEIVED,
        key: true,
      },
    ],
    // Published and EMPTY: nothing measures this pair, and with no path home to
    // fall back on the separation resolves to no-path rather than to a zero.
    separation: [],
    roster: ROSTER,
    settleOn: ["Transmitting", "NO PATH", "Starting the sequence"],
    pxW: 520,
    pxH: 480,
  },
  {
    /*
     * NOT A SECURE ORIGIN, which is the state the LAN dev topology puts a
     * station in every single time: the dev server binds the LAN
     * (`vite.config.ts`, `server: { host: true }`), so a screen opened at
     * `http://<lan-ip>:5173` is on a plain-http origin and the browser refuses
     * the microphone outright.
     *
     * It is something the operator can act on, and it pairs with the shot below
     * to show that the two refusals do not read the same.
     */
    name: "radio-insecure-origin",
    caption: "RADIO · plain http, so no microphone at all",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        openThread: "Ares 4",
        sent: RADIO_SENT,
        received: RADIO_RECEIVED,
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    radioSupport: "insecure-context",
    settleOn: ["Not a secure origin", "Starting the sequence"],
    pxW: 520,
    pxH: 480,
  },
  {
    /*
     * NO AUDIO CODEC, kept a separate sentence from the shot above on purpose.
     * A presence-only probe gets this wrong in BOTH directions: on an insecure
     * origin chromium and firefox report the codec absent while webkit reports
     * it present, so one check would call two engines codec-less where their
     * codec is fine and call the third supported where it is about to be
     * refused a microphone. This is the state where the answer really is the
     * browser, and there is nothing the operator can do about it.
     */
    name: "radio-no-codec",
    caption: "RADIO · a browser with no WebCodecs audio",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        openThread: "Ares 4",
        sent: RADIO_SENT,
        received: RADIO_RECEIVED,
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    radioSupport: "no-codec",
    settleOn: ["No audio codec", "Starting the sequence"],
    pxW: 520,
    pxH: 480,
  },
  {
    /*
     * THE INBOX, and the state the recipient dropdown could not show: two
     * conversations that are genuinely separate rather than one log under a
     * filter. Ares 4 is first because something is still crossing there, and
     * its row says so; Woomera's is settled and says nothing.
     */
    name: "inbox",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        sent: [
          {
            ...toAres(
              "Ares, Kennedy. You are go for the insertion burn.",
              -3000,
            ),
            acks: acked(-3000),
          },
          toAres("Ares, Kennedy. Confirm residuals when you have them.", -60),
        ],
        received: [
          toKsc("Copy go. Starting the sequence.", -2400),
          {
            from: WOOMERA,
            to: [KSC],
            authorName: "Woomera Range",
            authorSeat: "mission-control",
            body: "Kennedy, Woomera. We have the pass, tracking is locked.",
            sentAt: -1800,
            separationSeconds: 12,
          },
        ],
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    settleOn: "tracking is locked",
    pxW: 460,
    pxH: 560,
  },
  {
    /*
     * Choosing who a message is for, and the one thing the picker refuses.
     * The rows TOGGLE, because the envelope has always carried a list of
     * recipients and a picker that could never hold a second name would have
     * to be rebuilt to grow one. Group DELIVERY is not built: the author
     * freezes ONE separation and the acknowledgement window is measured off
     * it, so the second name is refused here, where the operator can see why,
     * rather than sent and silently mis-timed.
     */
    name: "compose-recipients",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        compose: true,
        pick: ["Ares 4", "Woomera Range"],
      },
    ],
    separation: PAIRS,
    roster: ROSTER,
    oneWaySeconds: LIGHT_TIME,
    settleOn: "Group delivery is not carried yet",
    pxW: 460,
    pxH: 460,
  },
  {
    // The other empty: this screen has no log at all, which is a station whose
    // host has gone rather than a mission with nothing said. The two must not
    // read the same and this is the pair that shows it: this one reads "No log
    // yet", the one above "Nothing said yet".
    name: "no-log",
    panes: [
      {
        seat: "mission-control",
        vantage: KSC,
        name: "Kennedy Flight",
        noLog: true,
      },
    ],
    separation: [],
    pxW: 460,
    pxH: 460,
  },
];

/** The theme sheet whole, checked to be the tokens file. */
function themeCss(css: string): string {
  if (!/:root\s*\{/.test(css)) {
    throw new Error("tokens.css: no :root block found");
  }
  return css;
}

async function prepareProbePage(): Promise<string> {
  console.log("Bundling Commcast probe with esbuild...");
  const result = await build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    write: false,
    sourcemap: "inline",
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "true",
      "import.meta.env.MODE": '"production"',
    },
    loader: { ".css": "text", ".svg": "dataurl", ".png": "dataurl" },
  });
  const bundleJs = result.outputFiles[0].text;
  const html = await readFile(PROBE_HTML, "utf8");
  const theme = themeCss(await readFile(THEME_TOKENS_CSS, "utf8"));
  const escaped = bundleJs.replace(/<\/script/gi, "<\\/script");
  const out = html
    .replace(
      '<style id="probe-theme">/* injected by the render driver from packages/theme/src/tokens.css */</style>',
      () => `<style id="probe-theme">${theme}</style>`,
    )
    .replace(
      '<script type="module" src="./commcast-probe-entry.bundle.js"></script>',
      () => `<script type="module">${escaped}</script>`,
    );
  const file = join(tmpdir(), `commcast-probe-${process.pid}.html`);
  await writeFile(file, out, "utf8");
  return file;
}

async function cleanRenders(dir: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.endsWith(".png")) await rm(join(dir, e));
  }
}

async function main(): Promise<void> {
  const probeHtml = await prepareProbePage();
  await mkdir(OUT_DIR, { recursive: true });
  await cleanRenders(OUT_DIR);

  console.log("Launching Chromium...");
  const browser = await chromium.launch();
  let failures = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 960, height: 700 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      failures++;
      console.error("  [page error]", err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("  [console]", msg.text());
      // Warnings too: the probe reports an unsettled scene this way, and a
      // report nobody prints is the same as no report.
      if (msg.type() === "warning") console.warn("  [console]", msg.text());
    });

    /*
     * ONE SCENE PER FRESH PAGE LOAD, and that is load-bearing rather than
     * tidiness.
     *
     * The reveal does not always release: a scene can end with its thread empty
     * and every message parked in the transit strip with no countdown to print,
     * which is the widget's feed and its own `deliveryFor` disagreeing about
     * them. On one page rendering all six in turn, only the first thread scene
     * came out right. A fresh document per scene plus the warm-up below took it
     * from one scene in six to five in six.
     *
     * What it is NOT is scene-specific: which scene loses moves between runs,
     * so do not read the surviving warning as a fact about that scene. The
     * underlying defect wants a failing unit test on the feed and is not fixed
     * here.
     *
     * A reload costs a couple of seconds per scene. This harness exists to
     * photograph states nothing else can assert, and a picture of a thread that
     * never revealed is exactly the kind of wrong that reaches a reviewer
     * looking like the real thing, which is why the run says so out loud when
     * it happens.
     */
    for (const scene of SCENES) {
      const { name } = scene;
      await page.goto(pathToFileURL(probeHtml).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(
        () =>
          typeof (window as unknown as { __renderCommcast?: unknown })
            .__renderCommcast === "function",
        undefined,
        { timeout: 15_000 },
      );
      /*
       * A beat after the entry point exists, before the first scene mounts.
       * `__renderCommcast` being defined says the bundle EVALUATED, not that
       * everything it set up at module scope is running: the widget registry
       * and the view clock are both module-level. This was being supplied by
       * accident before, as the seconds a shared page spent bundling and
       * launching ahead of its first scene, and rendering the instant the page
       * was ready is what removed it.
       */
      await page.waitForTimeout(1_500);
      // The whole scene, name included: the probe prints it when a scene does not settle, and a warning that cannot say which scene it is about is no better than silence.
      await page.evaluate(
        (s) =>
          (
            window as unknown as {
              __renderCommcast: (p: unknown) => Promise<void>;
            }
          ).__renderCommcast(s),
        scene,
      );
      await page.waitForTimeout(200);
      const root = await page.$("#root");
      if (!root) throw new Error("#root missing after render");
      const out = join(OUT_DIR, `${name}.png`);
      await root.screenshot({ path: out });
      console.log(`  ✓ ${name} → ${out}`);
    }
  } finally {
    await browser.close();
  }

  // A page error means a scene rendered wrong, and a silently wrong render is
  // worse than no render: it goes to a reviewer looking like the real thing.
  if (failures > 0) {
    throw new Error(`${failures} page error(s) during rendering; see above`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
