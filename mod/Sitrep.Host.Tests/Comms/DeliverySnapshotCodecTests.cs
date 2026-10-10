using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
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
            public IReadOnlyList<PlannedHop>? Route(string from, string to, double readyUt, double deadlineUt, bool turnsOnTheWay = false) => null;
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
        public void TheClientRequestIdSurvivesTheSaveOnAHeldCommand()
        {
            var clock = new ManualClock();
            var network = new DeliveryNetwork(clock, new Links(), new NoPlan(), (c, ut) => null, _ => { });
            network.SendCommand(Lane, "stage", null, "system", null, 0.0, null, clientRequestId: "client-3");

            var restored = DeliverySnapshotCodec.Decode(DeliverySnapshotCodec.Encode(network.Snapshot()))!;
            Assert.Equal("client-3", Assert.Single(restored.SentCommands).ClientRequestId);
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
        public void ALivePathCommandSurvivesTheSaveWithWhetherItRanAndWhatItReturned()
        {
            var snapshot = new DeliverySnapshot();
            snapshot.LivePath.Commands.Add(new PendingCommandState
            {
                RequestId = "c3",
                Node = "system",
                Command = "science.run",
                Args = new Dictionary<string, object?> { ["script"] = "boot" },
                Vantage = "ground:ksc",
                ExecuteUt = 5.0,
                ConfirmUt = 10.0,
                Correlation = "client-9",
                Ran = true,
                Result = CommandResult.Ok(),
            });
            snapshot.LivePath.Commands.Add(new PendingCommandState
            {
                RequestId = "c4",
                Node = "system",
                Command = "stage",
                Vantage = "ground:ksc",
                ExecuteUt = 7.0,
                ConfirmUt = 14.0,
            });

            var restored = DeliverySnapshotCodec.Decode(DeliverySnapshotCodec.Encode(snapshot))!.LivePath.Commands;

            Assert.Equal(2, restored.Count);
            var ran = restored[0];
            Assert.Equal("c3", ran.RequestId);
            Assert.Equal("system", ran.Node);
            Assert.Equal("science.run", ran.Command);
            Assert.Equal("boot", ((Dictionary<string, object?>)ran.Args!)["script"]);
            Assert.Equal("ground:ksc", ran.Vantage);
            Assert.Equal(5.0, ran.ExecuteUt);
            Assert.Equal(10.0, ran.ConfirmUt);
            Assert.Equal("client-9", ran.Correlation);
            Assert.True(ran.Ran);
            Assert.Equal(true, ((Dictionary<string, object?>)ran.Result!)["success"]);
            var waiting = restored[1];
            Assert.False(waiting.Ran);
            Assert.Null(waiting.Result);
            Assert.Equal("", waiting.Correlation);
        }

        [Fact]
        public void ARefusalAHandlerReturnedIsSavedAsTheRefusalItStandsFor()
        {
            var snapshot = new DeliverySnapshot();
            snapshot.LivePath.Commands.Add(new PendingCommandState
            {
                RequestId = "c1",
                Command = "stage",
                Ran = true,
                Result = new ChannelEngine.HandlerFault(FaultCode.CommandUnavailable, "it threw"),
            });
            snapshot.LivePath.Commands.Add(new PendingCommandState
            {
                RequestId = "c2",
                Command = "stage",
                Ran = true,
                Result = new object(),
            });

            var restored = DeliverySnapshotCodec.Decode(DeliverySnapshotCodec.Encode(snapshot))!.LivePath.Commands;

            var refused = Assert.IsType<ChannelEngine.HandlerFault>(restored[0].Result);
            Assert.Equal(FaultCode.CommandUnavailable, refused.Code);
            Assert.Equal("it threw", refused.Reason);
            var unwritable = Assert.IsType<ChannelEngine.HandlerFault>(restored[1].Result);
            Assert.Equal(FaultCode.ResultSerializationError, unwritable.Code);
        }

        [Fact]
        public void AReplyOnItsWayHomeKeepsItsResultAcrossTheSave()
        {
            var snapshot = new DeliverySnapshot();
            snapshot.Flights.Add(new FlightRecord
            {
                Message = new ReportMessage
                {
                    Id = "r1",
                    To = "ground:ksc",
                    Kind = JourneyKind.Reply,
                    About = "c1",
                    Lane = Lane,
                    At = "vessel:probe",
                    Result = "done:x",
                    ClientRequestId = "client-4",
                    Command = "stage",
                },
                From = "vessel:probe",
                To = "ground:ksc",
                DepartUt = 1.0,
                ArriveUt = 3.0,
            });

            var restored = DeliverySnapshotCodec.Decode(DeliverySnapshotCodec.Encode(snapshot))!;

            var reply = (ReportMessage)Assert.Single(restored.Flights).Message;
            Assert.Equal("done:x", reply.Result);
            Assert.Equal("client-4", reply.ClientRequestId);
            Assert.Equal("stage", reply.Command);
        }

        [Fact]
        public void ASaveWrittenWithoutTheLivePathRestoresNoneOfIt()
        {
            var json = "{\"version\":1,\"nextId\":0,\"held\":[],\"flights\":[],\"storedCancels\":[],\"senders\":[],\"collectors\":[],\"sentCommands\":[]}";
            var encoded = System.Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(json));

            Assert.Empty(DeliverySnapshotCodec.Decode(encoded)!.LivePath.Commands);
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
