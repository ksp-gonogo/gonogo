using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class ContactPlanningTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;

        private static OrbitElements Orbit(double sma, double ecc = 0.0, double inc = 0.0) =>
            new OrbitElements(sma, ecc, inc, 0.0, 0.0, 0.0, 0.0, KerbinMu);

        private static readonly SystemBody[] Bodies =
        {
            new SystemBody(-1, null),
            new SystemBody(0, new OrbitElements(13_599_840_256.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.1723328e18)),
        };

        private static ContactPlanRequest TwoCraft(double fromUt = 0.0)
        {
            var nodes = new[]
            {
                PlanNode.Orbiting("vessel:a", PropagationTarget.Vessel("vessel:a", 1, Orbit(KerbinRadius + 700_000.0))),
                PlanNode.Orbiting("vessel:b", PropagationTarget.Vessel("vessel:b", 1, Orbit(KerbinRadius + 800_000.0))),
            };
            var pairs = new[] { new PlanPair("vessel:a", "vessel:b", new[] { new OccludingBody(1, KerbinRadius) }, null) };
            return new ContactPlanRequest(nodes, pairs, new KeplerProvider(Bodies), 1, fromUt, 3600.0);
        }

        private static IReadOnlyDictionary<string, ContactPlanRequest> Round(params (string Centre, ContactPlanRequest Request)[] plans)
        {
            var round = new Dictionary<string, ContactPlanRequest>();
            foreach (var (centre, request) in plans)
            {
                round[centre] = request;
            }
            return round;
        }

        private static IReadOnlyDictionary<string, ContactPlan>? Wait(ContactPlanRunner runner)
        {
            IReadOnlyDictionary<string, ContactPlan>? plans = null;
            var clock = Stopwatch.StartNew();
            while (!runner.TryTake(out plans) && clock.Elapsed < TimeSpan.FromSeconds(30))
            {
                Thread.Sleep(5);
            }
            return plans;
        }

        [Fact]
        public void AnOrbitWobblingInsideTheToleranceHasNotMoved()
        {
            Assert.False(ContactPlanSchedule.Moved(Orbit(700_000.0), Orbit(700_010.0, 1e-6, 1e-5)));
        }

        private const double MunMu = 6.5138398e10;

        /// <summary>
        /// Two readings of one coasting craft ten seconds apart, as the game
        /// gave them on a rig: a nearly circular, nearly equatorial orbit of
        /// the Mun, whose periapsis is so ill-defined that its argument
        /// wandered a third of a degree while the craft went on round the same
        /// circle. The mean anomaly moved the other way by as much.
        /// </summary>
        [Fact]
        public void ACircularOrbitWhosePeriapsisWandersHasNotMoved()
        {
            var was = OrbitElements.FromKspDegrees(
                229998.5897949, 5.9e-06, 0.0001239, 76.619569, 282.2393159, 3.728574, 638164933.670523, MunMu);
            var now = OrbitElements.FromKspDegrees(
                229998.5884454, 5.8e-06, 0.0001239, 76.6194596, 281.8626248, 3.7587514, 638164943.870514, MunMu);

            Assert.False(ContactPlanSchedule.Moved(was, now));
        }

        /// <summary>The same turn of the periapsis on an orbit that has one is a different orbit.</summary>
        [Fact]
        public void AnEccentricOrbitWhosePeriapsisTurnsHasMoved()
        {
            var was = new OrbitElements(700_000.0, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);
            var now = new OrbitElements(700_000.0, 0.3, 0.0, 0.0, 0.0066, -0.0066, 0.0, KerbinMu);

            Assert.True(ContactPlanSchedule.Moved(was, now));
        }

        /// <summary>The craft set back along the same orbit, as a burn that cancels itself or a teleport leaves it, is somewhere else.</summary>
        [Fact]
        public void TheSameOrbitWithTheCraftElsewhereOnItHasMoved()
        {
            var was = new OrbitElements(700_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);
            var now = new OrbitElements(700_000.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, KerbinMu);

            Assert.True(ContactPlanSchedule.Moved(was, now));
        }

        [Fact]
        public void ABurnHasMovedTheOrbit()
        {
            Assert.True(ContactPlanSchedule.Moved(Orbit(700_000.0), Orbit(900_000.0)));
            Assert.True(ContactPlanSchedule.Moved(Orbit(700_000.0), Orbit(700_000.0, 0.01)));
            Assert.True(ContactPlanSchedule.Moved(Orbit(700_000.0), Orbit(700_000.0, 0.0, 0.01)));
        }

        [Fact]
        public void TheRunnerHandsBackTheFinishedRoundOnceAndRunsOneAtATime()
        {
            var request = TwoCraft();
            var runner = new ContactPlanRunner();

            Assert.True(runner.Offer(Round(("ground:a", request), ("ground:b", request)), new object[0]));
            Assert.False(runner.Offer(Round(("ground:a", request)), new object[0]));
            var plans = Wait(runner);

            Assert.NotNull(plans);
            Assert.Equal(new[] { "ground:a", "ground:b" }, plans!.Keys.OrderBy(k => k));
            Assert.Single(plans["ground:a"].Pairs);
            Assert.False(runner.TryTake(out _));
        }

        [Fact]
        public void AnInlineRoundHasFinishedByTheTimeItIsOffered()
        {
            var runner = new ContactPlanRunner();

            Assert.True(runner.Offer(Round(("ground:a", TwoCraft())), new object[0], inline: true));

            Assert.False(runner.Running);
            Assert.True(runner.TryTake(out var plans));
            Assert.Single(plans!);
        }

        [Fact]
        public void ARoundThatThrowsIsReportedAndFreesTheRunner()
        {
            var request = new ContactPlanRequest(null!, new PlanPair[0], new KeplerProvider(), 1, 0.0, 3600.0);
            var runner = new ContactPlanRunner();
            Exception? failure = null;
            using var reported = new ManualResetEventSlim();

            runner.Offer(Round(("ground:a", request)), new object[0], ex =>
            {
                failure = ex;
                reported.Set();
            });

            Assert.True(reported.Wait(TimeSpan.FromSeconds(30)));
            Assert.NotNull(failure);
            var clock = Stopwatch.StartNew();
            while (runner.Running && clock.Elapsed < TimeSpan.FromSeconds(30))
            {
                Thread.Sleep(5);
            }
            Assert.False(runner.Running);
            Assert.False(runner.TryTake(out _));
        }

        /// <summary>
        /// Two centres that have heard the same news of a craft plan it from the
        /// same solved positions, and a later round solves only what is new.
        /// </summary>
        [Fact]
        public void CentresThatHeardTheSameNewsShareTheirSolvedPositions()
        {
            var a = new object();
            var b = new object();
            ContactPlanRequest Remembering(object keyA, object keyB)
            {
                var nodes = new[]
                {
                    PlanNode.Orbiting("vessel:a", PropagationTarget.Vessel("vessel:a", 1, Orbit(KerbinRadius + 700_000.0))).RememberedAs(keyA),
                    PlanNode.Orbiting("vessel:b", PropagationTarget.Vessel("vessel:b", 1, Orbit(KerbinRadius + 800_000.0))).RememberedAs(keyB),
                };
                var pairs = new[] { new PlanPair("vessel:a", "vessel:b", new[] { new OccludingBody(1, KerbinRadius) }, null) };
                return new ContactPlanRequest(nodes, pairs, new KeplerProvider(Bodies), 1, 0.0, 3600.0);
            }
            var runner = new ContactPlanRunner();
            var live = new object[] { a, b };

            runner.Offer(Round(("ground:first", Remembering(a, b))), live, inline: true);
            runner.TryTake(out var alone);
            runner.Offer(Round(("ground:second", Remembering(a, b))), live, inline: true);
            runner.TryTake(out var after);
            var other = new object();
            runner.Offer(Round(("ground:third", Remembering(a, other))), new object[] { a, other }, inline: true);
            runner.TryTake(out var burned);

            var first = alone!["ground:first"];
            var second = after!["ground:second"];
            var third = burned!["ground:third"];
            Assert.True(
                second.PositionSolves < first.PositionSolves / 2,
                "the second centre solved " + second.PositionSolves + " positions of the first's " + first.PositionSolves);
            Assert.True(
                third.PositionSolves > second.PositionSolves && third.PositionSolves < first.PositionSolves,
                "a centre with news of one craft solved " + third.PositionSolves + ", between " + second.PositionSolves + " and " + first.PositionSolves);
            Assert.Equal(first.Pairs[0].Windows.Count, second.Pairs[0].Windows.Count);
            for (var i = 0; i < first.Pairs[0].Windows.Count; i++)
            {
                Assert.Equal(first.Pairs[0].Windows[i].OpenUt, second.Pairs[0].Windows[i].OpenUt);
                Assert.Equal(first.Pairs[0].Windows[i].CloseUt, second.Pairs[0].Windows[i].CloseUt);
            }
        }

        [Fact]
        public void APlanStartsAtTheInstantOnItsOwnGridAtOrBeforeTheOneAskedFor()
        {
            var request = TwoCraft(fromUt: 1234.5);
            var runner = new ContactPlanRunner();

            runner.Offer(Round(("ground:a", request)), new object[0], inline: true);
            runner.TryTake(out var plans);

            var plan = plans!["ground:a"];
            Assert.Equal(request.Step(), plan.StepSeconds);
            Assert.InRange(plan.FromUt, 1234.5 - plan.StepSeconds, 1234.5);
            Assert.Equal(0.0, Math.IEEERemainder(plan.FromUt, plan.StepSeconds), 6);
        }

        /// <summary>A centre's grid is its own: what another centre has heard never chooses it.</summary>
        [Fact]
        public void CentresPlanningDifferentCraftEachRunOnTheirOwnGrid()
        {
            var slow = TwoCraft();
            var fast = new ContactPlanRequest(
                new[] { PlanNode.Orbiting("vessel:low", PropagationTarget.Vessel("vessel:low", 1, Orbit(KerbinRadius + 80_000.0))) },
                new PlanPair[0],
                new KeplerProvider(Bodies),
                1,
                0.0,
                3600.0);
            var runner = new ContactPlanRunner();

            runner.Offer(Round(("ground:slow", slow), ("ground:fast", fast)), new object[0], inline: true);
            runner.TryTake(out var plans);

            Assert.Equal(slow.Step(), plans!["ground:slow"].StepSeconds);
            Assert.Equal(fast.Step(), plans["ground:fast"].StepSeconds);
            Assert.NotEqual(plans["ground:slow"].StepSeconds, plans["ground:fast"].StepSeconds);
        }

        [Fact]
        public void ThePlanReachesTheWireWindowForWindow()
        {
            var plan = new ContactPlan(
                100.0,
                21_700.0,
                48.6,
                new[]
                {
                    new PairPlan("ground:ksc", "vessel:a", 21_700.0, new[] { new ContactWindow(null, 400.0), new ContactWindow(5_000.0, null) }),
                    new PairPlan("vessel:a", "vessel:b", 9_000.0, new ContactWindow[0]),
                },
                0,
                0);

            var wire = ContactPlanWire.ToPayload(plan);

            Assert.Equal(21_700.0, wire.HorizonUt);
            Assert.Equal(2, wire.Pairs.Count);
            Assert.Equal("ground:ksc", wire.Pairs[0].A);
            Assert.Equal("vessel:a", wire.Pairs[0].B);
            Assert.Null(wire.Pairs[0].Windows[0].OpenUt);
            Assert.Equal(400.0, wire.Pairs[0].Windows[0].CloseUt);
            Assert.Equal(5_000.0, wire.Pairs[0].Windows[1].OpenUt);
            Assert.Null(wire.Pairs[0].Windows[1].CloseUt);
            Assert.Equal(9_000.0, wire.Pairs[1].HorizonUt);
            Assert.Empty(wire.Pairs[1].Windows);
        }

        [Fact]
        public void ThePlanSerialisesWithItsOpenEndsAsNull()
        {
            var payload = new CommsContacts
            {
                HorizonUt = 2.0,
                Pairs =
                {
                    new CommsContactPair
                    {
                        A = "ground:ksc",
                        B = "vessel:a",
                        HorizonUt = 2.0,
                        Windows = { new CommsContactWindow { OpenUt = null, CloseUt = 1.5 } },
                    },
                },
            };

            var json = Sitrep.Contract.Serialization.EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "comms.contacts",
                Payload = payload,
                Meta = new Meta
                {
                    Source = "s", ValidAt = 0, Seq = 1, DeliveredAt = 0, Vantage = "v",
                    Quality = Quality.OnRails, Active = true, Staleness = Staleness.Fresh, TimelineEpoch = 0,
                },
            });

            Assert.Contains("\"horizonUt\":2", json);
            Assert.Contains("\"a\":\"ground:ksc\"", json);
            Assert.Contains("\"openUt\":null", json);
            Assert.Contains("\"closeUt\":1.5", json);
            Assert.Contains("\"lowConfidence\":false", json);
        }
    }
}
