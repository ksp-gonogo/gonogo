using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    public class DeliveryNetworkTests
    {
        private const string Ksc = "ground:ksc";
        private const string Probe = "vessel:probe";
        private const string Relay = "vessel:relay";
        private static readonly LaneKey Lane = new LaneKey(1, Ksc, Probe);

        /// <summary>Links the test switches on and off; a live path is a live link between the two ends or through one relay.</summary>
        private sealed class Links : IDeliveryLinks
        {
            private readonly Dictionary<(string, string), double> _links = new Dictionary<(string, string), double>();

            public void Up(string a, string b, double light = 1.0)
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

            public double? LivePath(string from, string to)
            {
                var direct = LiveLink(from, to);
                if (direct != null)
                {
                    return direct;
                }
                foreach (var (a, b) in _links.Keys.Where(k => k.Item1 == from))
                {
                    var onward = LiveLink(b, to);
                    if (onward != null)
                    {
                        return _links[(a, b)] + onward;
                    }
                }
                return null;
            }
        }

        /// <summary>A plan the test scripts: from a node, the route it returns.</summary>
        private sealed class Routes : IDeliveryRoutes
        {
            public Func<string, string, double, IReadOnlyList<PlannedHop>?> Plan { get; set; } = (_, _, _) => null;

            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false) => Plan(from, to, readyUt);
        }

        private sealed class Rig
        {
            public readonly Links Links = new Links();
            public readonly Routes Routes = new Routes();
            public readonly List<(long Seq, double Ut)> Ran = new List<(long, double)>();
            public readonly List<ReportMessage> Reports = new List<ReportMessage>();
            public readonly ManualClock Clock = new ManualClock();
            public readonly DeliveryNetwork Network;

            public Rig(ControlValueRelease release = ControlValueRelease.RunEvery)
            {
                Network = new DeliveryNetwork(Clock, Links, Routes, (c, ut) => { Ran.Add((c.LaneSeq, ut)); return "done"; }, Reports.Add, release);
            }

            public CommandMessage Send(double ut, string? channel = null)
            {
                Advance(ut);
                return Network.SendCommand(Lane, "c", null, "system", channel, ut, null);
            }

            /// <summary>Moves the clock to <paramref name="ut"/>, landing every light due on the way, then ticks the network there.</summary>
            public void Tick(double ut)
            {
                Advance(ut);
                Network.Tick(ut);
            }

            private void Advance(double ut)
            {
                if (ut > Clock.Now())
                {
                    Clock.AdvanceTo(ut);
                }
                _now = Math.Max(_now, ut);
            }

            private double _now;

            /// <summary>Ticks once a second from where the last run stopped up to <paramref name="end"/>.</summary>
            public void RunTo(double end)
            {
                for (var ut = Math.Floor(_now) + 1.0; ut <= end + 1e-9; ut += 1.0)
                {
                    Tick(ut);
                }
                _now = Math.Max(_now, end);
            }

            public void At(double ut) => _now = Math.Max(_now, ut);

            public IEnumerable<JourneyKind> Kinds(long seq) => Reports.Where(r => r.LaneSeq == seq).Select(r => r.Kind);
        }

        [Fact]
        public void OnALivePathACommandArrivesOneLightTimeLaterAndItsReplyComesBack()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, light: 5.0);

            rig.Send(0.0);
            rig.RunTo(20.0);

            Assert.Equal((1L, 5.0), rig.Ran.Single());
            var reply = rig.Reports.Single(r => r.Kind == JourneyKind.Reply);
            Assert.Equal("done", reply.Result);
            Assert.DoesNotContain(rig.Reports, r => r.Kind == JourneyKind.Held);
        }

        [Fact]
        public void WithNoPathTheCommandIsHeldAtTheSenderAndLeavesWhenAPathOpens()
        {
            var rig = new Rig();

            rig.Send(0.0);
            rig.RunTo(10.0);
            Assert.Empty(rig.Ran);
            Assert.Contains(JourneyKind.Held, rig.Kinds(1));

            rig.Links.Up(Ksc, Probe, light: 2.0);
            rig.RunTo(20.0);

            Assert.Equal(1L, rig.Ran.Single().Seq);
            Assert.Contains(JourneyKind.Departed, rig.Kinds(1));
        }

        [Fact]
        public void ARelayInContactNowHoldsTheCommandUntilItsWindowToTheCraftOpens()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Relay, light: 1.0);
            rig.Routes.Plan = (from, to, ut) => from == Ksc
                ? new[] { new PlannedHop(Relay, ut, ut + 1.0), new PlannedHop(Probe, 50.0, 51.0) }
                : from == Relay ? new[] { new PlannedHop(Probe, Math.Max(ut, 50.0), Math.Max(ut, 50.0) + 1.0) } : null;

            rig.Send(0.0);
            rig.RunTo(40.0);
            Assert.Empty(rig.Ran);
            Assert.Contains(rig.Network.HeldMessages(), h => h.Node == Relay && h.Message is CommandMessage);

            rig.Links.Up(Relay, Probe, light: 1.0);
            rig.RunTo(60.0);

            Assert.Equal(1L, rig.Ran.Single().Seq);
            Assert.Contains(rig.Reports, r => r.Kind == JourneyKind.Held && r.At == Relay);
            Assert.Contains(rig.Reports, r => r.Kind == JourneyKind.Departed && r.At == Relay);
        }

        [Fact]
        public void AHopCaughtByABreakLeavesTheCommandWithItsSenderWhichWaitsTwoLightTimesBeforeTryingAgain()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, light: 10.0);

            rig.Send(0.0);
            rig.Tick(1.0);
            rig.Links.Down(Ksc, Probe);
            rig.Tick(11.0);
            Assert.Empty(rig.Ran);
            Assert.Contains(rig.Network.InCustody(), h => h.Node == Ksc && h.UntilUt == 20.0);

            rig.Links.Up(Ksc, Probe, light: 10.0);
            rig.Tick(15.0);
            Assert.Empty(rig.Network.InFlight());
            rig.Tick(20.5);
            Assert.Contains(rig.Network.HeldMessages(), h => h.Node == Ksc);
            Assert.Empty(rig.Network.InFlight());

            rig.Network.PlanChanged();
            rig.Tick(21.5);
            Assert.Single(rig.Network.InFlight());
            rig.Tick(32.0);
            Assert.Equal(1L, rig.Ran.Single().Seq);
        }

        [Fact]
        public void ACommandHeldPastItsHourIsDeletedAndReportedExpired()
        {
            var rig = new Rig();

            rig.Send(0.0);
            rig.Tick(DeliveryNetwork.CommandLifetimeSeconds + 1.0);

            Assert.Contains(JourneyKind.Expired, rig.Kinds(1));
            Assert.DoesNotContain(rig.Network.HeldMessages(), h => h.Message is CommandMessage);
        }

        [Fact]
        public void ACancelStopsACommandStillAtTheSenderAtOnceAndSendsNothing()
        {
            var rig = new Rig();
            rig.Send(0.0);
            rig.Send(1.0);

            var cancel = rig.Network.Cancel(Lane, 1, andBehind: true, 2.0);

            Assert.NotNull(cancel);
            Assert.Equal(2, rig.Reports.Count(r => r.Kind == JourneyKind.Cancelled && r.At == Ksc));
            Assert.Empty(rig.Network.HeldMessages());
            rig.Links.Up(Ksc, Probe);
            rig.RunTo(10.0);
            Assert.Empty(rig.Ran);
        }

        [Fact]
        public void ACancelOvertakingACommandHeldAtARelayIsStoredAtTheCraftAndTheCommandIsRefusedWhenItArrives()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Relay, light: 1.0);
            rig.Routes.Plan = (from, to, ut) => from == Ksc
                ? new[] { new PlannedHop(Relay, ut, ut + 1.0), new PlannedHop(Probe, 100.0, 101.0) }
                : from == Relay ? new[] { new PlannedHop(Probe, Math.Max(ut, 100.0), Math.Max(ut, 100.0) + 1.0) } : null;
            rig.Send(0.0);
            rig.RunTo(5.0);

            // A new direct contact opens: the plan changes, so the cancel can overtake.
            rig.Links.Up(Ksc, Probe, light: 3.0);
            rig.Tick(6.0);
            rig.Network.Cancel(Lane, 1, andBehind: false, 6.0);
            rig.RunTo(20.0);

            Assert.Contains(rig.Reports, r => r.Kind == JourneyKind.CancelStored);
            rig.Links.Up(Relay, Probe);
            rig.RunTo(200.0);
            Assert.Empty(rig.Ran);
        }

        [Fact]
        public void SendingANumberAgainRunsWhicheverCopyArrivesFirstAndDiscardsTheOther()
        {
            var rig = new Rig();
            var first = rig.Send(0.0);
            rig.Links.Up(Ksc, Probe, light: 1.0);

            rig.Tick(0.5);
            var again = rig.Network.SendAgain(Lane, first.LaneSeq, 0.5);
            rig.RunTo(10.0);

            Assert.NotNull(again);
            Assert.Equal(2, again!.Attempt);
            Assert.Single(rig.Ran);
            Assert.Contains(rig.Reports, r => r.Kind == JourneyKind.Discarded && r.Detail == "a copy already ran");
        }

        [Fact]
        public void ASnapshotRestoredIntoANewTimelineCarriesOnWhereItLeftOff()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Relay, light: 1.0);
            rig.Routes.Plan = (from, to, ut) => from == Relay
                ? new[] { new PlannedHop(Probe, Math.Max(ut, 50.0), Math.Max(ut, 50.0) + 1.0) }
                : new[] { new PlannedHop(Relay, ut, ut + 1.0), new PlannedHop(Probe, 50.0, 51.0) };
            rig.Send(0.0);
            rig.RunTo(10.0);
            var saved = rig.Network.Snapshot();

            var restored = new Rig();
            restored.Routes.Plan = rig.Routes.Plan;
            restored.Links.Up(Relay, Probe);
            restored.Network.Restore(saved, epoch: 2);
            restored.RunTo(60.0);

            var ran = Assert.Single(restored.Ran);
            Assert.Equal(1L, ran.Seq);
        }

        [Fact]
        public void ACancelAfterARestoreStillChasesACommandThatHadLeftTheSender()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Relay, light: 1.0);
            rig.Routes.Plan = (from, to, ut) => from == Relay
                ? new[] { new PlannedHop(Probe, Math.Max(ut, 50.0), Math.Max(ut, 50.0) + 1.0) }
                : new[] { new PlannedHop(Relay, ut, ut + 1.0), new PlannedHop(Probe, 50.0, 51.0) };
            rig.Send(0.0);
            rig.RunTo(10.0);
            var saved = rig.Network.Snapshot();

            var restored = new Rig();
            restored.Routes.Plan = rig.Routes.Plan;
            restored.Links.Up(Ksc, Relay, light: 1.0);
            restored.Network.Restore(saved, epoch: 2);
            restored.RunTo(10.0);

            var cancel = restored.Network.Cancel(new LaneKey(2, Lane.Vantage, Lane.Craft), 1, andBehind: false, 10.0);
            restored.RunTo(20.0);
            restored.Links.Up(Relay, Probe);
            restored.RunTo(60.0);

            Assert.NotNull(cancel);
            Assert.Empty(restored.Ran);
        }

        /// <summary>
        /// A command's handler can wait on another thread, as production waits on
        /// the main thread, and that thread must be able to use the network
        /// meanwhile: commands run outside the network's lock.
        /// </summary>
        [Fact]
        public void AHandlerWaitingOnAnotherThreadThatUsesTheNetworkDoesNotDeadlock()
        {
            var clock = new ManualClock();
            var links = new Links();
            links.Up(Ksc, Probe, 1.0);
            DeliveryNetwork? network = null;
            var ran = false;
            network = new DeliveryNetwork(clock, links, new Routes(), (c, ut) =>
            {
                var other = System.Threading.Tasks.Task.Run(() => network!.HeldMessages().Count);
                Assert.True(other.Wait(System.TimeSpan.FromSeconds(10)), "the other thread could not take the network's lock");
                ran = true;
                return null;
            }, _ => { });

            network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            clock.AdvanceTo(2.0);

            Assert.True(ran);
        }

        /// <summary>
        /// Random sends, link flaps, plan changes and cancels: whatever happens,
        /// each lane runs its numbers in strictly increasing order and never runs
        /// one twice.
        /// </summary>
        [Fact]
        public void NothingEverRunsOutOfOrderOrTwice()
        {
            for (var seed = 0; seed < 200; seed++)
            {
                var random = new Random(seed);
                var rig = new Rig();
                rig.Routes.Plan = (from, to, ut) => random.NextDouble() < 0.5
                    ? new[] { new PlannedHop(Relay, ut, ut + 1.0), new PlannedHop(Probe, ut + random.Next(1, 40), ut + 41.0) }
                    : new[] { new PlannedHop(Probe, ut + random.Next(0, 20), ut + 21.0) };
                for (var ut = 0.0; ut < 600.0; ut += 1.0)
                {
                    RandomStep(rig, random, ut);
                    rig.Tick(ut);
                }
                var order = rig.Ran.Select(r => r.Seq).ToList();
                for (var i = 1; i < order.Count; i++)
                {
                    Assert.True(order[i] > order[i - 1], "seed " + seed + " ran " + string.Join(",", order));
                }
            }
        }

        /// <summary>One random event for the ordering property: a send, a link up or down, a plan change, a cancel, or nothing.</summary>
        private static void RandomStep(Rig rig, Random random, double ut)
        {
            var roll = random.NextDouble();
            if (roll < 0.08)
            {
                rig.Send(ut);
                return;
            }
            if (roll < 0.14)
            {
                rig.Links.Up(Ksc, Probe, random.Next(1, 15));
                return;
            }
            if (roll < 0.20)
            {
                rig.Links.Down(Ksc, Probe);
                return;
            }
            if (roll < 0.25)
            {
                rig.Links.Up(Ksc, Relay, random.Next(1, 10));
                return;
            }
            if (roll < 0.30)
            {
                rig.Links.Up(Relay, Probe, random.Next(1, 10));
                return;
            }
            if (roll < 0.35)
            {
                rig.Links.Down(Relay, Probe);
                return;
            }
            if (roll < 0.37)
            {
                rig.Network.PlanChanged();
                return;
            }
            if (roll < 0.39)
            {
                rig.Tick(ut);
                rig.Network.Cancel(Lane, random.Next(1, 10), random.NextDouble() < 0.5, ut);
            }
        }
    }
}
