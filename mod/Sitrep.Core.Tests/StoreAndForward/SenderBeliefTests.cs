using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    /// <summary>
    /// Where command centres plan from what they have heard, a centre sends when
    /// its own plan says the way is open, a relay follows the plan the message
    /// carries and sends on its own link, and nobody reads a link that is not
    /// its own.
    /// </summary>
    public class SenderBeliefTests
    {
        private const string Ksc = "ground:ksc";
        private const string Probe = "vessel:probe";
        private const string Relay = "vessel:relay";
        private static readonly LaneKey Lane = new LaneKey(1, Ksc, Probe);

        private sealed class Links : IDeliveryLinks
        {
            private readonly Dictionary<(string, string), double> _links = new Dictionary<(string, string), double>();

            /// <summary>How many times anything asked for a live path, and between which nodes.</summary>
            public List<(string From, string To)> PathsAsked { get; } = new List<(string, string)>();

            /// <summary>Every direct link anything asked about, by who was holding the message.</summary>
            public List<(string From, string To)> LinksAsked { get; } = new List<(string, string)>();

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

            public double? LiveLink(string from, string to)
            {
                LinksAsked.Add((from, to));
                return _links.TryGetValue((from, to), out var light) ? light : (double?)null;
            }

            public double? LivePath(string from, string to)
            {
                PathsAsked.Add((from, to));
                return _links.TryGetValue((from, to), out var light) ? light : (double?)null;
            }
        }

        /// <summary>A plan the test scripts: the route it predicts between two nodes for a message ready at an instant.</summary>
        private sealed class Plan : IDeliveryRoutes
        {
            private readonly Func<string, string, double, IReadOnlyList<PlannedHop>?> _route;

            public Plan(Func<string, string, double, IReadOnlyList<PlannedHop>?> route) => _route = route;

            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt) => _route(from, to, readyUt);
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
            public readonly List<double> Ran = new List<double>();
            public readonly List<ReportMessage> Reports = new List<ReportMessage>();
            public readonly ManualClock Clock = new ManualClock();
            public readonly DeliveryNetwork Network;

            public Rig()
            {
                Network = new DeliveryNetwork(
                    Clock,
                    Links,
                    new Plan((_, _, _) => throw new InvalidOperationException("a network whose centres plan must never read the one shared plan")),
                    (c, ut) => { Ran.Add(ut); return "done"; },
                    Reports.Add,
                    beliefs: Beliefs);
            }

            public CommandMessage Send(double ut)
            {
                Clock.AdvanceTo(ut);
                return Network.SendCommand(Lane, "c", null, "system", null, ut, null);
            }

            public void Tick(double ut)
            {
                Clock.AdvanceTo(ut);
                Network.Tick(ut);
            }

            public void RunTo(double end)
            {
                for (var ut = Math.Floor(Clock.Now()) + 1.0; ut <= end + 1e-9; ut += 1.0)
                {
                    Tick(ut);
                }
            }
        }

        /// <summary>The centre's plan: straight to the probe, open from <paramref name="opensUt"/>, <paramref name="light"/> seconds away; and the same back.</summary>
        private static Plan Direct(double light, double opensUt = 0.0) => new Plan((from, to, ready) =>
        {
            var depart = Math.Max(ready, opensUt);
            return new[] { new PlannedHop(to, depart, depart + light) };
        });

        [Fact]
        public void ACentreSendsWhenItsOwnPlanSaysTheWayIsOpenWhateverTheLinkIsReallyDoing()
        {
            var rig = new Rig();
            rig.Beliefs.Plans[Ksc] = Direct(light: 10.0);

            rig.Send(0.0);

            Assert.Single(rig.Network.InFlight());
            Assert.Empty(rig.Reports);
            rig.RunTo(19.0);
            Assert.Empty(rig.Ran);
            Assert.Empty(rig.Reports);

            // Twice the light time it believed in, and nothing has come back.
            rig.RunTo(21.0);
            var held = Assert.Single(rig.Reports);
            Assert.Equal(JourneyKind.Held, held.Kind);
            Assert.Equal(Ksc, held.At);
            Assert.Equal(20.0, held.AtUt);
        }

        [Fact]
        public void ACentreHoldsWhileItsPlanSaysTheWayIsShutThoughTheLinkIsReallyUp()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, light: 10.0);
            rig.Beliefs.Plans[Ksc] = Direct(light: 10.0, opensUt: 100.0);

            rig.Send(0.0);

            Assert.Empty(rig.Network.InFlight());
            var held = Assert.Single(rig.Reports);
            Assert.Equal(JourneyKind.Held, held.Kind);
            Assert.Equal(100.0, held.UntilUt);

            rig.RunTo(99.0);
            Assert.Empty(rig.Ran);
            rig.RunTo(111.0);
            Assert.Equal(new[] { 110.0 }, rig.Ran);
        }

        [Fact]
        public void ACentreThatHoldsNoPlanOrHasNotHeardOfTheCraftHolds()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, light: 10.0);

            rig.Send(0.0);
            rig.RunTo(50.0);
            Assert.Empty(rig.Ran);
            Assert.Contains(rig.Network.HeldMessages(), h => h.Node == Ksc && h.Message is CommandMessage);

            rig.Beliefs.Plans[Ksc] = new Plan((_, _, _) => null);
            rig.RunTo(60.0);
            Assert.Empty(rig.Ran);

            rig.Beliefs.Plans[Ksc] = Direct(light: 10.0);
            rig.RunTo(75.0);
            Assert.Equal(new[] { 71.0 }, rig.Ran);
        }

        /// <summary>How long the light takes is physics: the real path sets it, where there is one.</summary>
        [Fact]
        public void ACommandSentOnABeliefThatHoldsIsTimedByTheRealPath()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, light: 8.0);
            rig.Beliefs.Plans[Ksc] = Direct(light: 10.0);

            rig.Send(0.0);
            rig.RunTo(30.0);

            Assert.Equal(new[] { 8.0 }, rig.Ran);
            Assert.DoesNotContain(rig.Reports, r => r.Kind == JourneyKind.Held);
            Assert.Equal(16.0, rig.Reports.Single(r => r.Kind == JourneyKind.Reply).AtUt + 8.0);
        }

        /// <summary>
        /// The link is up when the centre sends and gone when the light lands. The
        /// centre gives up at twice the light time, which is the soonest an answer
        /// could have been back.
        /// </summary>
        [Fact]
        public void ACentreGivesUpOnAnUnansweredCommandAtTwiceTheLightTime()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, light: 8.0);
            rig.Beliefs.Plans[Ksc] = Direct(light: 10.0);

            rig.Send(0.0);
            rig.Tick(1.0);
            rig.Links.Down(Ksc, Probe);
            rig.RunTo(15.0);
            Assert.Empty(rig.Reports);

            rig.RunTo(17.0);
            Assert.Equal(16.0, Assert.Single(rig.Reports, r => r.Kind == JourneyKind.Held).AtUt);
        }

        /// <summary>A cancel's report from the craft comes home behind a relay by the plan the command it named came by.</summary>
        [Fact]
        public void AReportAboutACancelComesHomeByThePlanOfTheCommandItNamed()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Relay, light: 2.0);
            rig.Links.Up(Relay, Probe, light: 3.0);
            rig.Beliefs.Plans[Ksc] = new Plan((from, to, ready) =>
            {
                if (from == Ksc)
                {
                    // A second's wait at the relay, so it goes hop by hop.
                    return new[] { new PlannedHop(Relay, ready, ready + 2.0), new PlannedHop(Probe, ready + 3.0, ready + 6.0) };
                }
                if (from == Relay)
                {
                    return to == Probe ? new[] { new PlannedHop(Probe, ready, ready + 3.0) } : new[] { new PlannedHop(Ksc, ready, ready + 2.0) };
                }
                return new[] { new PlannedHop(Relay, ready, ready + 3.0), new PlannedHop(Ksc, ready + 3.0, ready + 5.0) };
            });

            rig.Send(0.0);
            rig.RunTo(7.0);
            Assert.Single(rig.Ran);
            Assert.NotNull(rig.Network.Cancel(Lane, 1, andBehind: false, nowUt: 7.0));
            rig.RunTo(40.0);

            Assert.Contains(rig.Reports, r => r.Kind == JourneyKind.CancelLate);
        }

        /// <summary>
        /// A centre's own report of a departure says when it expects the command to
        /// arrive, and that is the plan's number: the real path's would tell it at
        /// once whether the far end is there.
        /// </summary>
        [Fact]
        public void ACentresDepartureReportSaysWhatItsPlanExpectsWhateverTheRealPathIs()
        {
            string Departure(bool linked)
            {
                var rig = new Rig();
                if (linked)
                {
                    rig.Links.Up(Ksc, Probe, light: 8.0);
                }
                rig.Beliefs.Plans[Ksc] = Direct(light: 10.0, opensUt: 50.0);
                rig.Send(0.0);
                rig.RunTo(51.0);
                var departed = rig.Reports.Single(r => r.Kind == JourneyKind.Departed);
                return departed.AtUt + ">" + departed.UntilUt;
            }

            Assert.Equal(Departure(linked: false), Departure(linked: true));
            Assert.Equal("50>60", Departure(linked: true));
        }

        /// <summary>
        /// The plan sends it to the relay and has it wait there for a window at
        /// 100. The relay's own link to the probe comes up at 50, and that is what
        /// the relay goes by. The centre's plan changing after the command left
        /// reaches nobody.
        /// </summary>
        [Fact]
        public void ARelayFollowsThePlanTheMessageCarriesAndSendsOnItsOwnLink()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Relay, light: 2.0);
            rig.Beliefs.Plans[Ksc] = new Plan((from, to, ready) =>
            {
                if (from == Ksc && to == Probe)
                {
                    return new[] { new PlannedHop(Relay, ready, ready + 2.0), new PlannedHop(Probe, 100.0, 103.0) };
                }
                if (from == Relay && to == Probe)
                {
                    var depart = Math.Max(ready, 100.0);
                    return new[] { new PlannedHop(Probe, depart, depart + 3.0) };
                }
                if (from == Probe && to == Ksc)
                {
                    return new[] { new PlannedHop(Relay, ready, ready + 3.0), new PlannedHop(Ksc, ready + 3.0, ready + 5.0) };
                }
                return from == Relay && to == Ksc ? new[] { new PlannedHop(Ksc, ready, ready + 2.0) } : null;
            });

            rig.Send(0.0);
            rig.Beliefs.Plans[Ksc] = new Plan((_, _, _) => null);
            rig.RunTo(49.0);
            Assert.Contains(rig.Network.HeldMessages(), h => h.Node == Relay && h.Message is CommandMessage);
            Assert.Empty(rig.Ran);

            rig.Links.Up(Relay, Probe, light: 3.0);
            rig.RunTo(70.0);

            Assert.Equal(new[] { 53.0 }, rig.Ran);
            var reply = rig.Reports.Single(r => r.Kind == JourneyKind.Reply);
            Assert.Equal(53.0, reply.AtUt);
            Assert.Contains(rig.Reports, r => r.Kind == JourneyKind.Held && r.At == Relay);
        }

        /// <summary>A relay reads its own link to the next node and nothing further on.</summary>
        [Fact]
        public void NoNodeReadsALinkThatIsNotItsOwn()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Relay, light: 2.0);
            rig.Links.Up(Relay, Probe, light: 3.0);
            rig.Beliefs.Plans[Ksc] = new Plan((from, to, ready) =>
            {
                if (from == Ksc && to == Probe)
                {
                    return new[] { new PlannedHop(Relay, ready, ready + 2.0), new PlannedHop(Probe, ready + 10.0, ready + 13.0) };
                }
                if (from == Relay && to == Probe)
                {
                    return new[] { new PlannedHop(Probe, ready, ready + 3.0) };
                }
                if (from == Probe && to == Ksc)
                {
                    return new[] { new PlannedHop(Relay, ready, ready + 3.0), new PlannedHop(Ksc, ready + 3.0, ready + 5.0) };
                }
                return from == Relay && to == Ksc ? new[] { new PlannedHop(Ksc, ready, ready + 2.0) } : null;
            });

            rig.Send(0.0);
            rig.RunTo(30.0);

            Assert.Single(rig.Ran);
            Assert.Contains(rig.Reports, r => r.Kind == JourneyKind.Reply);
            Assert.Empty(rig.Links.PathsAsked);
            Assert.All(rig.Links.LinksAsked, asked => Assert.True(
                asked == (Ksc, Relay) || asked == (Relay, Probe) || asked == (Probe, Relay) || asked == (Relay, Ksc),
                "a link was read that its reader is not an end of: " + asked));
        }

        [Fact]
        public void TheReplyComesHomeHopByHopByTheSamePlan()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, light: 10.0);
            rig.Beliefs.Plans[Ksc] = Direct(light: 10.0);

            rig.Send(0.0);
            rig.Beliefs.Plans.Clear();
            rig.RunTo(25.0);

            Assert.Equal(new[] { 10.0 }, rig.Ran);
            Assert.Single(rig.Reports, r => r.Kind == JourneyKind.Reply);
        }

        [Fact]
        public void ACentreAboardTheCraftItCommandsReachesItAtOnce()
        {
            var rig = new Rig();
            var aboard = new LaneKey(1, Probe, Probe);
            rig.Clock.AdvanceTo(5.0);

            rig.Network.SendCommand(aboard, "c", null, "system", null, 5.0, null);
            rig.Tick(5.0);

            Assert.Equal(new[] { 5.0 }, rig.Ran);
        }
    }
}
