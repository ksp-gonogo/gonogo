using System;
using System.Collections.Generic;
using Sitrep.Host;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Covers the recorder-provenance fix flagged by the completeness
    /// red-team: <see cref="RecordedSession"/> used to carry only in-game UT
    /// (<see cref="RecordedEntry.T"/>), with no way to correlate a captured
    /// entry against real-world evidence (screen recording, Axiom logs) or
    /// to detect a dropped/duplicated entry independent of list order.
    /// <see cref="Recorder"/> now stamps every entry - snapshot AND event -
    /// with a real wall-clock timestamp and a shared monotonic sequence
    /// number, and <see cref="RecordedSessionCodec"/> carries both through
    /// a JSON round-trip.
    /// </summary>
    public class RecorderProvenanceTests
    {
        [Fact]
        public void RecorderStampsIncreasingSeqAndWallClockAcrossSnapshotsAndEvents()
        {
            var fakeHost = new ScriptedFakeKspHost();
            var recorder = new Recorder(fakeHost);

            var before = DateTime.UtcNow;

            fakeHost.SetUt(0.0);
            fakeHost.SetValues(new Dictionary<string, object?> { ["a"] = 0.0 });
            recorder.Tick(); // seq 0, snapshot

            fakeHost.FireLifecycle(new KspLifecycleEvent
            {
                Ut = 0.5,
                Kind = "scene-load",
                Args = new Dictionary<string, object?> { ["scene"] = "flight" },
            }); // seq 1, event

            fakeHost.SetUt(1.0);
            fakeHost.SetValues(new Dictionary<string, object?> { ["a"] = 1.0 });
            recorder.Tick(); // seq 2, snapshot

            recorder.Dispose();

            var after = DateTime.UtcNow;

            Assert.Equal(3, recorder.Session.Entries.Count);

            // Seq is shared across BOTH kinds and strictly increasing in
            // capture order, regardless of kind.
            Assert.Equal(0, recorder.Session.Entries[0].Seq);
            Assert.Equal(1, recorder.Session.Entries[1].Seq);
            Assert.Equal(2, recorder.Session.Entries[2].Seq);

            foreach (var entry in recorder.Session.Entries)
            {
                Assert.Equal(DateTimeKind.Utc, entry.WallClockUtc.Kind);
                Assert.InRange(entry.WallClockUtc, before, after);
            }
        }

        [Fact]
        public void ProvenanceSurvivesJsonRoundTrip()
        {
            var stampedAt = new DateTime(2026, 7, 7, 12, 34, 56, 789, DateTimeKind.Utc);
            var original = new RecordedSession
            {
                SchemaVersion = RecordedSessionCodec.CurrentSchemaVersion,
                StartUt = 0.0,
                Entries =
                {
                    new RecordedEntry
                    {
                        T = 0.0,
                        Kind = "snapshot",
                        Seq = 41,
                        WallClockUtc = stampedAt,
                        Snapshot = new RecordedSnapshotPayload
                        {
                            Values = new Dictionary<string, object?> { ["a"] = 1.0 },
                        },
                    },
                },
            };

            var json = RecordedSessionCodec.Write(original);
            var parsed = RecordedSessionCodec.Parse(json);

            var entry = Assert.Single(parsed.Entries);
            Assert.Equal(41, entry.Seq);
            Assert.Equal(stampedAt, entry.WallClockUtc);
            Assert.Equal(DateTimeKind.Utc, entry.WallClockUtc.Kind);
        }

        [Fact]
        public void ParsingAnEntryWithoutProvenanceFieldsDefaultsRatherThanThrows()
        {
            // A document from before this fix (or written by some other
            // future producer) simply won't have "seq"/"wallClockUtc" -
            // this must stay additive, not force a schemaVersion bump.
            var json = "{\"schemaVersion\":1,\"startUt\":0,\"entries\":["
                + "{\"t\":0,\"kind\":\"snapshot\",\"snapshot\":{\"values\":{\"a\":1}}}"
                + "]}";

            var parsed = RecordedSessionCodec.Parse(json);

            var entry = Assert.Single(parsed.Entries);
            Assert.Equal(0, entry.Seq);
            Assert.Equal(default, entry.WallClockUtc);
        }

        private sealed class ScriptedFakeKspHost : IKspHost
        {
            private double _ut;
            private Dictionary<string, object?> _values = new Dictionary<string, object?>();

            public void SetUt(double ut) => _ut = ut;

            public void SetValues(Dictionary<string, object?> values) => _values = values;

            public void FireLifecycle(KspLifecycleEvent evt) => Lifecycle.Invoke(evt);

            public double NowUt() => _ut;

            public KspSnapshot Sample() => new KspSnapshot { Ut = _ut, Values = new Dictionary<string, object?>(_values) };

            public event Action<KspLifecycleEvent> Lifecycle = delegate { };
        }
    }
}
