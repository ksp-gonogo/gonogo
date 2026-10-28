using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A Topic run faster than the base rate makes every admitted tick a sample, and a
    /// costly group only base-rate Topics read is then built on the base ticks alone. A
    /// reader is never handed a snapshot without its group: it is deferred, still due,
    /// to a tick that has it, so every value it publishes carries the UT of the sample
    /// its group was read in.
    /// </summary>
    public class SkippableSnapshotGroupTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private const string Group = "costly";

        private static IReadOnlyDictionary<string, SnapshotGroupReaders> Readers(params string[] topics) =>
            new Dictionary<string, SnapshotGroupReaders>
            {
                [Group] = new SnapshotGroupReaders(topics, Array.Empty<string>()),
            };

        private static ChannelEngine Started(GroupReadingUplink uplink, IReadOnlyDictionary<string, SnapshotGroupReaders> readers)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.ConfigureSkippableGroups(readers, typeof(SkippableSnapshotGroupTests).Assembly);
            engine.Start();
            engine.OpenStandingSubscription(GroupReadingUplink.SlowTopic, "test");
            engine.OpenStandingSubscription(GroupReadingUplink.FastTopic, "test");
            Assert.True(engine.Cadence.TrySetRateHz(GroupReadingUplink.FastTopic, 10, out _));
            return engine;
        }

        /// <summary>Takes ticks a tenth of a UT second apart, the first one building everything, and returns the UTs the group was built at.</summary>
        private static List<double> TickTenTimesASecond(ChannelEngine engine, int ticks)
        {
            var built = new List<double>();
            for (var i = 0; i < ticks; i++)
            {
                var ut = Math.Round(10.0 + (i * 0.1), 3);
                engine.NoteGameUt(ut);
                Assert.True(engine.TryTick(
                    () =>
                    {
                        var values = new Dictionary<string, object?> { ["flight"] = ut };
                        if (engine.SamplesGroup(Group))
                        {
                            values[Group] = ut;
                            built.Add(ut);
                        }
                        return new KspSnapshot { Ut = ut, Values = values };
                    },
                    full: i == 0));
                engine.WaitForCourier(Timeout);
            }
            return built;
        }

        [Fact]
        public void TheGroupIsBuiltOnlyWhenItsReaderIsDueAndTheReaderAlwaysFindsIt()
        {
            var uplink = new GroupReadingUplink();
            using var engine = Started(uplink, Readers(GroupReadingUplink.SlowTopic));
            try
            {
                var built = TickTenTimesASecond(engine, 31);

                // One base interval apart, from the full first tick, not every tenth of a second.
                Assert.Equal(new[] { 10.0, 11.0, 12.0, 13.0 }, built);
                Assert.Equal(31, uplink.FastReads.Count);
                Assert.All(uplink.SlowReads, read => Assert.True(read.SawGroup, $"the reader was handed the sample at {read.Ut} without its group"));
                Assert.Equal(built, uplink.SlowReads.Select(read => read.Ut).ToArray());

                // A capture is handed every sample, and on the ones that left the group out the group is not there at all.
                Assert.Equal(31, uplink.CaptureSaw.Count);
                Assert.All(uplink.CaptureSaw, seen => Assert.Equal(built.Contains(seen.Ut), seen.Present));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void WithNoTopicFasterThanTheBaseRateEveryTickBuildsTheGroup()
        {
            var uplink = new GroupReadingUplink();
            using var engine = Started(uplink, Readers(GroupReadingUplink.SlowTopic));
            try
            {
                engine.Cadence.ClearOverrides();

                var built = TickTenTimesASecond(engine, 5);

                Assert.Equal(5, built.Count);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AReaderHandedASampleWithoutItsGroupWaitsForOneThatHasItAndKeepsItsUt()
        {
            var uplink = new GroupReadingUplink();
            using var engine = Started(uplink, Readers(GroupReadingUplink.SlowTopic));
            try
            {
                engine.TickSkippingAndWait(
                    new KspSnapshot { Ut = 20.0, Values = new Dictionary<string, object?> { ["flight"] = 20.0 } },
                    new[] { Group },
                    Timeout);
                Assert.Empty(uplink.SlowReads);

                engine.NoteGameUt(20.1);
                engine.TryTick(
                    () => new KspSnapshot { Ut = 20.1, Values = new Dictionary<string, object?> { ["flight"] = 20.1, [Group] = 20.1 } },
                    full: true);
                engine.WaitForCourier(Timeout);

                var read = Assert.Single(uplink.SlowReads);
                Assert.Equal(20.1, read.Ut);
                Assert.True(read.SawGroup);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AReaderOfAGroupHandedOnFromAnEarlierSampleWaitsForTheSampleThatBuildsItAndCarriesItsUt()
        {
            var uplink = new GroupReadingUplink();
            using var engine = Started(uplink, Readers(GroupReadingUplink.SlowTopic));
            try
            {
                var fullSeen = new List<bool>();
                KspSnapshot Sample(double ut, bool reuse)
                {
                    fullSeen.Add(engine.IsFullSample);
                    if (reuse)
                    {
                        engine.NoteGroupReused(Group);
                    }
                    // A kept group still carries the UT it was built at.
                    return new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?> { ["flight"] = ut, [Group] = reuse ? 30.0 : ut } };
                }

                engine.NoteGameUt(30.0);
                engine.TryTick(() => Sample(30.0, reuse: false), full: true);
                engine.WaitForCourier(Timeout);
                for (var ut = 31.0; ut <= 33.0; ut += 1.0)
                {
                    var at = ut;
                    engine.NoteGameUt(at);
                    engine.TryTick(() => Sample(at, reuse: true), full: false);
                    engine.WaitForCourier(Timeout);
                }
                engine.NoteGameUt(34.0);
                engine.TryTick(() => Sample(34.0, reuse: false), full: false);
                engine.WaitForCourier(Timeout);

                Assert.Equal(new[] { true, false, false, false, false }, fullSeen);
                Assert.Equal(new[] { 30.0, 34.0 }, uplink.SlowReads.Select(read => read.Ut).ToArray());
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AnUplinkOutsideTheCoreKeepsItsCadenceWhileAGroupIsReusedAndFindsItAbsent()
        {
            const string Other = "other";
            var outside = new GroupReadingUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            try
            {
                // The fast Topic is the core's, as vessel.flight is; the slow one an Uplink's from another assembly.
                engine.RegisterUplink(new CoreFastUplink());
                engine.RegisterUplink(OutsideTheCore.Wrap(outside));
                engine.ConfigureSkippableGroups(
                    new Dictionary<string, SnapshotGroupReaders>
                    {
                        [Group] = new SnapshotGroupReaders(Array.Empty<string>(), Array.Empty<string>()),
                        [Other] = new SnapshotGroupReaders(Array.Empty<string>(), Array.Empty<string>()),
                    },
                    typeof(SkippableSnapshotGroupTests).Assembly);
                engine.Start();
                engine.OpenStandingSubscription(GroupReadingUplink.SlowTopic, "test");
                engine.OpenStandingSubscription(CoreFastUplink.Topic, "test");
                Assert.True(engine.Cadence.TrySetRateHz(CoreFastUplink.Topic, 10, out _));

                var otherBuilt = new List<double>();
                for (var i = 0; i < 31; i++)
                {
                    var ut = Math.Round(40.0 + (i * 0.1), 3);
                    var rebuild = i % 20 == 0;
                    engine.NoteGameUt(ut);
                    Assert.True(engine.TryTick(
                        () =>
                        {
                            var values = new Dictionary<string, object?> { ["flight"] = ut, [Group] = rebuild ? ut : 40.0 };
                            if (!rebuild)
                            {
                                engine.NoteGroupReused(Group);
                            }
                            if (engine.SamplesGroup(Other))
                            {
                                values[Other] = ut;
                                otherBuilt.Add(ut);
                            }
                            return new KspSnapshot { Ut = ut, Values = values };
                        },
                        full: i == 0));
                    engine.WaitForCourier(Timeout);
                }

                // The outside channel kept its one-a-second cadence through the reuse ticks.
                Assert.Equal(new[] { 40.0, 41.0, 42.0, 43.0 }, outside.SlowReads.Select(read => read.Ut).ToArray());
                // It found the group on the rebuild ticks (40, 42) and absent on the reuse ticks (41, 43).
                Assert.Equal(new[] { true, false, true, false }, outside.SlowReads.Select(read => read.SawGroup).ToArray());
                // Its capture too: absent on every reuse tick.
                Assert.Equal(31, outside.CaptureSaw.Count);
                Assert.All(outside.CaptureSaw, seen => Assert.Equal(seen.Ut == 40.0 || seen.Ut == 42.0, seen.Present));
                // The other group is built for the outside reader's base ticks, not for every fast one.
                Assert.Equal(new[] { 40.0, 41.0, 42.0, 43.0 }, otherBuilt);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>A core Uplink with one Topic, run at the fast tier.</summary>
        private sealed class CoreFastUplink : ISitrepUplink
        {
            public const string Topic = "skipgroup.corefast";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "skippable-group-core",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.TrueNow,
                    },
                },
            };

            public void Register(IUplinkHost host) => host.AddChannelSource(Topic, snapshot => snapshot?.Ut);
        }

        /// <summary>
        /// An Uplink whose type lives in an assembly of its own, as a third-party Uplink's
        /// does: a proxy, which the runtime builds in a generated assembly.
        /// </summary>
        public class OutsideTheCore : System.Reflection.DispatchProxy
        {
            private ISitrepUplink? _inner;

            public static ISitrepUplink Wrap(ISitrepUplink inner)
            {
                var proxy = Create<ISitrepUplink, OutsideTheCore>();
                ((OutsideTheCore)(object)proxy)._inner = inner;
                return proxy;
            }

            protected override object? Invoke(System.Reflection.MethodInfo? targetMethod, object?[]? args) =>
                targetMethod!.Invoke(_inner, args);
        }

        [Fact]
        public void AChannelOfAnUplinkOutsideTheCoreReadsEveryGroup()
        {
            var uplink = new GroupReadingUplink();
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            try
            {
                engine.RegisterUplink(uplink);
                engine.ConfigureSkippableGroups(Readers(), typeof(object).Assembly);
                engine.Start();
                engine.OpenStandingSubscription(GroupReadingUplink.SlowTopic, "test");
                engine.OpenStandingSubscription(GroupReadingUplink.FastTopic, "test");
                Assert.True(engine.Cadence.TrySetRateHz(GroupReadingUplink.FastTopic, 10, out _));

                var built = TickTenTimesASecond(engine, 11);

                // The fast channel is the test Uplink's, outside the core named here, so it is a reader due every tick.
                Assert.Equal(11, built.Count);
            }
            finally
            {
                engine.Stop();
                engine.Dispose();
            }
        }

        private sealed class GroupReadingUplink : ISitrepUplink
        {
            public const string SlowTopic = "skipgroup.slow";
            public const string FastTopic = "skipgroup.fast";

            public ConcurrentQueue<(double Ut, bool SawGroup)> SlowReads { get; } = new ConcurrentQueue<(double, bool)>();

            public ConcurrentQueue<double> FastReads { get; } = new ConcurrentQueue<double>();

            public ConcurrentQueue<(double Ut, bool Present)> CaptureSaw { get; } = new ConcurrentQueue<(double, bool)>();

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "skippable-group-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    Declare(SlowTopic),
                    Declare(FastTopic),
                },
            };

            private static ChannelDeclaration Declare(string topic) => new ChannelDeclaration
            {
                Kind = SampleKind.Continuous,
                Topic = topic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.TrueNow,
            };

            public void Register(IUplinkHost host)
            {
                host.AddSampledSource(
                    snapshot =>
                    {
                        CaptureSaw.Enqueue((snapshot?.Ut ?? double.NaN, snapshot?.Values != null && snapshot.Values.ContainsKey(Group)));
                        return null;
                    },
                    _ => { });
                host.AddChannelSource(SlowTopic, snapshot =>
                {
                    var saw = snapshot?.Values != null && snapshot.Values.ContainsKey(Group);
                    SlowReads.Enqueue((snapshot?.Ut ?? double.NaN, saw));
                    return snapshot?.Ut;
                });
                host.AddChannelSource(FastTopic, snapshot =>
                {
                    FastReads.Enqueue(snapshot?.Ut ?? double.NaN);
                    return snapshot?.Ut;
                });
            }
        }
    }
}
