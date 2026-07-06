using System;
using System.Collections.Generic;
using System.IO;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Task 2's payoff test: a scripted fake <see cref="IKspHost"/> drives a
    /// <see cref="Recorder"/>, the resulting <see cref="RecordedSession"/> is
    /// written to a file and loaded back into a <see cref="ReplayKspHost"/>,
    /// and the replay is asserted to reproduce the EXACT same
    /// <see cref="IKspHost.Sample"/> values and <see cref="IKspHost.Lifecycle"/>
    /// event sequence the original host produced — including a NaN value
    /// surviving the JSON round-trip. This is the exact record-once /
    /// replay-headless loop the user's real KSP capture will drive.
    /// </summary>
    public class RecorderReplayRoundTripTests
    {
        [Fact]
        public void ReplayReproducesOriginalSampleValuesAndLifecycleEventsExactly()
        {
            var fakeHost = new ScriptedFakeKspHost();
            var recorder = new Recorder(fakeHost);

            // UT 0: snapshot only.
            fakeHost.SetUt(0.0);
            fakeHost.SetValues(new Dictionary<string, object?>
            {
                ["a"] = 0.0,
                ["name"] = "zero",
            });
            recorder.Tick();

            // UT 1: snapshot only.
            fakeHost.SetUt(1.0);
            fakeHost.SetValues(new Dictionary<string, object?>
            {
                ["a"] = 1.0,
                ["name"] = "one",
            });
            recorder.Tick();

            // UT 1.5: a lifecycle event, no snapshot.
            fakeHost.FireLifecycle(new KspLifecycleEvent
            {
                Ut = 1.5,
                Kind = "scene-load",
                Args = new Dictionary<string, object?> { ["scene"] = "flight" },
            });

            // UT 2: snapshot carrying a NaN value (KSP orbit math is a real source of these).
            fakeHost.SetUt(2.0);
            fakeHost.SetValues(new Dictionary<string, object?>
            {
                ["a"] = 2.0,
                ["nan"] = double.NaN,
            });
            recorder.Tick();

            // UT 3: a second lifecycle event (quickload), then a snapshot at the same UT.
            fakeHost.FireLifecycle(new KspLifecycleEvent
            {
                Ut = 3.0,
                Kind = "game-state-load",
                Args = new Dictionary<string, object?> { ["reason"] = "quickload" },
            });
            fakeHost.SetUt(3.0);
            fakeHost.SetValues(new Dictionary<string, object?>
            {
                ["a"] = 3.0,
                ["name"] = "three",
            });
            recorder.Tick();

            // UT 4: snapshot only.
            fakeHost.SetUt(4.0);
            fakeHost.SetValues(new Dictionary<string, object?>
            {
                ["a"] = 4.0,
                ["name"] = "four",
            });
            recorder.Tick();

            recorder.Dispose();

            Assert.Equal(7, recorder.Session.Entries.Count);

            var path = Path.Combine(Path.GetTempPath(), $"sitrep-host-roundtrip-{Guid.NewGuid():N}.json");
            try
            {
                recorder.Save(path);

                var replay = ReplayKspHost.LoadFromFile(path);
                var firedEvents = new List<KspLifecycleEvent>();
                replay.Lifecycle += firedEvents.Add;

                // Before anything is replayed: no snapshot reached yet.
                Assert.Empty(replay.Sample().Values);
                Assert.Empty(firedEvents);

                replay.AdvanceTo(0.0);
                Assert.Equal(0.0, replay.NowUt());
                Assert.Equal(0.0, replay.Sample().Values["a"]);
                Assert.Equal("zero", replay.Sample().Values["name"]);
                Assert.Empty(firedEvents);

                replay.AdvanceTo(1.0);
                Assert.Equal(1.0, replay.Sample().Values["a"]);
                Assert.Equal("one", replay.Sample().Values["name"]);
                Assert.Empty(firedEvents);

                // T=1.5 event now in range, but the T=2 snapshot is not yet — Sample()
                // must still report the LATEST snapshot <= ut, not merely the latest overall.
                replay.AdvanceTo(1.5);
                Assert.Equal(1.0, replay.Sample().Values["a"]);
                var scene = Assert.Single(firedEvents);
                Assert.Equal("scene-load", scene.Kind);
                Assert.Equal(1.5, scene.Ut);
                Assert.Equal("flight", scene.Args["scene"]);

                replay.AdvanceTo(2.0);
                Assert.Equal(2.0, replay.Sample().Values["a"]);
                Assert.True(replay.Sample().Values["nan"] is double nanValue && double.IsNaN(nanValue));
                Assert.Single(firedEvents); // no new event yet

                replay.AdvanceTo(3.0);
                Assert.Equal(3.0, replay.Sample().Values["a"]);
                Assert.Equal("three", replay.Sample().Values["name"]);
                Assert.Equal(2, firedEvents.Count);
                var quickload = firedEvents[1];
                Assert.Equal("game-state-load", quickload.Kind);
                Assert.Equal(3.0, quickload.Ut);
                Assert.Equal("quickload", quickload.Args["reason"]);

                replay.AdvanceTo(4.0);
                Assert.Equal(4.0, replay.Sample().Values["a"]);
                Assert.Equal("four", replay.Sample().Values["name"]);

                // Re-advancing past already-fired entries must not re-fire anything.
                replay.AdvanceTo(4.0);
                Assert.Equal(2, firedEvents.Count);

                // Events fired exactly once each, in recorded order.
                Assert.Equal(new[] { "scene-load", "game-state-load" }, firedEvents.ConvertAll(e => e.Kind));
                Assert.Equal(new[] { 1.5, 3.0 }, firedEvents.ConvertAll(e => e.Ut));
            }
            finally
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
        }

        [Fact]
        public void SerializeThenParseIsLosslessIncludingNaN()
        {
            var original = new RecordedSession
            {
                SchemaVersion = 1,
                StartUt = 10.0,
                Entries =
                {
                    new RecordedEntry
                    {
                        T = 10.0,
                        Kind = "snapshot",
                        Snapshot = new RecordedSnapshotPayload
                        {
                            Values = new Dictionary<string, object?>
                            {
                                ["altitude"] = 71000.25,
                                ["eccentricAnomaly"] = double.NaN,
                                ["positiveInf"] = double.PositiveInfinity,
                                ["negativeInf"] = double.NegativeInfinity,
                                ["landed"] = false,
                                ["name"] = "Kerbal X",
                                ["stage"] = null,
                            },
                        },
                    },
                    new RecordedEntry
                    {
                        T = 12.5,
                        Kind = "event",
                        Event = new RecordedEventPayload
                        {
                            EventKind = "vessel-change",
                            Args = new Dictionary<string, object?> { ["vesselId"] = "abc-123" },
                        },
                    },
                },
            };

            var json = RecordedSessionCodec.Write(original);
            var parsed = RecordedSessionCodec.Parse(json);

            Assert.Equal(original.SchemaVersion, parsed.SchemaVersion);
            Assert.Equal(original.StartUt, parsed.StartUt);
            Assert.Equal(2, parsed.Entries.Count);

            var snapshot = parsed.Entries[0];
            Assert.Equal("snapshot", snapshot.Kind);
            Assert.Equal(10.0, snapshot.T);
            Assert.NotNull(snapshot.Snapshot);
            Assert.Equal(71000.25, snapshot.Snapshot!.Values["altitude"]);
            Assert.True(snapshot.Snapshot.Values["eccentricAnomaly"] is double nan && double.IsNaN(nan));
            Assert.True(snapshot.Snapshot.Values["positiveInf"] is double posInf && double.IsPositiveInfinity(posInf));
            Assert.True(snapshot.Snapshot.Values["negativeInf"] is double negInf && double.IsNegativeInfinity(negInf));
            Assert.Equal(false, snapshot.Snapshot.Values["landed"]);
            Assert.Equal("Kerbal X", snapshot.Snapshot.Values["name"]);
            Assert.Null(snapshot.Snapshot.Values["stage"]);

            var evt = parsed.Entries[1];
            Assert.Equal("event", evt.Kind);
            Assert.Equal(12.5, evt.T);
            Assert.NotNull(evt.Event);
            Assert.Equal("vessel-change", evt.Event!.EventKind);
            Assert.Equal("abc-123", evt.Event.Args["vesselId"]);
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
