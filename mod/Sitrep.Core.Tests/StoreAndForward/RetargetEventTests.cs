using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    /// <summary>
    /// A node holding a message for a peer it has no link to turns an idle dish
    /// to the peer, sends what it holds, and puts the dish back, and a dish is
    /// never turned with light on its way to it, never when its craft has opted
    /// out, and never again at once after a failure.
    /// </summary>
    public class RetargetEventTests
    {
        private const string Ksc = "ground:ksc";
        private const string Relay = "vessel:relay";
        private const string Other = "vessel:other";
        private const string Probe = "vessel:probe";
        private const string Dish = "vessel:relay#1/0";
        private static readonly LaneKey Lane = new LaneKey(1, Ksc, Probe);

        private sealed class Links : IDeliveryLinks, IReceiveCheck
        {
            public bool PeerReceives { get; set; } = true;

            public bool PeerCanReceive(string from, string to) => PeerReceives;

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

        /// <summary>Turns a dish by raising the link its aim opens, and records what it was asked.</summary>
        private sealed class Actuator : IDishActuator
        {
            private readonly Links _links;
            private int _records;

            public Actuator(Links links) => _links = links;

            public List<string> Log { get; } = new List<string>();

            public bool Refuse { get; set; }

            public string? Turn(string node, string dishId, string peer, double ut)
            {
                if (Refuse)
                {
                    Log.Add("refused@" + ut);
                    return null;
                }
                Log.Add("turn@" + ut + ":" + dishId + ">" + peer);
                _links.Up(node, peer, 5.0);
                return "r" + (++_records) + "|" + node + "|" + peer;
            }

            public bool Restore(string recordId, double ut)
            {
                Log.Add("restore@" + ut);
                var parts = recordId.Split('|');
                _links.Down(parts[1], parts[2]);
                return true;
            }
        }

        private sealed class Rig
        {
            public readonly Links Links = new Links();
            public readonly Beliefs Beliefs = new Beliefs();
            public readonly Actuator Actuator;
            public readonly List<double> Ran = new List<double>();
            public readonly List<ReportMessage> Reports = new List<ReportMessage>();
            public readonly ManualClock Clock = new ManualClock();
            public readonly DeliveryNetwork Network;
            public readonly RetargetOptions Options = new RetargetOptions { LinkUpSeconds = 2.0, SendSeconds = 10.0, AwayCapSeconds = 60.0, CooldownSeconds = 30.0 };
            public bool Allowed = true;

            public Rig()
            {
                Actuator = new Actuator(Links);
                Network = new DeliveryNetwork(
                    Clock,
                    Links,
                    new Plan((_, _, _) => throw new InvalidOperationException("centres plan here")),
                    (c, ut) => { Ran.Add(ut); return "done"; },
                    Reports.Add,
                    beliefs: Beliefs);
                Network.SetRetargeting(Actuator, Options, _ => Allowed);
                Links.Up(Ksc, Relay, 10.0);
                Beliefs.Plans[Ksc] = Through(Relay, arrivalDishAfter: double.PositiveInfinity);
            }

            /// <summary>The centre's plan: to the relay, then a turned dish to the probe; and the relay's own plan from there.</summary>
            public Plan Through(string relay, double arrivalDishAfter) => new Plan((from, to, ready) =>
            {
                if (from == relay && to == Probe)
                {
                    return new[] { new PlannedHop(Probe, ready + Options.LinkUpSeconds, ready + Options.LinkUpSeconds + 5.0, Dish, null, Dish, ready) };
                }
                if (from == Ksc && to == Probe)
                {
                    var toDish = ready >= arrivalDishAfter ? Dish : null;
                    var turn = ready + 10.0;
                    return new[]
                    {
                        new PlannedHop(relay, ready, ready + 10.0, null, toDish),
                        new PlannedHop(Probe, turn + Options.LinkUpSeconds, turn + Options.LinkUpSeconds + 5.0, Dish, null, Dish, turn),
                    };
                }
                return null;
            });

            public CommandMessage Send(double ut)
            {
                Clock.AdvanceTo(ut);
                return Network.SendCommand(Lane, "c", null, "system", null, ut, null);
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
        public void ANodeHoldingAMessageForAPeerItCannotSeeTurnsAnIdleDishSendsAndPutsItBack()
        {
            var rig = new Rig();

            rig.Send(0.0);
            rig.RunTo(40.0);

            Assert.Equal(1, rig.Ran.Count);
            Assert.Equal(new[] { "turn@10:" + Dish + ">" + Probe, "restore@" + rig.Actuator.Log.Last().Substring("restore@".Length) }, rig.Actuator.Log);
            var restoredAt = double.Parse(rig.Actuator.Log.Last().Substring("restore@".Length));
            Assert.InRange(restoredAt, 12.0, 14.0);
            Assert.Empty(rig.Network.ActiveRetargets());
            var event1 = Assert.Single(rig.Network.RetargetHistory());
            Assert.Equal(RetargetPhase.Restored, event1.Phase);
            Assert.Equal(Relay, event1.Node);
            Assert.Equal(Probe, event1.Peer);
            Assert.Equal(10.0, event1.TurnedUt);
        }

        [Fact]
        public void TheJourneyReportOfTheDepartureSaysTheDishWasTurned()
        {
            var rig = new Rig();

            rig.Send(0.0);
            rig.RunTo(40.0);

            var departed = rig.Reports.Where(r => r.Kind == JourneyKind.Departed && r.At == Relay).ToList();
            Assert.Contains(departed, r => r.Detail != null && r.Detail.Contains("turned dish " + Dish + " to " + Probe));
        }

        [Fact]
        public void ADishIsNotTurnedWithLightOnItsWayToIt()
        {
            var rig = new Rig();
            rig.Beliefs.Plans[Ksc] = rig.Through(Relay, arrivalDishAfter: 5.0);

            rig.Send(0.0);
            rig.Send(5.0);
            rig.RunTo(12.0);

            Assert.DoesNotContain(rig.Actuator.Log, l => l.StartsWith("turn@"));
            Assert.Empty(rig.Network.ActiveRetargets());
            Assert.Empty(rig.Ran);
        }

        [Fact]
        public void ACraftThatOptedOutHasItsBorrowedDishPutBackAtOnce()
        {
            var rig = new Rig();
            rig.Send(0.0);
            rig.RunTo(11.0);
            Assert.Single(rig.Network.ActiveRetargets());

            rig.Allowed = false;
            rig.Network.AutoRetargetChanged(Relay, 11.5);

            Assert.Equal("restore@11.5", rig.Actuator.Log.Last());
            Assert.Empty(rig.Network.ActiveRetargets());
        }

        [Fact]
        public void ACraftThatMayNotTurnADishNeverStartsAnEvent()
        {
            var rig = new Rig();
            rig.Allowed = false;

            rig.Send(0.0);
            rig.RunTo(40.0);

            Assert.Empty(rig.Actuator.Log);
            Assert.Empty(rig.Ran);
        }

        [Fact]
        public void TheOperatorAimingTheBorrowedDishEndsTheEventWithNoRestore()
        {
            var rig = new Rig();
            rig.Send(0.0);
            rig.RunTo(11.0);
            Assert.Single(rig.Network.ActiveRetargets());

            rig.Network.OperatorAimed(Dish, 11.5);

            Assert.DoesNotContain(rig.Actuator.Log, l => l.StartsWith("restore@"));
            Assert.Empty(rig.Network.ActiveRetargets());
            Assert.Equal(RetargetPhase.Ended, Assert.Single(rig.Network.RetargetHistory()).Phase);
        }

        [Fact]
        public void AFailedTurnIsNotTriedAgainUntilThePlanChanges()
        {
            var rig = new Rig();
            rig.Actuator.Refuse = true;

            rig.Send(0.0);
            rig.RunTo(60.0);
            Assert.Equal(1, rig.Actuator.Log.Count(l => l.StartsWith("refused@")));
            Assert.Empty(rig.Ran);

            rig.Actuator.Refuse = false;
            rig.Network.PlanChanged();
            rig.RunTo(130.0);

            Assert.Equal(1, rig.Actuator.Log.Count(l => l.StartsWith("turn@")));
            Assert.Equal(1, rig.Ran.Count);
        }

        [Fact]
        public void ADishThatJustFinishedRestsBeforeItIsTurnedAgain()
        {
            var rig = new Rig();
            rig.Send(0.0);
            rig.RunTo(30.0);
            Assert.Equal(1, rig.Ran.Count);
            var turnsBefore = rig.Actuator.Log.Count(l => l.StartsWith("turn@"));

            rig.Links.Down(Relay, Probe);
            rig.Send(30.0);
            rig.RunTo(41.0);
            Assert.Equal(turnsBefore, rig.Actuator.Log.Count(l => l.StartsWith("turn@")));

            rig.RunTo(110.0);
            Assert.Equal(turnsBefore + 1, rig.Actuator.Log.Count(l => l.StartsWith("turn@")));
        }

        [Fact]
        public void APeerThatHasHeardAnAnnouncementBooksNoArrivalOnTheDishInsideItsWindow()
        {
            var rig = new Rig();
            rig.Links.Up(Other, Relay, 3.0);
            // The other craft's plan sends a command for the probe through the relay, landing on its dish.
            rig.Beliefs.Plans[Other] = new Plan((from, to, ready) =>
                from == Other && to == Probe
                    ? new[] { new PlannedHop(Relay, ready, ready + 3.0, null, Dish), new PlannedHop(Probe, ready + 3.0, ready + 8.0) }
                    : null);
            rig.Send(0.0);
            rig.RunTo(11.0);
            var window = Assert.Single(rig.Network.ActiveRetargets());

            // Heard at 10 + 3: a message that would land inside [10, back) waits for the window to end.
            var otherLane = new LaneKey(1, Other, Probe);
            rig.Clock.AdvanceTo(14.0);
            rig.Network.SendCommand(otherLane, "d", null, "system", null, 14.0, null);
            Assert.Empty(rig.Network.InFlight().Where(f => f.From == Other));

            rig.RunTo(window.BackUt + 1.0);
            Assert.Contains(rig.Network.InFlight(), f => f.From == Other);
        }

        [Fact]
        public void LightSentOnATurnedDishIsJudgedOnTheReceiverAfterTheDishIsBack()
        {
            var rig = new Rig();
            rig.Links.PeerReceives = false;

            rig.Send(0.0);
            rig.RunTo(40.0);

            Assert.Equal(RetargetPhase.Restored, Assert.Single(rig.Network.RetargetHistory()).Phase);
            Assert.Empty(rig.Ran);
        }

        [Fact]
        public void TwoRelaysTurnTheirOwnDishesAtOnceAndBothRestore()
        {
            const string Relay2 = "vessel:relay2";
            const string Probe2 = "vessel:probe2";
            const string Dish2 = "vessel:relay2#1/0";
            var rig = new Rig();
            rig.Links.Up(Ksc, Relay2, 10.0);
            var first = rig.Through(Relay, double.PositiveInfinity);
            rig.Beliefs.Plans[Ksc] = new Plan((from, to, ready) =>
            {
                if (to == Probe2)
                {
                    if (from == Relay2)
                    {
                        return new[] { new PlannedHop(Probe2, ready + 2.0, ready + 7.0, Dish2, null, Dish2, ready) };
                    }
                    return new[]
                    {
                        new PlannedHop(Relay2, ready, ready + 10.0),
                        new PlannedHop(Probe2, ready + 12.0, ready + 17.0, Dish2, null, Dish2, ready + 10.0),
                    };
                }
                return first.Route(from, to, ready, double.PositiveInfinity);
            });

            rig.Send(0.0);
            rig.Clock.AdvanceTo(0.0);
            rig.Network.SendCommand(new LaneKey(1, Ksc, Probe2), "c", null, "system", null, 0.0, null);
            rig.RunTo(11.0);

            Assert.Equal(2, rig.Network.ActiveRetargets().Count);
            rig.RunTo(60.0);
            Assert.Empty(rig.Network.ActiveRetargets());
            Assert.Equal(2, rig.Actuator.Log.Count(l => l.StartsWith("restore@")));
            Assert.Equal(2, rig.Ran.Count);
        }

        [Fact]
        public void AHeldEventSurvivesASaveAndALoadAndRestoresWhenItsTimeIsUp()
        {
            var rig = new Rig();
            rig.Send(0.0);
            rig.RunTo(11.0);
            var saved = rig.Network.Snapshot();
            Assert.Equal(RetargetPhase.Turned, Assert.Single(saved.Retargets.Events).Phase);

            var restored = new Rig();
            restored.Clock.AdvanceTo(11.0);
            restored.Links.Up(Relay, Probe, 5.0);
            restored.Network.Restore(saved, epoch: 2);
            restored.RunTo(80.0);

            Assert.Contains(restored.Actuator.Log, l => l.StartsWith("restore@"));
            Assert.Empty(restored.Network.ActiveRetargets());
        }
    }
}
