using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Resolving a SCET threshold's <c>{ topic, fieldPath }</c> to a number off
    /// one tick's snapshot: the half of the arm that reads the craft's TRUE
    /// state, upstream of the reveal gate.
    ///
    /// <para>Every fixture here is a plain dictionary shaped like
    /// <c>Gonogo.KSP.KspHost.Sample</c>'s raw capture, which is the point: the
    /// reading path touches no KSP API, so the thing that decides whether an
    /// operator's warp stops is testable without a game.</para>
    /// </summary>
    public class ScetThresholdSourcesTests
    {
        private const string VesselGuid = "11111111-2222-3333-4444-555555555555";
        private const string Subject = "vessel:" + VesselGuid;

        private static KspSnapshot Snapshot(
            string vesselId = VesselGuid,
            double altitudeAsl = 80_000,
            IEnumerable<string>? roster = null,
            bool rosterKeyPresent = true)
        {
            var values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?>
                    {
                        ["id"] = vesselId,
                        ["name"] = "Kerbal X",
                        ["vesselType"] = "Ship",
                        ["situation"] = "ORBITING",
                    },
                    // Every key VesselViewProvider.BuildFlight requires: it
                    // answers null rather than a part-filled payload when one is
                    // missing, and a part-filled reading is exactly what must
                    // never reach a threshold comparison.
                    ["flight"] = new Dictionary<string, object?>
                    {
                        ["latitude"] = 0.5,
                        ["longitude"] = 1.5,
                        ["altitudeAsl"] = altitudeAsl,
                        ["altitudeTerrain"] = altitudeAsl - 10,
                        ["verticalSpeed"] = 120.0,
                        ["surfaceSpeed"] = 2200.0,
                        ["orbitalSpeed"] = 2300.0,
                        ["gForce"] = 1.2,
                        ["dynamicPressure"] = 0.0,
                        ["mach"] = 3.4,
                        ["atmDensity"] = 0.0,
                        ["externalTemperature"] = 250.0,
                        ["atmosphericTemperature"] = 251.0,
                    },
                },
            };
            if (rosterKeyPresent)
            {
                var ids = roster ?? new[] { vesselId };
                values["vessels"] = ids
                    .Select(id => (object?)new Dictionary<string, object?> { ["id"] = id })
                    .ToList();
            }
            return new KspSnapshot { Ut = 1000, Values = values };
        }

        [Fact]
        public void ReadsTheNumberTheSimulationActuallyHolds()
        {
            var reader = new SnapshotScetStateReader(Snapshot(altitudeAsl: 101_234.5), ScetThresholdSources.CoreOnly);

            var reading = reader.Read(Subject, "vessel.flight", "altitudeAsl");

            Assert.Equal(ScetReadingStatus.Observed, reading.Status);
            Assert.Equal(101_234.5, reading.Value);
        }

        [Fact]
        public void AReadingAboutAnotherCraftIsNotAnAnswerToThisAlarm()
        {
            // The player switched vessels. The alarm named a craft and the
            // payload is about a different one, so the honest answer is "not
            // now" rather than a number about somebody else's ship.
            var other = "99999999-9999-9999-9999-999999999999";
            var reader = new SnapshotScetStateReader(
                Snapshot(vesselId: other, roster: new[] { other, VesselGuid }), ScetThresholdSources.CoreOnly);

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read(Subject, "vessel.flight", "altitudeAsl").Status);
        }

        [Fact]
        public void ACraftMissingFromTheRosterIsGoneRatherThanMerelyUnwatched()
        {
            var other = "99999999-9999-9999-9999-999999999999";
            var reader = new SnapshotScetStateReader(
                Snapshot(vesselId: other, roster: new[] { other }), ScetThresholdSources.CoreOnly);

            Assert.Equal(
                ScetReadingStatus.SubjectGone,
                reader.Read(Subject, "vessel.flight", "altitudeAsl").Status);
        }

        [Fact]
        public void AnAbsentRosterNeverDeclaresACraftGone()
        {
            // The scene has not loaded. Calling an alarm dead because the main
            // menu is up is the one wrong answer that cannot be taken back.
            var other = "99999999-9999-9999-9999-999999999999";
            var reader = new SnapshotScetStateReader(
                Snapshot(vesselId: other, rosterKeyPresent: false), ScetThresholdSources.CoreOnly);

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read(Subject, "vessel.flight", "altitudeAsl").Status);
        }

        [Fact]
        public void NoVesselAtAllReadsAsNotObservable()
        {
            var reader = new SnapshotScetStateReader(
                new KspSnapshot { Ut = 1000, Values = new Dictionary<string, object?>() },
                ScetThresholdSources.CoreOnly);

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read(Subject, "vessel.flight", "altitudeAsl").Status);
        }

        [Fact]
        public void NoSnapshotAtAllReadsAsNotObservable()
        {
            var reader = new SnapshotScetStateReader(null, ScetThresholdSources.CoreOnly);

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read(Subject, "vessel.flight", "altitudeAsl").Status);
        }

        [Theory]
        // A Topic no threshold may be armed against.
        [InlineData("vessel.parts", "count")]
        // A path that names nothing on a Topic that does exist.
        [InlineData("vessel.flight", "altitudeAboveSeaLevel")]
        // The payload itself, which is never a number.
        [InlineData("vessel.flight", "")]
        // A path that runs off the end of a number.
        [InlineData("vessel.flight", "altitudeAsl.magnitude")]
        public void AnAddressThatResolvesToNoNumberReadsAsNotObservable(string topic, string path)
        {
            var reader = new SnapshotScetStateReader(Snapshot(), ScetThresholdSources.CoreOnly);

            Assert.Equal(ScetReadingStatus.NotObservable, reader.Read(Subject, topic, path).Status);
        }

        [Fact]
        public void ANestedPathResolves()
        {
            var reader = new SnapshotScetStateReader(Snapshot(), ScetThresholdSources.CoreOnly);

            // meta.quality is an enum, which reaches the wire as its integer:
            // a threshold on one is a legitimate way to ask whether a reading's
            // standing changed.
            var reading = reader.Read(Subject, "vessel.flight", "meta.quality");

            Assert.Equal(ScetReadingStatus.Observed, reading.Status);
        }

        [Fact]
        public void OneTopicIsBuiltOncePerReaderHoweverManyAlarmsAskForIt()
        {
            // Two alarms on one Topic is the ordinary case, and rebuilding the
            // payload per alarm would put the cost on the main thread every tick.
            var reader = new SnapshotScetStateReader(Snapshot(altitudeAsl: 50_000), ScetThresholdSources.CoreOnly);

            var first = reader.Read(Subject, "vessel.flight", "altitudeAsl");
            var second = reader.Read(Subject, "vessel.flight", "verticalSpeed");

            Assert.Equal(50_000, first.Value);
            Assert.Equal(120.0, second.Value);
        }

        [Fact]
        public void EveryAddressableTopicIsOneTheSimulationCanActuallyResolve()
        {
            // The table is hand-written, so this is what stops an entry naming a
            // Topic whose payload is not a dictionary tree: a threshold armed
            // against one of those would be accepted and then never fire, which
            // is the silent failure the whole arm exists to avoid.
            foreach (var topic in ScetThresholdSources.CoreOnly.Topics)
            {
                Assert.True(ScetThresholdSources.CoreOnly.Knows(topic), topic);
            }
            Assert.False(ScetThresholdSources.CoreOnly.Knows("vessel.parts"));
            Assert.False(ScetThresholdSources.CoreOnly.Knows(null));
            Assert.False(ScetThresholdSources.CoreOnly.Knows(""));
        }

        private static KspSnapshot CareerSnapshot(double funds = 25_000)
        {
            return new KspSnapshot
            {
                Ut = 1000,
                Values = new Dictionary<string, object?>
                {
                    ["career"] = new Dictionary<string, object?>
                    {
                        ["economy"] = new Dictionary<string, object?>
                        {
                            ["funds"] = funds,
                            ["reputation"] = 12.0,
                            ["science"] = 340.0,
                        },
                    },
                    // The craft the "armed against a vessel" case names, present
                    // in the roster so the refusal below is unambiguously "this
                    // payload is not about you" rather than "your craft is gone".
                    ["vessels"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["id"] = VesselGuid },
                    },
                },
            };
        }

        [Fact]
        public void AFundsThresholdIsExpressible()
        {
            // The cheap half of stopping a warp on a career figure: an operator
            // skipping build time wants the clock halted when they can afford the
            // next thing, and a client watching the same number can only poll it a
            // light-time late.
            var reader = new SnapshotScetStateReader(
                CareerSnapshot(funds: 25_000), ScetThresholdSources.CoreOnly);

            var reading = reader.Read("game", CareerViewProvider.Topic, "economy.funds");

            Assert.Equal(ScetReadingStatus.Observed, reading.Status);
            Assert.Equal(25_000, reading.Value);
        }

        [Fact]
        public void ACareerReadingIsStampedGameRatherThanACareerTokenOfItsOwn()
        {
            // The stamp is the vocabulary, so this is the pin on which token is
            // correct: there is one career per save and no vessel switch can
            // change which one is read, so "game" is what it is, and a third
            // token would have nothing to tell apart.
            var payload = Assert.IsType<Dictionary<string, object?>>(
                CareerViewProvider.BuildCareer(CareerSnapshot()));
            var meta = Assert.IsType<Dictionary<string, object?>>(payload["meta"]);

            Assert.Equal("game", meta["source"]);
        }

        [Fact]
        public void ACareerFigureRefusesAnAlarmArmedAgainstACraft()
        {
            var reader = new SnapshotScetStateReader(CareerSnapshot(), ScetThresholdSources.CoreOnly);

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read(Subject, CareerViewProvider.Topic, "economy.funds").Status);
        }

        [Fact]
        public void ASandboxSaveHasNoCareerToRead()
        {
            // BuildCareer answers null outside career mode, and a null payload is
            // not a dictionary, so the threshold reads as "not now" forever rather
            // than as a funds balance of zero.
            var reader = new SnapshotScetStateReader(
                new KspSnapshot { Ut = 1000, Values = new Dictionary<string, object?>() },
                ScetThresholdSources.CoreOnly);

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read("game", CareerViewProvider.Topic, "economy.funds").Status);
        }

        private static KspSnapshot ProbeSnapshot(double reserves = 42)
        {
            return new KspSnapshot
            {
                Ut = 1000,
                Values = new Dictionary<string, object?>
                {
                    ["probe"] = new Dictionary<string, object?> { ["reserves"] = reserves },
                },
            };
        }

        private static Kernel ResolvedWith(ScetThresholdSourceProbe probe)
        {
            var kernel = new Kernel();
            ScetThresholdSourceProbe.Register(kernel, probe);
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        /// <summary>
        /// The same two calls <see cref="ScetThresholdSourceProbe.Register"/>
        /// makes, for the local providers below that are about core's own
        /// behaviour rather than about an Uplink's reach.
        /// </summary>
        private static Kernel ResolvedWith(IScetThresholdSources provider)
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = ScetThresholdCapability.Id,
                Exclusive = false,
                SpineCritical = false,
            });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = ScetThresholdCapability.Id,
                Id = provider.ProviderId,
                Factory = _ => provider,
            });
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        [Fact]
        public void CoreAloneDoesNotKnowATopicNobodyContributed()
        {
            // The control for the test below. Without it a seam that did nothing
            // at all would still look like it worked, because the assertion would
            // be passing against a Topic core had all along.
            Assert.False(ScetThresholdSources.CoreOnly.Knows(ScetThresholdSourceProbe.ProbeTopic));
        }

        [Fact]
        public void AProviderWrittenAtUplinkPositionMakesItsOwnTopicArmableAndReadable()
        {
            // ScetThresholdSourceProbe lives in Sitrep.Contract.TestSupport, which
            // references Sitrep.Contract and nothing else of this repo's: the same
            // compile surface an Uplink csproj is held to. So this passing is the
            // proof that an outside author can reach the seam, rather than a
            // statement that core can reach its own table.
            var sources = new ScetThresholdSources(ResolvedWith(new ScetThresholdSourceProbe()));

            Assert.True(sources.Knows(ScetThresholdSourceProbe.ProbeTopic));
            Assert.Contains(ScetThresholdSourceProbe.ProbeTopic, sources.Topics);

            var reader = new SnapshotScetStateReader(ProbeSnapshot(reserves: 42), sources);
            var reading = reader.Read("game", ScetThresholdSourceProbe.ProbeTopic, "reserves");

            Assert.Equal(ScetReadingStatus.Observed, reading.Status);
            Assert.Equal(42, reading.Value);
        }

        [Fact]
        public void AContributedReadingIsHeldToTheSameSubjectRuleAsACoreOne()
        {
            var probe = new ScetThresholdSourceProbe(subject: "vessel:" + VesselGuid);
            var sources = new ScetThresholdSources(ResolvedWith(probe));
            var reader = new SnapshotScetStateReader(ProbeSnapshot(), sources);

            // Stamped for a craft, armed for the game: not an answer to this
            // alarm's question, the same as any core payload.
            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read("game", ScetThresholdSourceProbe.ProbeTopic, "reserves").Status);
            Assert.Equal(
                ScetReadingStatus.Observed,
                reader.Read(Subject, ScetThresholdSourceProbe.ProbeTopic, "reserves").Status);
        }

        [Fact]
        public void CoreStillReadsItsOwnTopicsWithAProviderInstalled()
        {
            var sources = new ScetThresholdSources(ResolvedWith(new ScetThresholdSourceProbe()));
            var reader = new SnapshotScetStateReader(Snapshot(altitudeAsl: 70_000), sources);

            Assert.Equal(70_000, reader.Read(Subject, "vessel.flight", "altitudeAsl").Value);
        }

        [Fact]
        public void AKernelThatNeverHeardOfTheCapabilityLeavesCoreTopicsWorking()
        {
            // An install where the declaration never happened is not one where
            // SCET alarms should stop working. Active() throws on an unknown
            // capability, and that throw is swallowed rather than allowed to take
            // the arm's own table with it.
            var sources = new ScetThresholdSources(new Kernel());

            Assert.True(sources.Knows("vessel.flight"));
            Assert.False(sources.Knows(ScetThresholdSourceProbe.ProbeTopic));
        }

        [Fact]
        public void ACoreTopicIsNotDisplacedByAContributedEntryNamingIt()
        {
            // An operator arms against the number on their screen. An installed
            // mod that could change what a core reading means underneath them
            // would make that number a different one after the fact.
            var sources = new ScetThresholdSources(ResolvedWith(new ShadowingProbe()));
            var reader = new SnapshotScetStateReader(Snapshot(altitudeAsl: 70_000), sources);

            Assert.Equal(70_000, reader.Read(Subject, "vessel.flight", "altitudeAsl").Value);
        }

        [Fact]
        public void AProviderThatThrowsCostsOnlyItsOwnTopics()
        {
            var sources = new ScetThresholdSources(ResolvedWith(new ThrowingProbe()));

            Assert.False(sources.Knows("throwing.topic"));
            Assert.True(sources.Knows("vessel.flight"));
        }

        /// <summary>A provider claiming a Topic core already holds, which core keeps.</summary>
        private sealed class ShadowingProbe : IScetThresholdSources
        {
            public string ProviderId => "shadowing";

            public IReadOnlyList<ScetThresholdSource> Sources() => new[]
            {
                new ScetThresholdSource
                {
                    Topic = "vessel.flight",
                    Build = _ => new Dictionary<string, object?>
                    {
                        ["altitudeAsl"] = -1.0,
                        ["meta"] = new Dictionary<string, object?> { ["source"] = Subject },
                    },
                },
            };
        }

        /// <summary>A provider whose own Sources throws, which must not take the table with it.</summary>
        private sealed class ThrowingProbe : IScetThresholdSources
        {
            public string ProviderId => "throwing";

            public IReadOnlyList<ScetThresholdSource> Sources() =>
                throw new InvalidOperationException("this mod is broken");
        }
    }
}
