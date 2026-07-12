using System;
using System.Collections.Generic;
using System.IO;
using Sitrep.Host;
using Xunit;
using Sitrep.Contract;

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

        /// <summary>
        /// Regression test for the real quit-time bug: a live KSP.log capture
        /// showed <c>Recorder.Save</c> throwing
        /// <c>JsonWriter.AppendValue: unsupported CLR value type
        /// System.Double[]</c> and silently dropping the ENTIRE recording,
        /// because <see cref="Gonogo.KSP.KspHost"/>'s <c>BuildOrbit</c>/
        /// <c>BuildTarget</c> groups store ground-truth vectors
        /// (<c>truthPosition</c>/<c>truthVelocity</c>/<c>relativePosition</c>/
        /// <c>relativeVelocity</c>) as raw <c>double[]</c>, not a hand-built
        /// <c>List&lt;object?&gt;</c>. This builds a snapshot shaped exactly
        /// like <c>KspHost.Sample()</c>'s real output — nested per-group
        /// dictionaries under "vessel" (identity/orbit/flight/resources),
        /// <c>double[]</c> vectors inside "orbit", a "bodies"
        /// <c>List&lt;object?&gt;</c> of dictionaries, a NaN buried in the
        /// tree, plus a lifecycle event — and drives it through the EXACT
        /// path a real quit does: <see cref="Recorder.Save"/> to a real file
        /// on disk, then <see cref="RecordedSessionCodec.Parse"/> the bytes
        /// back. This is the test that would have caught the bug: every
        /// assertion here fails (via an uncaught
        /// <see cref="NotSupportedException"/> from the old writer) without
        /// the array-handling fix in <c>JsonWriter.AppendValue</c>.
        /// </summary>
        [Fact]
        public void RealisticKspHostShapedSnapshotSavesToFileAndReparsesWithoutThrowing()
        {
            var fakeHost = new ScriptedFakeKspHost();
            var recorder = new Recorder(fakeHost);

            fakeHost.SetUt(1234.5);
            fakeHost.SetValues(BuildRealisticKspHostShapedValues());
            recorder.Tick();

            fakeHost.FireLifecycle(new KspLifecycleEvent
            {
                Ut = 1235.0,
                Kind = "vessel-change",
                Args = new Dictionary<string, object?> { ["vesselId"] = "abc-123-def-456" },
            });

            var path = Path.Combine(Path.GetTempPath(), $"sitrep-host-realistic-{Guid.NewGuid():N}.json");
            try
            {
                // The real bug: this used to throw NotSupportedException and
                // leave no file behind at all.
                recorder.Save(path);

                Assert.True(File.Exists(path), "Recorder.Save must write a file even when the snapshot contains double[] vectors.");
                var bytes = File.ReadAllBytes(path);
                Assert.True(bytes.Length > 0, "Saved recording file must be non-empty.");

                var json = System.Text.Encoding.UTF8.GetString(bytes);
                var parsed = RecordedSessionCodec.Parse(json);

                var snapshotEntry = Assert.Single(parsed.Entries, e => e.Kind == "snapshot");
                Assert.NotNull(snapshotEntry.Snapshot);
                var values = snapshotEntry.Snapshot!.Values;

                var vessel = Assert.IsType<Dictionary<string, object?>>(values["vessel"]);

                var identity = Assert.IsType<Dictionary<string, object?>>(vessel["identity"]);
                Assert.Equal("Kerbal X", identity["name"]);
                Assert.Equal("Ship", identity["vesselType"]);

                var orbit = Assert.IsType<Dictionary<string, object?>>(vessel["orbit"]);
                Assert.Equal(700000.0, orbit["sma"]);

                // The double[] vectors: written as a JSON array, read back as
                // List<object?> (per JsonReader's array contract) — NOT
                // reconstructed as a double[]. Each element is still a
                // genuine double.
                var truthPosition = Assert.IsType<List<object?>>(orbit["truthPosition"]);
                Assert.Equal(3, truthPosition.Count);
                Assert.Equal(100.5, truthPosition[0]);
                Assert.Equal(-200.25, truthPosition[1]);
                Assert.Equal(300.0, truthPosition[2]);

                var truthVelocity = Assert.IsType<List<object?>>(orbit["truthVelocity"]);
                Assert.Equal(3, truthVelocity.Count);
                Assert.Equal(1.1, truthVelocity[0]);
                Assert.Equal(-2.2, truthVelocity[1]);
                Assert.Equal(3.3, truthVelocity[2]);

                // NaN buried inside a nested group must still round-trip via
                // the sentinel policy.
                var flight = Assert.IsType<Dictionary<string, object?>>(vessel["flight"]);
                Assert.True(flight["mach"] is double machNan && double.IsNaN(machNan));

                var resources = Assert.IsType<Dictionary<string, object?>>(vessel["resources"]);
                var electricCharge = Assert.IsType<Dictionary<string, object?>>(resources["ElectricCharge"]);
                Assert.Equal(150.0, electricCharge["current"]);
                Assert.Equal(200.0, electricCharge["max"]);

                // "bodies": a List<object?> of dictionaries, exactly as
                // KspHost.Sample() builds it.
                var bodies = Assert.IsType<List<object?>>(values["bodies"]);
                Assert.Equal(2, bodies.Count);
                var kerbin = Assert.IsType<Dictionary<string, object?>>(bodies[0]);
                Assert.Equal("Kerbin", kerbin["name"]);
                var mun = Assert.IsType<Dictionary<string, object?>>(bodies[1]);
                Assert.Equal("Mun", mun["name"]);

                var time = Assert.IsType<Dictionary<string, object?>>(values["time"]);
                Assert.Equal(4.0, time["warpFactor"]);
                Assert.Equal(false, time["paused"]);

                // The lifecycle event captured alongside the snapshot.
                var eventEntry = Assert.Single(parsed.Entries, e => e.Kind == "event");
                Assert.NotNull(eventEntry.Event);
                Assert.Equal("vessel-change", eventEntry.Event!.EventKind);
                Assert.Equal("abc-123-def-456", eventEntry.Event.Args["vesselId"]);
            }
            finally
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
        }

        /// <summary>
        /// Mirrors the dictionary/list/array shape <c>Gonogo.KSP.KspHost.Sample</c>
        /// actually produces (per-group vessel dictionaries, <c>double[]</c>
        /// ground-truth vectors, a bodies list of dictionaries) — see that
        /// class's <c>BuildVesselEntry</c>/<c>BuildOrbit</c>/<c>BuildFlight</c>/
        /// <c>BuildResources</c>/<c>BuildBodyEntry</c> for the real field
        /// names this deliberately matches.
        /// </summary>
        private static Dictionary<string, object?> BuildRealisticKspHostShapedValues()
        {
            return new Dictionary<string, object?>
            {
                ["bodies"] = new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["name"] = "Kerbin",
                        ["mu"] = 3531600000000.0,
                        ["mass"] = 5.2915793e22,
                    },
                    new Dictionary<string, object?>
                    {
                        ["name"] = "Mun",
                        ["mu"] = 65138397520.78,
                        ["mass"] = 9.7599066e20,
                    },
                },
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?>
                    {
                        ["name"] = "Kerbal X",
                        ["vesselType"] = "Ship",
                        ["id"] = "d6f1e2a0-1111-2222-3333-444455556666",
                        ["situation"] = "ORBITING",
                        ["parentBody"] = "Kerbin",
                    },
                    ["orbit"] = new Dictionary<string, object?>
                    {
                        ["sma"] = 700000.0,
                        ["ecc"] = 0.01,
                        ["inc"] = 5.2,
                        ["lan"] = 45.0,
                        ["argPe"] = 90.0,
                        ["meanAnomalyAtEpoch"] = 1.23,
                        ["epoch"] = 1234.5,
                        ["mu"] = 3531600000000.0,
                        ["apoapsisAlt"] = 80000.0,
                        ["periapsisAlt"] = 70000.0,
                        ["referenceBody"] = "Kerbin",
                        // The exact bug: KspHost.BuildOrbit stores these as
                        // `new[] { pos.x, pos.y, pos.z }` — a real double[],
                        // not a List<object?>.
                        ["truthPosition"] = new[] { 100.5, -200.25, 300.0 },
                        ["truthVelocity"] = new[] { 1.1, -2.2, 3.3 },
                        ["truthFrameRotating"] = true,
                        ["encounter"] = null,
                    },
                    ["flight"] = new Dictionary<string, object?>
                    {
                        ["latitude"] = -0.1,
                        ["longitude"] = 45.3,
                        ["altitudeAsl"] = 75000.0,
                        ["altitudeTerrain"] = 75000.0,
                        ["verticalSpeed"] = 0.0,
                        ["surfaceSpeed"] = 2246.1,
                        ["orbitalSpeed"] = 2246.1,
                        ["gForce"] = 0.0,
                        ["dynamicPressure"] = 0.0,
                        // NaN buried inside a nested group — a real source
                        // per the existing golden test above (KSP orbit/atmo
                        // math is a real source of these at edge conditions,
                        // e.g. mach at zero atmospheric density).
                        ["mach"] = double.NaN,
                        ["atmDensity"] = 0.0,
                        ["missionTime"] = 5678.9,
                    },
                    ["resources"] = new Dictionary<string, object?>
                    {
                        ["ElectricCharge"] = new Dictionary<string, object?>
                        {
                            ["current"] = 150.0,
                            ["max"] = 200.0,
                        },
                        ["LiquidFuel"] = new Dictionary<string, object?>
                        {
                            ["current"] = 400.0,
                            ["max"] = 800.0,
                        },
                    },
                    ["target"] = new Dictionary<string, object?>
                    {
                        ["name"] = "Mun",
                        // relativePosition/relativeVelocity: same double[]
                        // shape as truthPosition/truthVelocity above.
                        ["relativePosition"] = new[] { 5000.0, 6000.0, -7000.0 },
                        ["relativeVelocity"] = new[] { 10.0, -20.0, 30.0 },
                    },
                },
                ["time"] = new Dictionary<string, object?>
                {
                    ["warpFactor"] = 4.0,
                    ["paused"] = false,
                },
            };
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
