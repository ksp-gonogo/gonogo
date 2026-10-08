using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;
using Xunit.Abstractions;

namespace Sitrep.Host.Tests
{
    [CollectionDefinition(Name, DisableParallelization = true)]
    public sealed class HeapMeasurementCollection
    {
        public const string Name = "heap-measurement";
    }

    /// <summary>
    /// The recorder's byte count, held against the collector's own and against
    /// the wire. Each topic prints its three figures so the budget's arithmetic
    /// can be read off a run.
    /// </summary>
    [Collection(HeapMeasurementCollection.Name)]
    public class HeldSampleSizeTests
    {
        private const int Samples = 400;
        private readonly ITestOutputHelper _output;

        public HeldSampleSizeTests(ITestOutputHelper output)
        {
            _output = output;
        }

        [Fact]
        public void AScalarCostsABoxedObject()
        {
            Assert.Equal(24, HeldSampleSize.Of(1.5));
            Assert.Equal(0, HeldSampleSize.Of(null));
        }

        private struct Reading
        {
            public double? Value;
            public int? Count;
        }

        private sealed class Row
        {
            public Reading Reading;
            public double? Margin;
            public string? Name;
        }

        [Fact]
        public void AnEmptyNullableInsideAnInstanceHasASize()
        {
            var size = HeldSampleSize.Of(new Row { Name = "x" });
            Assert.True(size > 40);
        }

        [Fact]
        public void AnInstanceReachedTwiceIsCountedOnce()
        {
            var shared = new string('x', 100);
            var once = HeldSampleSize.Of(new List<object?> { shared });
            var twice = HeldSampleSize.Of(new List<object?> { shared, shared });
            var distinct = HeldSampleSize.Of(new List<object?> { shared, new string('x', 100) });
            Assert.Equal(once, twice);
            Assert.True(distinct > twice + 200);
        }

        [Fact]
        public void TheEstimateTracksWhatTheCollectorCountsForTheBiggestTopic()
        {
            var report = Measure("vessel.parts", seed => PartsWire(68, seed));
            Assert.InRange(report.Estimated / report.Collected, 0.8, 1.25);
        }

        [Fact]
        public void TheEstimateTracksWhatTheCollectorCountsForSmallTopics()
        {
            var flight = Measure("vessel.flight (40 scalars)", seed => FlightWire(seed));
            Assert.InRange(flight.Estimated / flight.Collected, 0.8, 1.25);

            var contacts = Measure("comms.contacts (30 rows)", seed => ContactsWire(30, seed));
            Assert.InRange(contacts.Estimated / contacts.Collected, 0.8, 1.25);
        }

        [Fact]
        public void ReportsBytesPerHeldSampleAcrossPartCounts()
        {
            foreach (var parts in new[] { 12, 68, 200 })
            {
                Measure("vessel.parts x" + parts, seed => PartsWire(parts, seed));
            }
        }

        private readonly record struct Report(double Estimated, double Collected, double Wire);

        private Report Measure(string label, Func<int, object> make)
        {
            // Built and dropped once first, so the type loading and the JIT are
            // not counted against the first retained sample.
            _ = HeldSampleSize.Of(make(0));
            var before = LiveBytes();
            var kept = new List<object>(Samples);
            for (var i = 0; i < Samples; i++)
            {
                kept.Add(make(i + 1));
            }
            var after = LiveBytes();
            var collected = (after - before) / (double)Samples;

            var estimated = kept.Average(v => (double)HeldSampleSize.Of(v));
            var wire = kept.Take(40).Average(v => EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Topic = "x.y",
                Payload = v,
                Meta = new Meta { ValidAt = 1234567.25, DeliveredAt = 1234567.25 },
            }).Length);

            var deflated = kept.Take(40).Average(v =>
            {
                var json = System.Text.Encoding.UTF8.GetBytes(EnvelopeCodec.WriteStreamData(new StreamData<object?> { Topic = "x.y", Payload = v, Meta = new Meta() }));
                using var packed = new System.IO.MemoryStream();
                using (var zip = new System.IO.Compression.DeflateStream(packed, System.IO.Compression.CompressionLevel.Fastest, true))
                {
                    zip.Write(json, 0, json.Length);
                }
                return (double)packed.Length;
            });

            var codec = new HeldSampleCodec();
            var rawBytes = 0.0;
            var packedBytes = kept.Take(40).Average(v =>
            {
                Assert.True(codec.TryPack(v, out var packed, out var raw));
                rawBytes += raw / 40.0;
                return (double)packed!.Length;
            });

            _output.WriteLine(
                $"{label}: tree heap by collector {collected:N0} B, estimate {estimated:N0} B, wire {wire:N0} B, deflated wire {deflated:N0} B, packed {packedBytes:N0} B (before deflate {rawBytes:N0} B), tree/wire {collected / wire:N2}, wire/packed {wire / packedBytes:N1}");
            GC.KeepAlive(kept);
            return new Report(estimated, collected, wire);
        }

        /// <summary>
        /// What survives a full compacting collection, read from the collector's
        /// own record of that collection: <c>GC.GetTotalMemory</c> counts roughly
        /// twice what a retained object occupies on this runtime.
        /// </summary>
        private static long LiveBytes()
        {
            GC.Collect(2, GCCollectionMode.Forced, true, true);
            GC.WaitForPendingFinalizers();
            GC.Collect(2, GCCollectionMode.Forced, true, true);
            return GC.GetGCMemoryInfo(GCKind.FullBlocking).PromotedBytes;
        }

        private static string Fresh(string text) => new string(text.ToCharArray());

        private static object PartsWire(int parts, int seed)
        {
            var rng = new Random(seed);
            var list = new List<object?>();
            for (var i = 0; i < parts; i++)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["id"] = Fresh("42000" + i),
                    ["parentId"] = i == 0 ? null : Fresh("42000" + (i - 1)),
                    ["name"] = Fresh("fuelTank.long"),
                    ["title"] = Fresh("Rockomax X200-32 Fuel Tank"),
                    ["position"] = new double[] { rng.NextDouble(), rng.NextDouble(), rng.NextDouble() },
                    ["up"] = new double[] { 0.0, 1.0, 0.0 },
                    ["bounds"] = new Dictionary<string, object?>
                    {
                        ["size"] = new double[] { 1.0, 1.2, 1.0 },
                        ["center"] = new double[] { 0.0, 0.1, 0.0 },
                    },
                    ["dryMass"] = rng.NextDouble(),
                    ["inverseStage"] = i % 5,
                    ["maxTemp"] = 2400.0,
                    ["skinMaxTemp"] = 2500.0,
                    ["currentTemp"] = 280 + rng.NextDouble() * 20,
                    ["skinTemp"] = 280 + rng.NextDouble() * 20,
                    ["category"] = Fresh("Propulsion"),
                    ["modules"] = new List<object?> { Fresh("ModuleFuelTanks"), Fresh("ModuleCargoBay") },
                    ["isRobotics"] = false,
                    ["isPowerRelated"] = false,
                    ["fuelLineTargetId"] = null,
                    ["resources"] = new Dictionary<string, object?>
                    {
                        [Fresh("LiquidFuel")] = new Dictionary<string, object?>
                        {
                            ["amount"] = rng.NextDouble() * 360,
                            ["maxAmount"] = 360.0,
                            ["flow"] = rng.NextDouble(),
                            ["nominalFlow"] = 0.75,
                        },
                        [Fresh("Oxidizer")] = new Dictionary<string, object?>
                        {
                            ["amount"] = rng.NextDouble() * 440,
                            ["maxAmount"] = 440.0,
                            ["flow"] = rng.NextDouble(),
                            ["nominalFlow"] = 0.9,
                        },
                    },
                    ["moduleStates"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["type"] = Fresh("solarPanel"),
                            ["state"] = Fresh("extended"),
                            ["tracking"] = true,
                            ["flameout"] = null,
                        },
                    },
                    ["actionBindings"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["action"] = Fresh("Toggle"),
                            ["groups"] = new List<object?> { Fresh("SAS"), Fresh("Custom01") },
                        },
                    },
                });
            }
            return new Dictionary<string, object?>
            {
                ["parts"] = list,
                ["meta"] = new Dictionary<string, object?> { ["vesselId"] = Fresh("11111111-2222-3333-4444-555555555555") },
            };
        }

        private static object FlightWire(int seed)
        {
            var rng = new Random(seed);
            var row = new Dictionary<string, object?>();
            for (var i = 0; i < 40; i++)
            {
                row["field" + i] = rng.NextDouble() * 1000;
            }
            return row;
        }

        private static object ContactsWire(int rows, int seed)
        {
            var rng = new Random(seed);
            var list = new List<object?>();
            for (var i = 0; i < rows; i++)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["from"] = Fresh("vessel:" + Guid.NewGuid()),
                    ["to"] = Fresh("station:KSC"),
                    ["startUt"] = rng.NextDouble() * 1e6,
                    ["endUt"] = rng.NextDouble() * 1e6,
                    ["margin"] = rng.NextDouble(),
                });
            }
            return new Dictionary<string, object?> { ["contacts"] = list };
        }
    }
}
