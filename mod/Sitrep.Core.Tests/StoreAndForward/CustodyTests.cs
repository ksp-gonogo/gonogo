using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    /// <summary>
    /// A node that has sent a command keeps its copy until twice the hop's light
    /// time has passed, which is the soonest it could know the hop failed. Until
    /// then nothing it shows or answers may depend on whether the hop landed.
    /// </summary>
    public class CustodyTests
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

        private sealed class NoPlan : IDeliveryRoutes
        {
            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false) => null;
        }

        private sealed class Rig
        {
            public readonly Links Links = new Links();
            public readonly List<ReportMessage> Reports = new List<ReportMessage>();
            public readonly List<double> Ran = new List<double>();
            public readonly ManualClock Clock = new ManualClock();
            public readonly DeliveryNetwork Network;

            public Rig()
            {
                Network = new DeliveryNetwork(Clock, Links, new NoPlan(), (c, ut) => { Ran.Add(ut); return "done"; }, Reports.Add);
            }

            public void Tick(double ut)
            {
                Clock.AdvanceTo(ut);
                Network.Tick(ut);
            }

            /// <summary>What the command centre has been told by <paramref name="ut"/>, in order.</summary>
            public string Told() => string.Join(",", Reports.Select(r => r.Kind + "@" + r.At));
        }

        /// <summary>Sends at 0 over a ten-second link: the light lands at 10, and custody ends at 20.</summary>
        private static Rig Sent(bool hopLands)
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, light: 10.0);
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            if (!hopLands)
            {
                rig.Links.Down(Ksc, Probe);
            }
            return rig;
        }

        /// <summary>
        /// The hop was caught at 10, so the copy is the sender's again, but the
        /// sender cannot know that before 20. A cancel pressed at 12 that stopped
        /// it and said so would tell the operator the hop had failed eight seconds
        /// early.
        /// </summary>
        [Fact]
        public void ACancelPressedBeforeCustodyEndsStopsNothingItCouldNotKnowItStillHas()
        {
            var rig = Sent(hopLands: false);
            rig.Tick(12.0);

            var cancel = rig.Network.Cancel(Lane, 1, andBehind: false, nowUt: 12.0);

            Assert.NotNull(cancel);
            Assert.DoesNotContain(rig.Reports, r => r.Kind == JourneyKind.Cancelled);
            rig.Tick(19.0);
            Assert.DoesNotContain(rig.Reports, r => r.Kind == JourneyKind.Cancelled);

            rig.Tick(20.5);
            var cancelled = Assert.Single(rig.Reports, r => r.Kind == JourneyKind.Cancelled);
            Assert.Equal(Ksc, cancelled.At);
            Assert.Equal(20.0, cancelled.AtUt);
            Assert.Empty(rig.Ran);
        }

        /// <summary>Whether or not the hop landed, the centre has been told the same things, and nothing, until custody ends.</summary>
        [Fact]
        public void UntilCustodyEndsACancelLooksTheSameWhetherOrNotTheHopLanded()
        {
            var landed = Sent(hopLands: true);
            var caught = Sent(hopLands: false);
            foreach (var rig in new[] { landed, caught })
            {
                rig.Tick(12.0);
                Assert.NotNull(rig.Network.Cancel(Lane, 1, andBehind: false, nowUt: 12.0));
                rig.Tick(19.9);
            }

            Assert.Equal(landed.Told(), caught.Told());
            Assert.Equal("", caught.Told());
        }

        [Fact]
        public void ACopyInCustodyIsNotSentAgainAndIsLetGoOnceTheHopIsKnownToHaveLanded()
        {
            var rig = Sent(hopLands: true);

            rig.Tick(5.0);
            Assert.Equal(20.0, Assert.Single(rig.Network.InCustody()).UntilUt);
            Assert.Single(rig.Network.InFlight());

            rig.Tick(15.0);
            Assert.Single(rig.Network.InCustody(), c => c.Node == Ksc && c.Message is CommandMessage);
            Assert.Equal(new[] { 10.0 }, rig.Ran);

            rig.Tick(20.5);
            Assert.DoesNotContain(rig.Network.InCustody(), c => c.Node == Ksc);
            Assert.Empty(rig.Network.HeldMessages().Where(h => h.Message is CommandMessage));
            Assert.Equal(new[] { 10.0 }, rig.Ran);
        }

        [Fact]
        public void ACaughtCopyIsReportedHeldOnlyWhenCustodyEnds()
        {
            var rig = Sent(hopLands: false);

            rig.Tick(19.0);
            Assert.Empty(rig.Reports);

            rig.Tick(20.5);
            var held = Assert.Single(rig.Reports);
            Assert.Equal(JourneyKind.Held, held.Kind);
            Assert.Equal(Ksc, held.At);
            Assert.Equal(20.0, held.AtUt);
        }

        [Fact]
        public void CustodyIsSavedWithTheGameAndEndsWhenItWouldHave()
        {
            var rig = Sent(hopLands: false);
            rig.Tick(12.0);
            var saved = rig.Network.Snapshot();
            Assert.Empty(saved.Flights);
            var record = Assert.Single(saved.Held);
            Assert.Equal(Probe, record.Away);
            Assert.Equal(20.0, record.CustodyUntilUt);
            Assert.False(record.Landed);

            var restored = new Rig();
            restored.Clock.AdvanceTo(12.0);
            restored.Network.Restore(saved, epoch: 2);
            restored.Tick(19.0);
            Assert.Empty(restored.Reports);
            Assert.Single(restored.Network.InCustody());

            restored.Tick(20.5);
            Assert.Equal(JourneyKind.Held, Assert.Single(restored.Reports).Kind);
        }

        /// <summary>
        /// A copy that was caught is not sent to the node that caught it again
        /// until its plan changes, and a save and a load do not forget that.
        /// </summary>
        [Fact]
        public void ACaughtCopyStaysHeldAcrossASaveAndALoadUntilThePlanChanges()
        {
            var rig = Sent(hopLands: false);
            rig.Tick(20.5);
            rig.Links.Up(Ksc, Probe, light: 10.0);
            rig.Tick(21.0);
            Assert.Single(rig.Network.HeldMessages().Where(h => h.Message is CommandMessage));
            var saved = rig.Network.Snapshot();
            Assert.Equal(new[] { Probe }, Assert.Single(saved.Held).Excluded);

            var restored = new Rig();
            restored.Links.Up(Ksc, Probe, light: 10.0);
            restored.Clock.AdvanceTo(21.0);
            restored.Network.Restore(saved, epoch: 2);
            restored.Tick(22.0);
            restored.Tick(40.0);
            Assert.Single(restored.Network.HeldMessages().Where(h => h.Message is CommandMessage));
            Assert.Empty(restored.Ran);

            restored.Network.PlanChanged();
            restored.Tick(41.0);
            restored.Tick(60.0);
            Assert.Equal(1, restored.Ran.Count);
        }
    }
}
