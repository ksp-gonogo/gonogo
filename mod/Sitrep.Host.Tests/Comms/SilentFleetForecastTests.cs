using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;
using Xunit.Abstractions;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// A fleet the size of a relay network going silent at once: 17 craft
    /// around Kerbin and 13 ground stations. A game load does this, because it
    /// rebuilds the comms network and every craft reads as silent until it is
    /// up, and so does a relay the whole fleet routes through going dark.
    ///
    /// <para>Each silent craft is owed a forecast, which is a sweep of some
    /// 1400 visibility samples. The tracker the game runs queues them, so a
    /// capture tick takes no sample at all, and these tests hold its answers
    /// to those of the tracker that sweeps inline.</para>
    /// </summary>
    public class SilentFleetForecastTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const double KerbinDay = 21_549.425;
        private const double KerbinSma = 13_599_840_256.0;
        private const double SunMu = 1.1723328e18;
        private const double MunSma = 12_000_000.0;
        private const double MunRadius = 200_000.0;
        private const double MinmusSma = 47_000_000.0;
        private const double MinmusRadius = 60_000.0;
        private const int Sun = 0, Kerbin = 1, Mun = 2, Minmus = 3;
        private const int Craft = 17;

        private readonly ITestOutputHelper _out;

        public SilentFleetForecastTests(ITestOutputHelper output) => _out = output;

        private static IReadOnlyList<SystemBody> System() => new[]
        {
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
            new SystemBody(Sun, new OrbitElements(KerbinSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu)),
            new SystemBody(Kerbin, new OrbitElements(MunSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu)),
            new SystemBody(Kerbin, new OrbitElements(MinmusSma, 0.0, 0.1, 1.3, 0.6, 0.9, 0.0, KerbinMu)),
        };

        /// <summary>Relays at three altitudes, spread in phase and inclination, as a commsat constellation is.</summary>
        private static List<SilenceSample> Fleet(Func<int, bool> connected)
        {
            var fleet = new List<SilenceSample>(Craft);
            var altitudes = new[] { 250_000.0, 1_200_000.0, 2_863_334.0 };
            for (var i = 0; i < Craft; i++)
            {
                var orbit = new OrbitElements(
                    KerbinRadius + altitudes[i % altitudes.Length],
                    0.002 * (i % 4),
                    0.35 * (i % 5),
                    0.9 * i,
                    0.4 * i,
                    0.37 * i,
                    0.0,
                    KerbinMu);
                fleet.Add(new SilenceSample(Id(i), connected(i), orbit, false, Kerbin));
            }
            return fleet;
        }

        private static string Id(int craft) => "craft-" + craft.ToString(CultureInfo.InvariantCulture);

        /// <summary>A geometry that counts the samples asked of it.</summary>
        private sealed class Counted : IVisibilityGeometry, IVisibilityCadence
        {
            private readonly OrbitToRemoteStationGeometry _inner;
            private readonly Network _network;

            public Counted(OrbitToRemoteStationGeometry inner, Network network)
            {
                _inner = inner;
                _network = network;
            }

            public double? ShortestCycleSeconds => _inner.ShortestCycleSeconds;

            public double MarginAt(double ut)
            {
                _network.Samples++;
                return _inner.MarginAt(ut);
            }

            public double SeparationAt(double ut) => _inner.SeparationAt(ut);
        }

        /// <summary>The ground stations a forecast is swept against, and whether the game has built its network yet.</summary>
        private sealed class Network
        {
            private readonly KeplerProvider _propagator = new KeplerProvider(System());
            private readonly List<RotatingGroundStation> _stations = new List<RotatingGroundStation>();
            private readonly OccludingBody[] _occluders = { new OccludingBody(Mun, MunRadius), new OccludingBody(Minmus, MinmusRadius) };

            public Network(int stations)
            {
                for (var i = 0; i < stations; i++)
                {
                    _stations.Add(RotatingGroundStation.FromLatitudeLongitude(
                        stations == 1 ? 0.0 : -60.0 + (10.0 * i), (27.7 * i) % 360.0, 0.0, KerbinDay, KerbinRadius, 300.0 * (i % 4)));
                }
            }

            public bool Up;

            public long Samples;

            public PredictedReacquisitionSilenceDeadlinePolicy Policy() =>
                new PredictedReacquisitionSilenceDeadlinePolicy(Build, propagator: _propagator);

            private IVisibilityGeometry Build(SilenceSample sample, double ut) => Up
                ? new Counted(
                    new OrbitToRemoteStationGeometry(
                        PropagationTarget.Vessel(sample.VesselId, Kerbin, sample.Orbit!.Value),
                        PropagationFrame.CentredOn(Kerbin),
                        _occluders,
                        _stations,
                        KerbinRadius,
                        _propagator,
                        Enumerable.Repeat<double?>(40_000_000.0, _stations.Count).ToList()),
                    this)
                : null!;
        }

        /// <summary>One game as a script: which craft are heard on each tick, and the tick the network comes up on.</summary>
        private sealed class Script
        {
            public string Name = "";
            public int Ticks;
            public int NetworkUpAt;
            public Func<int, int, bool> Heard = (tick, craft) => false;
        }

        /// <summary>A load: nothing is heard, the network is up on the third tick, a third of the fleet is heard again two ticks later and another third at tick 40.</summary>
        private static Script Load() => new Script
        {
            Name = "load",
            Ticks = 70,
            NetworkUpAt = 2,
            Heard = (tick, craft) => (craft % 3 == 0 && tick >= 4) || (craft % 3 == 1 && tick >= 40),
        };

        /// <summary>A relay going dark in flight: the whole fleet is heard for four ticks and then none of it is.</summary>
        private static Script RelayLost() => new Script
        {
            Name = "relay lost",
            Ticks = 70,
            NetworkUpAt = 0,
            Heard = (tick, craft) => tick < 4,
        };

        private static string Reading(VesselContactState s) => string.Join(
            "|",
            s.State,
            s.SilenceSinceUt?.ToString("R", CultureInfo.InvariantCulture),
            s.DeadlineUt?.ToString("R", CultureInfo.InvariantCulture),
            s.DeadlineBasis,
            s.PredictedReacquisitionUt?.ToString("R", CultureInfo.InvariantCulture),
            s.PredictionGraceSec?.ToString("R", CultureInfo.InvariantCulture));

        private sealed class Run
        {
            /// <summary>Each craft's readings in the order a capture published them, a reading equal to the one before it left out.</summary>
            public Dictionary<string, List<string>> Readings = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            public List<double> TickMs = new List<double>();
            public List<long> TickSamples = new List<long>();
            public double WorstSliceMs;
            public long Samples;
        }

        /// <summary>
        /// Plays <paramref name="script"/> at one tick per second of game time.
        /// With <paramref name="slicesPerTick"/> null the tracker sweeps inline;
        /// otherwise it queues, and that many slices of
        /// <paramref name="stepsPerSlice"/> steps run between two ticks, as
        /// frames do between two captures.
        /// </summary>
        private static Run Play(Script script, int stations, int? slicesPerTick, int stepsPerSlice = 16)
        {
            var network = new Network(stations);
            var policy = network.Policy();
            var tracker = slicesPerTick == null
                ? new SilenceTracker(policy.Evaluate)
                : new SilenceTracker((ISlicedSilencePolicy)policy);
            var run = new Run();
            for (var tick = 0; tick < script.Ticks; tick++)
            {
                network.Up = tick >= script.NetworkUpAt;
                var at = tick;
                var before = network.Samples;
                var sw = Stopwatch.StartNew();
                var touched = tracker.Tick(Fleet(craft => script.Heard(at, craft)), 1000.0 + tick);
                run.TickMs.Add(sw.Elapsed.TotalMilliseconds);
                run.TickSamples.Add(network.Samples - before);
                foreach (var state in touched)
                {
                    if (!run.Readings.TryGetValue(state.VesselId, out var readings))
                    {
                        run.Readings[state.VesselId] = readings = new List<string>();
                    }
                    var reading = Reading(state);
                    if (readings.Count == 0 || readings[readings.Count - 1] != reading)
                    {
                        readings.Add(reading);
                    }
                }
                for (var slice = 0; slice < (slicesPerTick ?? 0) && tracker.HasPending; slice++)
                {
                    sw.Restart();
                    tracker.Advance(stepsPerSlice);
                    run.WorstSliceMs = Math.Max(run.WorstSliceMs, sw.Elapsed.TotalMilliseconds);
                }
            }
            run.Samples = network.Samples;
            return run;
        }

        private static bool IsSubsequence(IReadOnlyList<string> part, IReadOnlyList<string> whole)
        {
            var at = 0;
            foreach (var item in whole)
            {
                if (at < part.Count && part[at] == item)
                {
                    at++;
                }
            }
            return at == part.Count;
        }

        public static IEnumerable<object[]> Games()
        {
            foreach (var stations in new[] { 13, 1 })
            {
                foreach (var slices in new[] { 2, 40, 100_000 })
                {
                    yield return new object[] { "load", stations, slices };
                    yield return new object[] { "relay lost", stations, slices };
                }
            }
        }

        /// <summary>
        /// Every craft ends on the reading the inline tracker gives it, and
        /// reaches it through the same readings in the same order. A craft
        /// heard again before its forecast was worked out skips the readings
        /// that forecast would have added. A craft that goes silent with the
        /// network up shows its interim deadline first, which the inline
        /// tracker never shows because it sweeps before it publishes.
        /// </summary>
        [Theory]
        [MemberData(nameof(Games))]
        public void AQueuedForecastIsTheInlineForecast(string game, int stations, int slicesPerTick)
        {
            // Long enough for the slowest slicing to work through the whole fleet.
            var script = game == "load" ? Load() : RelayLost();
            script.Ticks = slicesPerTick < 40 ? 1200 : script.Ticks;
            var inline = Play(script, stations, null);
            var queued = Play(script, stations, slicesPerTick);

            Assert.Equal(Craft, inline.Readings.Count);
            for (var craft = 0; craft < Craft; craft++)
            {
                var id = Id(craft);
                var want = inline.Readings[id];
                var got = queued.Readings[id];
                Assert.True(want[want.Count - 1] == got[got.Count - 1], id + " ends on a different reading.\ninline: " + string.Join(" ; ", want) + "\nqueued: " + string.Join(" ; ", got));

                var heardAgain = Enumerable.Range(0, script.Ticks).Any(tick => tick > 4 && script.Heard(tick, craft));
                if (game == "load")
                {
                    Assert.True(IsSubsequence(got, want), id + " published a reading the inline tracker never does: " + string.Join(" ; ", got));
                    if (!heardAgain)
                    {
                        Assert.Equal(want, got);
                    }
                }
                else
                {
                    Assert.True(IsSubsequence(want, got), id + " lost a reading: " + string.Join(" ; ", got));
                    Assert.InRange(got.Count - want.Count, 0, 1);
                }
            }
        }

        [Fact]
        public void ACaptureTickTakesNoVisibilitySample()
        {
            foreach (var script in new[] { Load(), RelayLost() })
            {
                var queued = Play(script, 13, slicesPerTick: 40);

                Assert.All(queued.TickSamples, samples => Assert.Equal(0, samples));
                Assert.True(queued.Samples > 0, "no forecast was ever swept, so the zero above proves nothing");
            }
        }

        [Fact]
        public void AFleetHeardAgainBeforeItsTurnIsNeverSwept()
        {
            var script = new Script { Name = "settles", Ticks = 12, NetworkUpAt = 2, Heard = (tick, craft) => tick >= 3 };

            var inline = Play(script, 13, null);
            var queued = Play(script, 13, slicesPerTick: 1);

            Assert.True(inline.Samples > Craft * 1000, "the inline tracker no longer sweeps the fleet here, so this compares nothing");
            Assert.True(queued.Samples < 100, "swept " + queued.Samples + " samples for craft that were heard again");
        }

        /// <summary>The figures, for a reader of the test log: what one capture tick costs the main thread in each tracker.</summary>
        [Fact]
        public void TheMainThreadCostOfAFleetGoingSilent()
        {
            foreach (var script in new[] { Load(), RelayLost() })
            {
                // The first play of each warms the code paths, so the figures are the work and not the first call.
                Play(script, 13, null);
                Play(script, 13, 40);
                var inline = Play(script, 13, null);
                var queued = Play(script, 13, 40);

                _out.WriteLine(script.Name + ": inline worst tick " + inline.TickMs.Max().ToString("F2", CultureInfo.InvariantCulture)
                    + " ms (" + inline.TickSamples.Max() + " samples on it); queued worst tick "
                    + queued.TickMs.Max().ToString("F3", CultureInfo.InvariantCulture) + " ms (0 samples), worst slice "
                    + queued.WorstSliceMs.ToString("F3", CultureInfo.InvariantCulture) + " ms");
            }
        }
    }
}
