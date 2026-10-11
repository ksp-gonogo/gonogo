using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    /// <summary>
    /// A report from a craft whose way home runs through a node the link capture
    /// does not hold still comes home, by the end-to-end path the craft has to
    /// its centre, and only while the command's own way out could be sent on.
    /// </summary>
    public class ReportPathHomeTests
    {
        private const string Ksc = "ground:ksc";
        private const string Probe = "vessel:probe";
        private const string Unseen = "vessel:unseen";
        private static readonly LaneKey Lane = new LaneKey(1, Ksc, Probe);

        private sealed class Links : IDeliveryLinks
        {
            private readonly Dictionary<(string, string), double> _direct = new Dictionary<(string, string), double>();

            /// <summary>The path the craft has to its centre, null when it has none; the way out is always open.</summary>
            public double? Path { get; set; }

            public void Direct(string from, string to, double light) => _direct[(from, to)] = light;

            public double? LiveLink(string from, string to) => _direct.TryGetValue((from, to), out var light) ? light : (double?)null;

            public double? LivePath(string from, string to) =>
                string.Equals(from, Probe, StringComparison.Ordinal) && string.Equals(to, Ksc, StringComparison.Ordinal) ? Path : 10.0;
        }

        private sealed class Plan : IDeliveryRoutes
        {
            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false) =>
                string.Equals(from, Ksc, StringComparison.Ordinal)
                    ? new[] { new PlannedHop(to, readyUt, readyUt + 10.0) }
                    : new[] { new PlannedHop(Unseen, readyUt, readyUt + 5.0), new PlannedHop(to, readyUt + 5.0, readyUt + 10.0) };
        }

        private sealed class Beliefs : ISenderPlans
        {
            private readonly Plan _plan = new Plan();

            public bool Reckons => true;

            public IDeliveryRoutes? PlanOf(string centre) => _plan;
        }

        private sealed class Rig
        {
            public readonly Links Links = new Links { Path = 10.0 };
            public readonly List<ReportMessage> Reports = new List<ReportMessage>();
            public readonly List<double> Ran = new List<double>();
            public readonly ManualClock Clock = new ManualClock();
            public readonly DeliveryNetwork Network;

            public Rig()
            {
                Network = new DeliveryNetwork(
                    Clock,
                    Links,
                    new Plan(),
                    (c, ut) =>
                    {
                        Ran.Add(ut);
                        return "done";
                    },
                    Reports.Add,
                    beliefs: new Beliefs());
            }

            public void Tick(double ut)
            {
                Clock.AdvanceTo(ut);
                Network.Tick(ut);
            }
        }

        [Fact]
        public void AReplyWhoseWayHomeRunsThroughANodeTheCaptureLacksComesHomeOnThePathTheCraftHas()
        {
            var rig = new Rig();
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            rig.Tick(10.5);
            Assert.Single(rig.Ran);

            rig.Tick(21.0);

            var reply = Assert.Single(rig.Reports, r => r.Kind == JourneyKind.Reply);
            Assert.Equal("done", reply.Result);
            Assert.Equal(20.0, reply.LandedUt, 6);
        }

        /// <summary>The planned next hop is unlinked and another path exists: the delay is that path's, from the instant the command ran.</summary>
        [Fact]
        public void AReplyOnTheCraftsOwnPathArrivesAfterThatPathsDelay()
        {
            var rig = new Rig();
            rig.Links.Path = 7.0;
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            rig.Tick(10.5);

            rig.Tick(18.0);

            var reply = Assert.Single(rig.Reports, r => r.Kind == JourneyKind.Reply);
            Assert.Equal(17.0, reply.LandedUt, 6);
        }

        /// <summary>While the planned next hop is linked the report follows the plan, whatever the end-to-end path would cost.</summary>
        [Fact]
        public void AReplyKeepsThePlansRouteWhileItsNextHopIsLinked()
        {
            var rig = new Rig();
            rig.Links.Path = 100.0;
            rig.Links.Direct(Probe, Unseen, 3.0);
            rig.Links.Direct(Unseen, Ksc, 4.0);
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            rig.Tick(10.5);

            rig.Tick(30.0);

            var reply = Assert.Single(rig.Reports, r => r.Kind == JourneyKind.Reply);
            Assert.True(reply.LandedUt < 30.0, "it took the long path: " + reply.LandedUt);
        }

        [Fact]
        public void AReplyIsNotSentHomeOnAPathTheCraftDoesNotHave()
        {
            var rig = new Rig();
            rig.Network.SendCommand(Lane, "c", null, "system", null, 0.0, null);
            rig.Tick(10.5);
            Assert.Single(rig.Ran);
            rig.Links.Path = null;

            rig.Tick(30.0);

            Assert.DoesNotContain(rig.Reports, r => r.Kind == JourneyKind.Reply);
            Assert.Contains(rig.Network.HeldMessages(), h => h.Node == Probe && h.Message is ReportMessage);
        }
    }
}
