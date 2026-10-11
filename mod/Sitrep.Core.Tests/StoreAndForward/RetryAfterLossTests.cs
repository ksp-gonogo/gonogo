using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    /// <summary>
    /// A hop that lost a copy's light is tried again on a growing wait while the
    /// plan stays the same: a craft that holds still never changes the plan, so
    /// without it a command or a reply caught once stays caught for its lifetime.
    /// </summary>
    public class RetryAfterLossTests
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
            public readonly List<(string Args, double Ut)> Ran = new List<(string, double)>();
            public readonly ManualClock Clock = new ManualClock();
            public readonly DeliveryNetwork Network;

            public Rig()
            {
                Network = new DeliveryNetwork(
                    Clock,
                    Links,
                    new NoPlan(),
                    (c, ut) =>
                    {
                        Ran.Add(((string)c.Args!, ut));
                        return "done";
                    },
                    Reports.Add);
            }

            public void Tick(double ut)
            {
                Clock.AdvanceTo(ut);
                Network.Tick(ut);
            }
        }

        /// <summary>The head's reply was caught on its way home: the command behind it runs and is answered, and the head's reply follows when the hop is tried again.</summary>
        [Fact]
        public void ACommandBehindAReplyThatCouldNotComeHomeIsAnsweredAndTheStuckReplyFollows()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, light: 10.0);
            rig.Network.SendCommand(Lane, "c", "head", "system", null, 0.0, null);
            rig.Tick(10.5);
            rig.Links.Down(Ksc, Probe);
            rig.Tick(21.0);
            rig.Links.Up(Ksc, Probe, light: 10.0);
            rig.Network.SendCommand(Lane, "c", "second", "system", null, 22.0, null);
            rig.Tick(33.0);
            rig.Tick(44.0);
            Assert.Equal(new[] { "head", "second" }, rig.Ran.Select(r => r.Args).ToArray());
            var firstHome = Assert.Single(rig.Reports, r => r.Kind == JourneyKind.Reply);
            Assert.Equal(rig.Ran[1].Ut, firstHome.AtUt);

            rig.Tick(61.0);
            rig.Tick(72.0);

            Assert.Equal(2, rig.Reports.Count(r => r.Kind == JourneyKind.Reply));
        }

        /// <summary>A reply caught on its way home waits at the craft and is sent again, so the centre is not left to its backstop.</summary>
        [Fact]
        public void AReplyProducedWhileTheReturnLinkIsAbsentComesHomeWhenItReturns()
        {
            var rig = new Rig();
            rig.Links.Up(Ksc, Probe, light: 10.0);
            rig.Network.SendCommand(Lane, "c", "a", "system", null, 0.0, null);
            rig.Tick(10.5);
            Assert.Single(rig.Ran);
            rig.Links.Down(Ksc, Probe);
            rig.Tick(25.0);
            Assert.DoesNotContain(rig.Reports, r => r.Kind == JourneyKind.Reply);

            rig.Links.Up(Ksc, Probe, light: 10.0);
            rig.Tick(51.0);
            rig.Tick(62.0);

            var reply = Assert.Single(rig.Reports, r => r.Kind == JourneyKind.Reply);
            Assert.Equal("done", reply.Result);
        }
    }
}
