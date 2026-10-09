using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    /// <summary>The edges of store-and-forward a review found after it landed, each with the case that shows it.</summary>
    public class LeftoverTests
    {
        private const string Ksc = "ground:ksc";
        private const string Probe = "vessel:probe";
        private const string One = "vessel:one";
        private const string Two = "vessel:two";
        private static readonly LaneKey Lane = new LaneKey(1, Ksc, Probe);

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

            /// <summary>Only a direct link is a live path here, so every relayed command goes hop by hop on the plan.</summary>
            public double? LivePath(string from, string to) => LiveLink(from, to);
        }

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

            public Rig()
            {
                Network = new DeliveryNetwork(Clock, Links, Routes, (c, ut) => { Ran.Add((c.LaneSeq, ut)); return "done"; }, Reports.Add);
            }

            public void Tick(double ut)
            {
                if (ut > Clock.Now())
                {
                    Clock.AdvanceTo(ut);
                }
                Network.Tick(ut);
            }

            public void RunTo(double from, double end)
            {
                for (var ut = from; ut <= end + 1e-9; ut += 1.0)
                {
                    Tick(ut);
                }
            }
        }

        private static PlannedHop[] Hop(string to, double departUt, double light = 1.0) => new[] { new PlannedHop(to, departUt, departUt + light) };

        /// <summary>
        /// The plan changes while the command is at the second relay and sends it
        /// back through the first. The first relay had already seen it and used
        /// to drop it without a word, while the second, told its light had
        /// landed, let its own copy go: the command was gone and nobody knew.
        /// </summary>
        [Fact]
        public void AMessageRoutedBackToANodeThatHasSeenItIsHeldThereAgainNotDropped()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, One);
            rig.Links.Up(One, Two);
            var changed = false;
            rig.Routes.Plan = (from, _, ready) =>
            {
                if (from == Ksc)
                {
                    return Hop(One, ready);
                }
                if (from == Two)
                {
                    changed = true;
                    return Hop(One, ready);
                }
                return changed ? Hop(Probe, ready) : Hop(Two, ready);
            };

            rig.Clock.AdvanceTo(0.0);
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            rig.RunTo(1.0, 6.0);
            Assert.Empty(rig.Ran);

            rig.Links.Up(One, Probe);
            rig.RunTo(7.0, 20.0);

            Assert.Equal(1L, Assert.Single(rig.Ran).Seq);
        }

        /// <summary>
        /// The window to the craft is open for six tenths of a second, between
        /// two ticks a second apart, as any window is under high warp. The
        /// command leaves when the window opens, not at the next tick, by which
        /// time it has shut.
        /// </summary>
        [Fact]
        public void AWindowShorterThanATickIsNotMissed()
        {
            var rig = new Rig();
            rig.Routes.Plan = (from, _, ready) => from == Ksc ? Hop(Probe, Math.Max(ready, ready <= 100.8 ? 100.2 : 5000.0), 0.1) : null;
            rig.Clock.AdvanceTo(0.0);
            rig.Clock.Schedule(100.2, () => rig.Links.Up(Ksc, Probe, 0.1));
            rig.Clock.Schedule(100.8, () => rig.Links.Down(Ksc, Probe));

            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            rig.RunTo(1.0, 105.0);

            var ran = Assert.Single(rig.Ran);
            Assert.Equal(100.3, ran.Ut, 6);
        }

        /// <summary>
        /// A command that ran and was answered is finished. An hour after it
        /// could last have run, nothing can still need it, and it is no longer
        /// kept or written into every save.
        /// </summary>
        [Fact]
        public void ASettledCommandIsForgottenOnceNothingCanStillNeedIt()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, 5.0);
            rig.Clock.AdvanceTo(0.0);
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            rig.RunTo(1.0, 20.0);
            Assert.Single(rig.Ran);
            Assert.Single(rig.Network.Snapshot().SentCommands);

            rig.Tick(DeliveryNetwork.CommandLifetimeSeconds + 10.0);
            Assert.Single(rig.Network.Snapshot().SentCommands);

            rig.Tick((2.0 * DeliveryNetwork.CommandLifetimeSeconds) + 10.0);
            Assert.Empty(rig.Network.Snapshot().SentCommands);
        }

        /// <summary>
        /// The first copy is stuck at a relay and expires there. A copy sent
        /// again went straight to the craft and ran, and its reply is slow coming
        /// home. The news of the first copy's expiry arrives first. It does not
        /// finish the command: the report says another copy is still out, and the
        /// reply that follows is the command's real end.
        /// </summary>
        [Fact]
        public void OneCopyExpiringDoesNotFinishACommandWhoseOtherCopyMayStillRun()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, One);
            rig.Routes.Plan = (from, _, ready) => from == Ksc ? Hop(One, ready) : from == One ? Hop(Probe, Math.Max(ready, 5000.0)) : null;
            rig.Clock.AdvanceTo(0.0);
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            rig.RunTo(1.0, 9.0);
            Assert.Equal(One, rig.Network.HeldMessages().Single(m => m.Message is CommandMessage).Node);

            // A direct path opens for a few seconds: the second copy takes it, and its reply is caught on the way back.
            rig.Links.Down(Ksc, One);
            rig.Links.Up(Ksc, Probe, 2.0);
            rig.Clock.Schedule(13.0, () => rig.Links.Down(Ksc, Probe));
            rig.Tick(10.0);
            Assert.NotNull(rig.Network.SendAgain(Lane, 1, 10.0));
            rig.RunTo(11.0, 20.0);
            Assert.Equal(12.0, Assert.Single(rig.Ran).Ut, 6);
            Assert.DoesNotContain(rig.Reports, r => r.Kind == JourneyKind.Reply);

            // The first copy expires at the relay, and the relay's link home returns.
            rig.Links.Up(Ksc, One);
            rig.Tick(DeliveryNetwork.CommandLifetimeSeconds + 1.0);
            rig.Tick(DeliveryNetwork.CommandLifetimeSeconds + 3.0);
            var expired = rig.Reports.Single(r => r.Kind == JourneyKind.Expired);
            Assert.True(expired.OtherCopiesOut, "one copy expiring was reported as the end of a command another copy had run");

            rig.Links.Up(Ksc, Probe, 2.0);
            rig.Network.PlanChanged();
            rig.Tick(DeliveryNetwork.CommandLifetimeSeconds + 10.0);
            rig.Tick(DeliveryNetwork.CommandLifetimeSeconds + 13.0);
            Assert.Equal("done", rig.Reports.Single(r => r.Kind == JourneyKind.Reply).Result);
        }

        [Fact]
        public void TheOnlyCopyExpiringIsTheEndOfTheCommand()
        {
            var rig = new Rig();
            rig.Clock.AdvanceTo(0.0);
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);

            rig.Tick(DeliveryNetwork.CommandLifetimeSeconds + 1.0);

            Assert.False(rig.Reports.Single(r => r.Kind == JourneyKind.Expired).OtherCopiesOut);
        }

        [Fact]
        public void ACommandStillWaitingSomewhereIsNotForgotten()
        {
            var rig = new Rig();
            rig.Clock.AdvanceTo(0.0);
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);

            rig.Tick(DeliveryNetwork.CommandLifetimeSeconds - 10.0);

            Assert.Single(rig.Network.Snapshot().SentCommands);
            Assert.Single(rig.Network.HeldMessages());
        }
    }
}
