using System.Collections.Generic;
using System.Linq;
using Sitrep.Core;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class DeliverySnapshotCodecTests
    {
        private static readonly LaneKey Lane = new LaneKey(4, "ground:ksc", "vessel:probe");

        private sealed class Links : IDeliveryLinks
        {
            public bool Up { get; set; }

            public double? LivePath(string from, string to) => Up ? 2.0 : (double?)null;

            public double? LiveLink(string from, string to) => Up ? 2.0 : (double?)null;
        }

        private sealed class NoPlan : IDeliveryRoutes
        {
            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt) => null;
        }

        [Fact]
        public void AHeldCommandSurvivesTheSaveAndRunsAfterTheLoad()
        {
            var links = new Links();
            var clock = new ManualClock();
            var network = new DeliveryNetwork(clock, links, new NoPlan(), (c, ut) => null, _ => { });
            network.SendCommand(Lane, "throttle.set", new Dictionary<string, object?> { ["value"] = 0.5 }, "system", null, 0.0, null);
            network.SendCommand(Lane, "stage", null, "system", null, 1.0, null);

            var saved = DeliverySnapshotCodec.Encode(network.Snapshot());
            Assert.DoesNotContain("{", saved);

            var ran = new List<(string Command, object? Args)>();
            var restoredLinks = new Links();
            var restoredClock = new ManualClock(10.0);
            var restored = new DeliveryNetwork(restoredClock, restoredLinks, new NoPlan(), (c, ut) => { ran.Add((c.Command, c.Args)); return null; }, _ => { });
            restored.Restore(DeliverySnapshotCodec.Decode(saved)!, epoch: 9);

            restoredLinks.Up = true;
            restored.Tick(10.0);
            restoredClock.AdvanceTo(20.0);

            Assert.Equal(new[] { "throttle.set", "stage" }, ran.Select(r => r.Command).ToArray());
            Assert.Equal(0.5, ((Dictionary<string, object?>)ran[0].Args!)["value"]);
        }

        [Fact]
        public void CustodyAndTheRouteAMessageCarriesSurviveTheSave()
        {
            var links = new Links { Up = true };
            var clock = new ManualClock();
            var network = new DeliveryNetwork(clock, links, new NoPlan(), (c, ut) => null, _ => { });
            var sent = network.SendCommand(Lane, "stage", null, "system", null, 0.0, null);
            sent.Route.Add(new PlannedHop("vessel:relay", 0.0, 1.5));
            sent.Route.Add(new PlannedHop("vessel:probe", 40.0, 42.0));
            links.Up = false;
            clock.AdvanceTo(3.0);
            network.Tick(3.0);

            var restored = DeliverySnapshotCodec.Decode(DeliverySnapshotCodec.Encode(network.Snapshot()))!;

            var held = Assert.Single(restored.Held);
            Assert.Equal("vessel:probe", held.Away);
            Assert.Equal(4.0, held.CustodyUntilUt);
            Assert.False(held.Landed);
            var route = ((CommandMessage)held.Message).Route;
            Assert.Equal(new[] { "vessel:relay", "vessel:probe" }, route.Select(h => h.To));
            Assert.Equal(40.0, route[1].DepartUt);
            Assert.Equal(42.0, route[1].ArriveUt);
        }

        [Fact]
        public void ASaveWithNothingOrSomethingUnreadableRestoresNothing()
        {
            Assert.Null(DeliverySnapshotCodec.Decode(null));
            Assert.Null(DeliverySnapshotCodec.Decode(""));
            Assert.Null(DeliverySnapshotCodec.Decode("not base64 at all"));
        }
    }
}
