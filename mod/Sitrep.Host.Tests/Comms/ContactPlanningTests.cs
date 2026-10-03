using System;
using System.Collections.Generic;
using System.Diagnostics;
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

        private static ContactNodeFingerprint[] Craft(params (string Id, OrbitElements Orbit)[] craft)
        {
            var nodes = new ContactNodeFingerprint[craft.Length];
            for (var i = 0; i < craft.Length; i++)
            {
                nodes[i] = new ContactNodeFingerprint(craft[i].Id, 1, craft[i].Orbit);
            }
            return nodes;
        }

        private static ContactPlanRequest RequestFor(IReadOnlyList<ContactNodeFingerprint> fingerprint, double fromUt) =>
            new ContactPlanRequest(
                new PlanNode[0], new PlanPair[0], new KeplerProvider(), 1, fromUt, ContactPlanSchedule.HorizonSeconds, fingerprint);

        [Fact]
        public void APlanIsDueBeforeAnyHasBeenMade()
        {
            var schedule = new ContactPlanSchedule();

            Assert.True(schedule.Due(Craft(("vessel:a", Orbit(700_000.0))), 0.0));
        }

        [Fact]
        public void APlanIsNotDueWhileNothingHasMoved()
        {
            var schedule = new ContactPlanSchedule();
            var nodes = Craft(("vessel:a", Orbit(700_000.0)));
            schedule.Planned(RequestFor(nodes, 0.0));

            Assert.False(schedule.Due(nodes, 600.0));
        }

        [Fact]
        public void AnOrbitWobblingInsideTheToleranceDoesNotReplan()
        {
            var schedule = new ContactPlanSchedule();
            schedule.Planned(RequestFor(Craft(("vessel:a", Orbit(700_000.0))), 0.0));

            Assert.False(schedule.Due(Craft(("vessel:a", Orbit(700_010.0, 1e-6, 1e-5))), 600.0));
        }

        [Fact]
        public void ABurnReplansOnceTheDriftIntervalHasPassed()
        {
            var schedule = new ContactPlanSchedule();
            schedule.Planned(RequestFor(Craft(("vessel:a", Orbit(700_000.0))), 0.0));
            var burned = Craft(("vessel:a", Orbit(900_000.0)));

            Assert.False(schedule.Due(burned, ContactPlanSchedule.MinDriftReplanSeconds / 2.0));
            Assert.True(schedule.Due(burned, ContactPlanSchedule.MinDriftReplanSeconds));
        }

        [Fact]
        public void ANodeArrivingOrLeavingReplansAtOnce()
        {
            var schedule = new ContactPlanSchedule();
            schedule.Planned(RequestFor(Craft(("vessel:a", Orbit(700_000.0))), 0.0));

            Assert.True(schedule.Due(Craft(("vessel:a", Orbit(700_000.0)), ("vessel:b", Orbit(800_000.0))), 1.0));
            Assert.True(schedule.Due(Craft(("vessel:b", Orbit(700_000.0))), 1.0));
        }

        [Fact]
        public void APlanIsDueAgainHalfwayThroughItsHorizonOrWhenTimeGoesBack()
        {
            var schedule = new ContactPlanSchedule();
            var nodes = Craft(("vessel:a", Orbit(700_000.0)));
            schedule.Planned(RequestFor(nodes, 1000.0));

            Assert.True(schedule.Due(nodes, 1000.0 + (ContactPlanSchedule.HorizonSeconds / 2.0)));
            Assert.True(schedule.Due(nodes, 999.0));
        }

        [Fact]
        public void AForgottenPlanIsDueAgainAtOnce()
        {
            var schedule = new ContactPlanSchedule();
            var nodes = Craft(("vessel:a", Orbit(700_000.0)));
            schedule.Planned(RequestFor(nodes, 0.0));

            schedule.Forget();

            Assert.True(schedule.Due(nodes, 1.0));
        }

        [Fact]
        public void ALandedCraftThatDrivesOffReplansAndOneThatSitsStillDoesNot()
        {
            static RotatingGroundStation At(double longitudeDeg) =>
                RotatingGroundStation.FromLatitudeLongitude(0.0, longitudeDeg, 0.0, 21_549.425, KerbinRadius, 0.0);
            var schedule = new ContactPlanSchedule();
            schedule.Planned(RequestFor(new[] { new ContactNodeFingerprint("vessel:rover", 1, null, At(10.0)) }, 0.0));

            Assert.False(schedule.Due(new[] { new ContactNodeFingerprint("vessel:rover", 1, null, At(10.0)) }, 600.0));
            Assert.True(schedule.Due(new[] { new ContactNodeFingerprint("vessel:rover", 1, null, At(12.0)) }, 600.0));
        }

        [Fact]
        public void TheRunnerHandsBackTheFinishedPlanOnceAndRunsOneAtATime()
        {
            var nodes = new[]
            {
                PlanNode.Orbiting("vessel:a", PropagationTarget.Vessel("vessel:a", 1, Orbit(KerbinRadius + 700_000.0))),
                PlanNode.Orbiting("vessel:b", PropagationTarget.Vessel("vessel:b", 1, Orbit(KerbinRadius + 800_000.0))),
            };
            var pairs = new[] { new PlanPair("vessel:a", "vessel:b", new[] { new OccludingBody(1, KerbinRadius) }, null) };
            var bodies = new[]
            {
                new SystemBody(-1, null),
                new SystemBody(0, new OrbitElements(13_599_840_256.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.1723328e18)),
            };
            var request = new ContactPlanRequest(
                nodes, pairs, new KeplerProvider(bodies), 1, 0.0, 3600.0, new ContactNodeFingerprint[0]);
            var runner = new ContactPlanRunner();

            Assert.True(runner.Offer(request));
            Assert.False(runner.Offer(request));
            ContactPlan? plan = null;
            var clock = Stopwatch.StartNew();
            while (!runner.TryTake(out plan) && clock.Elapsed < TimeSpan.FromSeconds(30))
            {
                Thread.Sleep(5);
            }

            Assert.NotNull(plan);
            Assert.Single(plan!.Pairs);
            Assert.False(runner.TryTake(out _));
        }

        [Fact]
        public void ARunThatThrowsIsReportedAndFreesTheRunner()
        {
            var request = new ContactPlanRequest(
                null!,
                new PlanPair[0],
                new KeplerProvider(),
                1,
                0.0,
                3600.0,
                new ContactNodeFingerprint[0]);
            var runner = new ContactPlanRunner();
            Exception? failure = null;
            using var reported = new ManualResetEventSlim();

            runner.Offer(request, ex =>
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
        }
    }
}
