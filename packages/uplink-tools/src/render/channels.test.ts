import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readChannelDispositions } from "./channels";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * An Uplink laid out as the monorepo lays one out: the client in `client/`, the
 * plugin in a sibling `mod/`. Returns the CLIENT directory, which is what the
 * scanner is given.
 */
function uplink(cs: string) {
  const root = mkdtempSync(join(tmpdir(), "gonogo-channels-"));
  scratch.push(root);
  const client = join(root, "client");
  mkdirSync(client, { recursive: true });
  mkdirSync(join(root, "mod"), { recursive: true });
  writeFileSync(join(root, "mod", "XUplink.cs"), cs);
  return client;
}

describe("readChannelDispositions", () => {
  it("reads a plain initialiser, resolving a const topic", () => {
    const found = readChannelDispositions(
      uplink(`
        public const string StatusTopic = "x.status";
        Channels = new List<ChannelDeclaration>
        {
            new ChannelDeclaration
            {
                Topic = StatusTopic,
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30),
            },
        };
      `),
    );
    expect(found.get("x.status")).toEqual({
      delivery: "lossy-latest",
      delay: "delayed",
    });
  });

  it("reads a topic given as a literal", () => {
    const found = readChannelDispositions(
      uplink(`
        new ChannelDeclaration { Topic = "x.direct", Delivery = Delivery.ReliableOrdered, Delay = DelayRole.TrueNow }
      `),
    );
    expect(found.get("x.direct")).toEqual({
      delivery: "reliable-ordered",
      delay: "true-now",
    });
  });

  /**
   * The factory form, which a scanner reading only initialisers finds nothing
   * for. One Uplink declares all five of its channels this way, so "nothing
   * found" would have been its whole wire table.
   */
  it("follows a single-expression factory to its call sites", () => {
    const found = readChannelDispositions(
      uplink(`
        public const string AvailableTopic = "x.available";
        public const string RatesTopic = "x.rates";

        private static ChannelDeclaration TrueNow(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Delay = DelayRole.TrueNow,
        };

        Channels = new List<ChannelDeclaration>
        {
            TrueNow(AvailableTopic),
            TrueNow(RatesTopic),
        };
      `),
    );
    expect(found.get("x.available")).toEqual({
      delivery: "lossy-latest",
      delay: "true-now",
    });
    expect(found.get("x.rates")).toEqual({
      delivery: "lossy-latest",
      delay: "true-now",
    });
  });

  /**
   * A factory taking more than one argument, which the first version of the call
   * regex required a lone argument and therefore missed. The cross-check in
   * `readWireSurface` caught it against the real tree within one run, which is
   * why that cross-check is the safety argument for this whole module.
   */
  it("follows a factory called with further arguments after the topic", () => {
    const found = readChannelDispositions(
      uplink(`
        public const string ConfidenceTopic = "x.confidence";

        private static ChannelDeclaration Ground(string topic, bool absenceIsData = false) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Delay = DelayRole.TrueNow,
            AbsenceIsData = absenceIsData,
        };

        Channels = new List<ChannelDeclaration> { Ground(ConfidenceTopic, absenceIsData: true) };
      `),
    );
    expect(found.get("x.confidence")).toEqual({
      delivery: "lossy-latest",
      delay: "true-now",
    });
  });

  it("finds nothing, rather than throwing, when there is no C# to read", () => {
    const root = mkdtempSync(join(tmpdir(), "gonogo-channels-"));
    scratch.push(root);
    const client = join(root, "client");
    mkdirSync(client, { recursive: true });
    // A client-only Uplink has no plugin at all. Empty is the honest answer, and
    // `readWireSurface` only cross-checks when something WAS found, so an empty
    // scan never invents a failure for one.
    expect(readChannelDispositions(client).size).toBe(0);
  });

  it("does not invent a channel from a topic string in a comment", () => {
    const found = readChannelDispositions(
      uplink('// the client subscribes to "x.mentioned" somewhere else\n'),
    );
    expect(found.size).toBe(0);
  });
});
