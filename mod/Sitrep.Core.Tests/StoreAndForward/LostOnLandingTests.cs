using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    /// <summary>
    /// A copy whose light was caught on its way, because the live link was gone when
    /// it landed, is reported to the centre that sent it, with when the next
    /// attempt is due, so a command is never left sent on and then silent until its
    /// expiry.
    /// </summary>
    public class LostOnLandingTests
    {
        private const string Ksc = "ground:ksc";
        private const string Probe = "vessel:probe";
        private static readonly LaneKey Lane = new LaneKey(1, Ksc, Probe);

        private sealed class Links : IDeliveryLinks
        {
            private readonly Dictionary<(string, string), double> _links = new Dictionary<(string, string), double>();

            public void Up(string a, string b, double light)
            {
                _links[(a, b)] = light;
                _links[(b, a)] = light;
            }

            public void Down(string a, string b)
            {
                _links.Remove((a, b));
                _links.Remove((b, a));
            }

            public double? LiveLink(string from, string to) => _links.TryGetValue((from, to), out var light) ? light : (double?)null;

            /// <summary>Whether the path a landing is judged by reads down whatever the link reads.</summary>
            public bool PathDown { get; set; }

            public double? LivePath(string from, string to) => PathDown ? null : LiveLink(from, to);
        }

        private sealed class Plan : IDeliveryRoutes
        {
            private readonly double _light;

            public Plan(double light) => _light = light;

            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false) =>
                new[] { new PlannedHop(to, readyUt, readyUt + _light) };
        }

        private sealed class Beliefs : ISenderPlans
        {
            public Dictionary<string, IDeliveryRoutes> Plans { get; } = new Dictionary<string, IDeliveryRoutes>();

            public bool Reckons => true;

            public IDeliveryRoutes? PlanOf(string centre) => Plans.TryGetValue(centre, out var plan) ? plan : null;
        }

        private sealed class Rig
        {
            public readonly Links Links = new Links();
            public readonly Beliefs Beliefs = new Beliefs();
            public readonly List<ReportMessage> Reports = new List<ReportMessage>();
            public readonly List<double> Ran = new List<double>();
            public readonly ManualClock Clock = new ManualClock();
            public readonly DeliveryNetwork Network;

            public Rig(double planLight = 10.0)
            {
                Network = new DeliveryNetwork(
                    Clock,
                    Links,
                    new Plan(planLight),
                    (c, ut) => { Ran.Add(ut); return "done"; },
                    Reports.Add,
                    beliefs: Beliefs);
                Beliefs.Plans[Ksc] = new Plan(planLight);
            }

            public void RunTo(double end)
            {
                for (var ut = Math.Floor(Clock.Now()) + 1.0; ut <= end + 1e-9; ut += 1.0)
                {
                    Clock.AdvanceTo(ut);
                    Network.Tick(ut);
                }
            }
        }

        [Fact]
        public void ACopyCaughtOnLandingIsReportedHomeWithItsAttemptAndWhereItWasSent()
        {
            var rig = new Rig();
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);

            rig.RunTo(25.0);

            var lost = Assert.Single(rig.Reports, r => r.Kind == JourneyKind.LostOnLanding);
            Assert.Equal(Ksc, lost.At);
            Assert.Equal(20.0, lost.AtUt);
            Assert.Contains("1", lost.Detail);
            Assert.Contains(Probe, lost.Detail);
        }

        [Fact]
        public void ACopyThatLandsIsNeverReportedLost()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, light: 10.0);
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);

            rig.RunTo(45.0);

            Assert.Single(rig.Ran);
            Assert.DoesNotContain(rig.Reports, r => r.Kind == JourneyKind.LostOnLanding);
        }

        [Fact]
        public void ACentreNamesWhenItWillSendTheCopyAgain()
        {
            var rig = new Rig();
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);

            rig.RunTo(25.0);

            var lost = Assert.Single(rig.Reports, r => r.Kind == JourneyKind.LostOnLanding);
            Assert.NotNull(lost.UntilUt);
            Assert.True(lost.UntilUt!.Value > lost.AtUt);
            Assert.Contains("plan", lost.Detail);
        }

        [Fact]
        public void ACentreSendsALostCommandAgainOnAWaitThatDoublesUpToTheCap()
        {
            var rig = new Rig(planLight: 3e-5);
            rig.Links.PathDown = true;
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);

            rig.RunTo(3600.0);

            Assert.Empty(rig.Ran);
            var lost = rig.Reports.Where(r => r.Kind == JourneyKind.LostOnLanding).ToList();
            for (var i = 0; i < lost.Count - 1; i++)
            {
                var waited = lost[i].UntilUt!.Value - lost[i].AtUt;
                Assert.Equal(Math.Min(Math.Pow(2.0, i), 300.0), waited, 2);
                Assert.Equal(lost[i].UntilUt!.Value, lost[i + 1].AtUt, 2);
            }
            Assert.InRange(lost.Count, 15, 25);
        }

        /// <summary>
        /// A pad craft whose telemetry reaches the centre every two seconds while
        /// the path a command is judged by on landing reads down: each copy is lost
        /// the moment it lands, and hearing the craft again and again is no reason
        /// to keep sending.
        /// </summary>
        [Fact]
        public void ACentreThatHearsTheCraftAllAlongDoesNotSendALostCommandEachTimeItHearsIt()
        {
            var rig = new Rig(planLight: 3e-5);
            rig.Links.PathDown = true;
            rig.Links.Up(Ksc, Probe, light: 3e-5);
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);

            for (var ut = 1.0; ut <= 3600.0; ut += 1.0)
            {
                rig.Clock.AdvanceTo(ut);
                if (ut % 2.0 == 0.0)
                {
                    rig.Network.Heard(Ksc, Probe);
                }
                rig.Network.Tick(ut);
            }

            Assert.Empty(rig.Ran);
            var lost = rig.Reports.Where(r => r.Kind == JourneyKind.LostOnLanding).ToList();
            Assert.InRange(lost.Count, 3, 30);
            Assert.InRange(lost.Count(r => r.AtUt > 600.0), 1, 11);
        }

        /// <summary>A craft the centre had stopped hearing is heard again: the lost command goes at once rather than at the end of its wait.</summary>
        [Fact]
        public void HearingTheCraftAfterASilenceAsLongAsTheWaitSendsTheLostCommandAgain()
        {
            var rig = new Rig(planLight: 3e-5);
            rig.Links.PathDown = true;
            rig.Network.Heard(Ksc, Probe);
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            rig.RunTo(200.0);
            var last = rig.Reports.Last(r => r.Kind == JourneyKind.LostOnLanding);
            Assert.True(last.UntilUt!.Value > 210.0);
            var lostBefore = rig.Reports.Count(r => r.Kind == JourneyKind.LostOnLanding);

            rig.Network.Heard(Ksc, Probe);
            rig.RunTo(202.0);

            Assert.Equal(lostBefore + 1, rig.Reports.Count(r => r.Kind == JourneyKind.LostOnLanding));
            Assert.Contains(rig.Reports, r => r.Kind == JourneyKind.Departed && r.AtUt > 200.0);
        }

        [Fact]
        public void EachCopySentAgainAfterALossIsOneJourneyEvent()
        {
            var rig = new Rig(planLight: 3e-5);
            rig.Links.PathDown = true;
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);

            rig.RunTo(600.0);

            var firstLoss = rig.Reports.First(r => r.Kind == JourneyKind.LostOnLanding).AtUt;
            var after = rig.Reports.Where(r => r.AtUt > firstLoss + 1e-9).ToList();
            Assert.NotEmpty(after);
            Assert.All(after, r => Assert.True(r.Kind == JourneyKind.LostOnLanding || r.Kind == JourneyKind.Held, "a retry reported " + r.Kind));
            Assert.True(after.Count(r => r.Kind == JourneyKind.Held) <= 1);
        }

        [Fact]
        public void APlanChangeSendsALostCopyAgainWithoutWaitingOutTheInterval()
        {
            var rig = new Rig(planLight: 3e-5);
            rig.Links.PathDown = true;
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            rig.RunTo(600.0);
            var lostBefore = rig.Reports.Count(r => r.Kind == JourneyKind.LostOnLanding);
            var waitEnds = rig.Reports.Last(r => r.Kind == JourneyKind.LostOnLanding).UntilUt!.Value;
            Assert.True(waitEnds > 602.0);

            rig.Network.PlanChanged();
            rig.RunTo(602.0);

            Assert.Equal(lostBefore + 1, rig.Reports.Count(r => r.Kind == JourneyKind.LostOnLanding));
        }

        /// <summary>A relay that lost a copy tries again on a wait that grows to a cap, and the report names when.</summary>
        [Fact]
        public void ARelayNamesWhenItWillTryTheHopAgainAndTheWaitIsCapped()
        {
            var clock = new ManualClock();
            var links = new Links();
            var reports = new List<ReportMessage>();
            var network = new DeliveryNetwork(
                clock,
                links,
                new ViaRelay(),
                (c, ut) => "done",
                reports.Add);
            links.Up(Ksc, "vessel:relay", light: 2.0);
            network.SendCommand(Lane, "c", null, "system", null, 0.0, null);

            // The relay's link to the craft is up for the instant a copy leaves and gone when it lands.
            for (var ut = 1.0; ut <= 3000.0; ut += 1.0)
            {
                clock.AdvanceTo(ut);
                links.Up("vessel:relay", Probe, light: 5.0);
                network.Tick(ut);
                links.Down("vessel:relay", Probe);
            }

            var lost = reports.Where(r => r.Kind == JourneyKind.LostOnLanding && r.At == "vessel:relay").ToList();
            Assert.True(lost.Count >= 3);
            Assert.All(lost, r => Assert.NotNull(r.UntilUt));
            Assert.All(lost, r => Assert.InRange(r.UntilUt!.Value - r.AtUt, 1.0, 300.0));
            Assert.True(lost[1].UntilUt!.Value - lost[1].AtUt > lost[0].UntilUt!.Value - lost[0].AtUt);
        }

        private sealed class ViaRelay : IDeliveryRoutes
        {
            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false) =>
                from == Ksc
                    ? new[] { new PlannedHop("vessel:relay", readyUt, readyUt + 2.0), new PlannedHop(Probe, readyUt + 2.0, readyUt + 7.0) }
                    : new[] { new PlannedHop(Probe, readyUt, readyUt + 5.0) };
        }
    }
}
