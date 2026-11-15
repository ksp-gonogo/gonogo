using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Core;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// A message whose way on is a dish turn that brings no link up waits for
    /// the next look at the game, and does no work for the game time a warp
    /// skips. The plan gives such a hop a departure one link-up time after
    /// whenever it is asked, so a message that woke itself for that departure
    /// would wake again every link-up time for as long as the craft stayed in
    /// sight, with a route search each time.
    /// </summary>
    public class DishTurnWaitTests
    {
        private const string Home = "ground:home";
        private const string Craft = "vessel:chaser";
        private const string Relay = "vessel:relay";
        private const string CraftDish = Craft + "#1/0";
        private const string RelayDish = Relay + "#1/0";
        private const double Horizon = 1_000_000.0;
        private const double Step = 10_000.0;
        private const double DarkAt = 2800.0;

        /// <summary>A stretch of game time that one tick skips under high warp.</summary>
        private const double Skipped = 5000.0;

        private sealed class Links : IDeliveryLinks
        {
            public HashSet<(string, string)> Up { get; } = new HashSet<(string, string)>();

            public double? LiveLink(string from, string to) => Up.Contains((from, to)) || Up.Contains((to, from)) ? 0.001 : (double?)null;

            public double? LivePath(string from, string to) => LiveLink(from, to);
        }

        private sealed class CountedRoutes : IDeliveryRoutes
        {
            private readonly IDeliveryRoutes _inner;

            public CountedRoutes(IDeliveryRoutes inner) => _inner = inner;

            public int Searches { get; private set; }

            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false)
            {
                Searches++;
                return _inner.Route(from, to, readyUt, deadlineUt, turnsOnTheWay);
            }
        }

        private sealed class Beliefs : ISenderPlans
        {
            public IDeliveryRoutes? Plan { get; set; }

            public bool Reckons => true;

            public IDeliveryRoutes? PlanOf(string centre) => Plan;
        }

        /// <summary>Turns a dish and brings no link up, as within one tick, where the game's links are read once.</summary>
        private sealed class Actuator : IDishActuator
        {
            public int Turns { get; private set; }

            public int Restores { get; private set; }

            public string? Turn(string node, string dishId, string peer, double ut) => "record-" + (++Turns);

            public bool Restore(string recordId, double ut)
            {
                Restores++;
                return true;
            }
        }

        private sealed class Rig
        {
            public readonly ManualClock Clock = new ManualClock();
            public readonly Links Links = new Links();
            public readonly Beliefs Beliefs = new Beliefs();
            public readonly Actuator Actuator = new Actuator();
            public readonly CountedRoutes Routes;
            public readonly DeliveryNetwork Network;

            /// <summary>
            /// The relay always reaches home. The craft and the relay have no dish
            /// on each other, and either could turn one to the other at any time.
            /// </summary>
            public Rig()
            {
                var plan = new ContactPlan(0.0, Horizon, Step, new List<PairPlan>
                {
                    new PairPlan(Relay, Home, Horizon, new[] { new ContactWindow(0.0, null) }, 0.0, Step, Flat(300_000.0)),
                    new PairPlan(Craft, Relay, Horizon, new ContactWindow[0], 0.0, Step, Flat(3000.0), new[]
                    {
                        new RetargetWindow(Craft, CraftDish, Relay, 0.0, Horizon),
                        new RetargetWindow(Relay, RelayDish, Craft, 0.0, Horizon),
                    }),
                }, 0, 0);
                Routes = new CountedRoutes(new PlanRoutes(plan, 1.0, null, null, new RetargetRouting(2.0, 10.0)));
                Beliefs.Plan = Routes;
                Network = new DeliveryNetwork(
                    Clock, Links, new PlanRoutes(null), (command, ut) => "done", _ => { }, beliefs: Beliefs, deliverSpan: (span, ut) => { });
                Network.SetRetargeting(Actuator, new RetargetOptions());
                Links.Up.Add((Relay, Home));
                Clock.AdvanceTo(DarkAt);
            }

            private static double[] Flat(double meters) => Enumerable.Repeat(meters, (int)(Horizon / Step) + 1).ToArray();

            public void TickAt(double ut)
            {
                Clock.AdvanceTo(ut);
                Network.Tick(ut);
            }
        }

        [Fact]
        public void TelemetryHeldForADishNothingTurnsCostsOneLookForTheGameTimeATickSkips()
        {
            var rig = new Rig();
            for (var topic = 0; topic < 40; topic++)
            {
                rig.Network.AddSpan(Craft, new SpanMessage
                {
                    Craft = Craft, Centre = Home, Topic = "topic-" + topic, Samples = { new SpanSample(DarkAt, new SpanPayload()) },
                });
            }
            rig.TickAt(DarkAt + 1.0);
            var before = rig.Routes.Searches;

            rig.TickAt(DarkAt + 1.0 + Skipped);

            // One search for the tick's own look, however long the skip.
            Assert.InRange(rig.Routes.Searches - before, 1, 2);
            Assert.Equal(40, rig.Network.HeldMessages().Count);
            Assert.Equal(0, rig.Actuator.Turns);
        }

        [Fact]
        public void ACommandHeldForADishThatBringsNoLinkUpTurnsItOnceForTheGameTimeATickSkips()
        {
            var rig = new Rig();
            rig.Links.Up.Add((Home, Relay));
            rig.Network.SendCommand(new LaneKey(1, Home, Craft), "c", null, "system", null, DarkAt, null);
            // The command is at the relay, which has turned its dish to the craft and found no link.
            rig.TickAt(DarkAt + 1.0);
            Assert.Contains(rig.Network.HeldMessages(), held => held.Node == Relay);
            var searches = rig.Routes.Searches;
            var turns = rig.Actuator.Turns;

            rig.TickAt(DarkAt + 1.0 + Skipped);

            Assert.InRange(rig.Actuator.Turns - turns, 0, 1);
            Assert.InRange(rig.Actuator.Restores, 1, 2);
            Assert.InRange(rig.Routes.Searches - searches, 1, 12);
        }

        /// <summary>
        /// The turn still does its job at the pace the game is looked at: with a
        /// look every second, a turn whose link comes up carries the command on.
        /// </summary>
        [Fact]
        public void ADishTurnThatBringsTheLinkUpStillCarriesTheCommandOn()
        {
            var rig = new Rig();
            rig.Links.Up.Add((Home, Relay));
            var ran = 0;
            var network = new DeliveryNetwork(
                rig.Clock, rig.Links, new PlanRoutes(null), (command, ut) => { ran++; return "done"; }, _ => { }, beliefs: rig.Beliefs);
            network.SetRetargeting(new LinkingActuator(rig.Links), new RetargetOptions());

            network.SendCommand(new LaneKey(1, Home, Craft), "c", null, "system", null, DarkAt, null);
            for (var ut = DarkAt + 1.0; ut <= DarkAt + 30.0; ut += 1.0)
            {
                rig.Clock.AdvanceTo(ut);
                network.Tick(ut);
            }

            Assert.Equal(1, ran);
        }

        /// <summary>
        /// A dish turn, a restore and a command's run can each wait on the game's
        /// main thread, and saving the game takes the network's lock on that
        /// thread, so none of them happens with the lock held.
        /// </summary>
        [Fact]
        public void TheLockIsFreeWhileADishTurnsOrGoesBackAndWhileACommandRuns()
        {
            var rig = new Rig();
            rig.Links.Up.Add((Home, Relay));
            DeliveryNetwork? network = null;
            var checkedAt = new List<string>();
            void SaveFromAnotherThread(string during)
            {
                var saved = System.Threading.Tasks.Task.Run(() => network!.Snapshot());
                Assert.True(saved.Wait(TimeSpan.FromSeconds(5)), "a save could not take the lock during " + during);
                checkedAt.Add(during);
            }
            network = new DeliveryNetwork(
                rig.Clock, rig.Links, new PlanRoutes(null),
                (command, ut) =>
                {
                    SaveFromAnotherThread("run");
                    return "done";
                },
                _ => { }, beliefs: rig.Beliefs);
            network.SetRetargeting(new LinkingActuator(rig.Links) { During = SaveFromAnotherThread }, new RetargetOptions());

            network.SendCommand(new LaneKey(1, Home, Craft), "c", null, "system", null, DarkAt, null);
            for (var ut = DarkAt + 1.0; ut <= DarkAt + 200.0; ut += 1.0)
            {
                rig.Clock.AdvanceTo(ut);
                network.Tick(ut);
            }

            Assert.Contains("turn", checkedAt);
            Assert.Contains("restore", checkedAt);
            Assert.Contains("run", checkedAt);
        }

        private sealed class LinkingActuator : IDishActuator
        {
            private readonly Links _links;

            public LinkingActuator(Links links) => _links = links;

            public Action<string>? During { get; set; }

            public string? Turn(string node, string dishId, string peer, double ut)
            {
                During?.Invoke("turn");
                _links.Up.Add((node, peer));
                return "record";
            }

            public bool Restore(string recordId, double ut)
            {
                During?.Invoke("restore");
                return true;
            }
        }
    }
}
