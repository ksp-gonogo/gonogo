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

            public double? LivePath(string from, string to) => LiveLink(from, to);
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

            public Rig()
            {
                Network = new DeliveryNetwork(
                    Clock,
                    Links,
                    new Plan(10.0),
                    (c, ut) => { Ran.Add(ut); return "done"; },
                    Reports.Add,
                    beliefs: Beliefs);
                Beliefs.Plans[Ksc] = new Plan(10.0);
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

        /// <summary>A centre goes by its own plan alone, so after a loss nothing but a new plan sends the command again, and the report says so rather than naming a time.</summary>
        [Fact]
        public void ACentreSaysItWaitsForItsPlanToChangeAndNamesNoTime()
        {
            var rig = new Rig();
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);

            rig.RunTo(25.0);

            var lost = Assert.Single(rig.Reports, r => r.Kind == JourneyKind.LostOnLanding);
            Assert.Null(lost.UntilUt);
            Assert.Contains("plan", lost.Detail);
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
