using System;
using System.Collections.Generic;
using Sitrep.Core.StoreAndForward;
using Xunit;

namespace Sitrep.Core.Tests.StoreAndForward
{
    /// <summary>
    /// A command sent under the id of one already held at the same node is refused
    /// aloud, before it takes a lane number, rather than being dropped while its
    /// number is spent.
    /// </summary>
    public class DuplicateIdTests
    {
        private const string Ksc = "ground:ksc";
        private const string Probe = "vessel:probe";
        private static readonly LaneKey Lane = new LaneKey(1, Ksc, Probe);

        private sealed class NoLinks : IDeliveryLinks
        {
            public double? LiveLink(string from, string to) => null;

            public double? LivePath(string from, string to) => null;
        }

        private sealed class NoPlan : IDeliveryRoutes
        {
            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false) => null;
        }

        [Fact]
        public void ACommandWhoseIdIsAlreadyHeldIsRefusedAndTakesNoLaneNumber()
        {
            var clock = new ManualClock();
            var network = new DeliveryNetwork(clock, new NoLinks(), new NoPlan(), (c, ut) => "done", _ => { });
            var first = network.SendCommand(Lane, "c", null, "system", null, 0.0, null, id: "c1");

            var refused = Assert.Throws<DuplicateMessageIdException>(
                () => network.SendCommand(Lane, "c", null, "system", null, 1.0, null, id: "c1"));
            Assert.Equal("c1", refused.MessageId);

            var next = network.SendCommand(Lane, "c", null, "system", null, 2.0, null, id: "c2");
            Assert.Equal(first.LaneSeq + 1, next.LaneSeq);
        }
    }
}
