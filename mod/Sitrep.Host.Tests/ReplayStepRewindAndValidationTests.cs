using System;
using System.Collections.Generic;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// M5b review-fix regression tests.
    ///
    /// 1. <see cref="ReplayKspHost.Step"/> must correctly drive a recording
    /// whose UT goes BACKWARD partway through — a real capture contains
    /// exactly this shape after an F9 quickload (a <c>game-state-load</c>
    /// event, then entries resuming from the loaded save's earlier UT).
    /// <see cref="ReplayKspHost.AdvanceTo"/> cannot pace this: its
    /// <c>T &lt;= ut</c> comparison against a caller-supplied monotonic
    /// target means that once <c>ut</c> passes the pre-rewind peak, the very
    /// next call swallows every post-rewind entry in one gulp instead of
    /// pacing through them one at a time. <c>Step()</c> never compares one
    /// entry's <c>T</c> to another's, so it is correct-by-construction.
    ///
    /// 2. <see cref="RecordedSessionCodec.Parse"/> must throw a clear error
    /// on a malformed recording (unknown <c>kind</c>, a <c>kind</c> whose
    /// matching payload is absent, or an unsupported <c>schemaVersion</c>)
    /// instead of silently building a session that later no-ops at replay.
    /// </summary>
    public class ReplayStepRewindAndValidationTests
    {
        [Fact]
        public void StepReplaysEveryEntryOnceInCaptureOrderThroughARewind()
        {
            // Capture order: two pre-quickload snapshots, the quickload
            // event itself (T=11, still "ahead" of everything before it),
            // then two POST-quickload snapshots whose T (5, 6) is LOWER
            // than every entry already replayed — simulating a load back to
            // an earlier save.
            var session = new RecordedSession
            {
                SchemaVersion = RecordedSessionCodec.CurrentSchemaVersion,
                StartUt = 10.0,
                Entries =
                {
                    Snapshot(10.0, "pre-a"),
                    Snapshot(10.5, "pre-b"),
                    Event(11.0, "game-state-load", "reason", "quickload"),
                    Snapshot(5.0, "post-a"),
                    Snapshot(6.0, "post-b"),
                },
            };

            var replay = new ReplayKspHost(session);
            var firedEvents = new List<KspLifecycleEvent>();
            replay.Lifecycle += firedEvents.Add;

            var visitedUts = new List<double>();
            var visitedNames = new List<string>();
            var stepCount = 0;
            while (replay.Step())
            {
                stepCount++;
                visitedUts.Add(replay.NowUt());
                visitedNames.Add((string)replay.Sample().Values["name"]!);
            }

            // Exactly 5 entries, each consumed exactly once.
            Assert.Equal(5, stepCount);
            Assert.False(replay.Step());
            Assert.False(replay.Step()); // idempotent once exhausted

            // NowUt() reflects each entry's OWN T, in capture order —
            // including the backward jump from 11.0 down to 5.0.
            Assert.Equal(new[] { 10.0, 10.5, 11.0, 5.0, 6.0 }, visitedUts);

            // Sample() tracks the latest snapshot consumed so far; the
            // event step (index 2) doesn't change it, so it still reads
            // "pre-b" there. The post-rewind snapshots ("post-a", "post-b")
            // ARE both served — not swallowed — proving Step() doesn't lose
            // entries across the rewind.
            Assert.Equal(new[] { "pre-a", "pre-b", "pre-b", "post-a", "post-b" }, visitedNames);

            // The game-state-load event fired exactly once, with its own
            // recorded UT and args intact.
            var quickload = Assert.Single(firedEvents);
            Assert.Equal("game-state-load", quickload.Kind);
            Assert.Equal(11.0, quickload.Ut);
            Assert.Equal("quickload", quickload.Args["reason"]);

            // Final state: replay ended on the last (post-rewind) entry.
            Assert.Equal(6.0, replay.NowUt());
            Assert.Equal("post-b", replay.Sample().Values["name"]);
        }

        [Fact]
        public void ParseThrowsOnSnapshotEntryMissingItsSnapshotPayload()
        {
            const string json = "{\"schemaVersion\":1,\"startUt\":0,\"entries\":[{\"t\":0,\"kind\":\"snapshot\"}]}";

            var ex = Assert.Throws<FormatException>(() => RecordedSessionCodec.Parse(json));
            Assert.Contains("snapshot", ex.Message, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void ParseThrowsOnEventEntryMissingItsEventPayload()
        {
            const string json = "{\"schemaVersion\":1,\"startUt\":0,\"entries\":[{\"t\":0,\"kind\":\"event\"}]}";

            var ex = Assert.Throws<FormatException>(() => RecordedSessionCodec.Parse(json));
            Assert.Contains("event", ex.Message, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void ParseThrowsOnUnknownEntryKind()
        {
            const string json = "{\"schemaVersion\":1,\"startUt\":0,\"entries\":[{\"t\":0,\"kind\":\"bogus\"}]}";

            var ex = Assert.Throws<FormatException>(() => RecordedSessionCodec.Parse(json));
            Assert.Contains("bogus", ex.Message);
        }

        [Fact]
        public void ParseThrowsOnMismatchedKindAndPayload()
        {
            // kind is "snapshot" but the payload present is "event" —
            // must be rejected, not silently parsed with a null Snapshot.
            const string json = "{\"schemaVersion\":1,\"startUt\":0,\"entries\":[{\"t\":0,\"kind\":\"snapshot\",\"event\":{\"eventKind\":\"x\",\"args\":{}}}]}";

            Assert.Throws<FormatException>(() => RecordedSessionCodec.Parse(json));
        }

        [Fact]
        public void ParseThrowsOnUnsupportedSchemaVersion()
        {
            const string json = "{\"schemaVersion\":99,\"startUt\":0,\"entries\":[]}";

            var ex = Assert.Throws<FormatException>(() => RecordedSessionCodec.Parse(json));
            Assert.Contains("99", ex.Message);
        }

        private static RecordedEntry Snapshot(double t, string name) => new RecordedEntry
        {
            T = t,
            Kind = "snapshot",
            Snapshot = new RecordedSnapshotPayload
            {
                Values = new Dictionary<string, object?> { ["name"] = name },
            },
        };

        private static RecordedEntry Event(double t, string kind, string argKey, string argValue) => new RecordedEntry
        {
            T = t,
            Kind = "event",
            Event = new RecordedEventPayload
            {
                EventKind = kind,
                Args = new Dictionary<string, object?> { [argKey] = argValue },
            },
        };
    }
}
