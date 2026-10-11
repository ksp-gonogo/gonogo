using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Sitrep.Host.CommandCentres;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Commands sent together as a group travel as one message on one lane
    /// number: held, forwarded, cancelled, sent again and saved as a whole, run
    /// in order at the craft, and answered one result per member.
    /// </summary>
    public class CommandGroupTests
    {
        private const string Centre = "vessel:F";
        private const string CraftId = "G";
        private const string CraftNode = "vessel:G";
        private const double OneWaySeconds = 4.0;
        private static readonly System.TimeSpan Op = TestBudgets.Op;

        private sealed class Member
        {
            public object? Result;
            public FaultCode? Refused;
            public string? RefusedWith;
            public int Accepted;
        }

        private static ChannelEngine.GroupMemberDispatch Send(string command, object? args, string id, Member into) =>
            new ChannelEngine.GroupMemberDispatch
            {
                Command = command,
                Args = args,
                ClientRequestId = id,
                Label = id,
                OnResult = r => into.Result = r,
                OnRefused = (code, why) =>
                {
                    into.Refused = code;
                    into.RefusedWith = why;
                },
                OnAccepted = _ => into.Accepted++,
                OnAcceptedHeld = (_, _, _, _) => into.Accepted++,
            };

        [Fact]
        public void AGroupIsOneLaneEntryThatRunsWholeInOrderOnceTheRouteOpens()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new GroupTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);

                var ag1 = new Member();
                var ag2 = new Member();
                var ag3 = new Member();
                engine.DispatchGroupAndWait(
                    Centre,
                    new[]
                    {
                        Send(GroupTestUplink.SetGroup, Args("Custom01", true), "m1", ag1),
                        Send(GroupTestUplink.SetGroup, Args("Custom02", true), "m2", ag2),
                        Send(GroupTestUplink.SetGroup, Args("Custom03", false), "m3", ag3),
                    },
                    Op);
                Tick(engine, 10.0);

                var entry = Assert.Single(Pending(engine));
                Assert.Equal(1, entry.LaneSeq);
                Assert.Equal(new[] { "m1", "m2", "m3" }, entry.Members);
                Assert.Equal("m1", entry.ClientRequestId);
                Assert.Equal("m1 + m2 + m3", entry.Label);
                Assert.Equal(1, ag1.Accepted);
                Assert.Equal(1, ag2.Accepted);
                Assert.Equal(1, ag3.Accepted);
                Assert.Empty(uplink.Ran);

                OpenRoute(engine);
                Tick(engine, 11.0);
                Tick(engine, 11.0 + OneWaySeconds + 1.0);

                Assert.Equal(new[] { "Custom01:True", "Custom02:True", "Custom03:False" }, uplink.Ran);

                Tick(engine, 11.0 + 2 * OneWaySeconds + 2.0);
                Assert.Equal("done:Custom01", ag1.Result);
                Assert.Equal("done:Custom02", ag2.Result);
                Assert.Equal("done:Custom03", ag3.Result);
                Assert.Empty(Pending(engine));
                Assert.Single(Journey(engine).Events, e => e.Kind == JourneyEventKind.Held);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AGroupTakesOneLaneNumberAndTheNextCommandTakesTheNext()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new GroupTestUplink());
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);

                engine.DispatchGroupAndWait(
                    Centre,
                    new[]
                    {
                        Send(GroupTestUplink.SetGroup, Args("Custom01", true), "m1", new Member()),
                        Send(GroupTestUplink.SetGroup, Args("Custom02", true), "m2", new Member()),
                    },
                    Op);
                engine.DispatchCommandAndWait(GroupTestUplink.SetGroup, Args("Custom03", true), Centre, _ => { }, Op, clientRequestId: "solo");
                Tick(engine, 1.0);

                var lanes = Pending(engine).Select(p => p.LaneSeq).OrderBy(n => n).ToList();
                Assert.Equal(new long?[] { 1, 2 }, lanes);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AMemberThatCannotBeSentRefusesTheWholeGroupAndNumbersNothing()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new GroupTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                OpenRoute(engine);
                Tick(engine, 0.0);

                var first = new Member();
                var unknown = new Member();
                var last = new Member();
                engine.DispatchGroupAndWait(
                    Centre,
                    new[]
                    {
                        Send(GroupTestUplink.SetGroup, Args("Custom01", true), "m1", first),
                        Send("group.nothing", Args("Custom02", true), "m2", unknown),
                        Send(GroupTestUplink.SetGroup, Args("Custom03", true), "m3", last),
                    },
                    Op);

                Assert.Equal(FaultCode.GroupRefused, first.Refused);
                Assert.Equal(FaultCode.CommandUnavailable, unknown.Refused);
                Assert.Equal(FaultCode.GroupRefused, last.Refused);
                Assert.Contains("group.nothing", first.RefusedWith);
                Assert.Empty(Pending(engine));

                Tick(engine, 1.0);
                Tick(engine, 20.0);
                Assert.Empty(uplink.Ran);

                engine.DispatchCommandAndWait(GroupTestUplink.SetGroup, Args("Custom04", true), Centre, _ => { }, Op, clientRequestId: "after");
                Tick(engine, 21.0);
                Assert.Equal(1, Assert.Single(Pending(engine)).LaneSeq);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AGroupOfCommandsForDifferentCraftIsRefused()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new GroupTestUplink());
            engine.Start();
            try
            {
                OpenRoute(engine);
                Tick(engine, 0.0);

                var a = new Member();
                var b = new Member();
                engine.DispatchGroupAndWait(
                    Centre,
                    new[]
                    {
                        Send(GroupTestUplink.SetGroup, Args("Custom01", true), "m1", a),
                        Send(GroupTestUplink.OtherCraft, "x", "m2", b),
                    },
                    Op);

                Assert.Equal(FaultCode.GroupRefused, a.Refused);
                Assert.Equal(FaultCode.InvalidEnvelope, b.Refused);
                Assert.Empty(Pending(engine));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AnInstantCommandCannotBeInAGroup()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new GroupTestUplink());
            engine.Start();
            try
            {
                OpenRoute(engine);
                Tick(engine, 0.0);

                var a = new Member();
                var b = new Member();
                engine.DispatchGroupAndWait(
                    Centre,
                    new[]
                    {
                        Send(GroupTestUplink.SetGroup, Args("Custom01", true), "m1", a),
                        Send(GroupTestUplink.Instant, "x", "m2", b),
                    },
                    Op);

                Assert.Equal(FaultCode.GroupRefused, a.Refused);
                Assert.Equal(FaultCode.InvalidEnvelope, b.Refused);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACancelStopsTheWholeGroupAndEveryMemberIsToldSo()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new GroupTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);

                var members = new[] { new Member(), new Member(), new Member() };
                engine.DispatchGroupAndWait(
                    Centre,
                    new[]
                    {
                        Send(GroupTestUplink.SetGroup, Args("Custom01", true), "m1", members[0]),
                        Send(GroupTestUplink.SetGroup, Args("Custom02", true), "m2", members[1]),
                        Send(GroupTestUplink.SetGroup, Args("Custom03", true), "m3", members[2]),
                    },
                    Op);
                Tick(engine, 10.0);

                object? reply = null;
                var cancel = new UplinkCancelRequest { Epoch = Journey(engine).Epoch, Craft = CraftNode, LaneSeq = 1 };
                engine.DispatchCommandAndWait(ChannelEngine.UplinkCancelCommand, cancel, Centre, r => reply = r, Op);
                Tick(engine, 11.0);

                Assert.IsType<CommandResult<UplinkActionReply>>(reply);
                Assert.All(members, m => Assert.Equal(FaultCode.CommandCancelled, m.Refused));
                Assert.Empty(Pending(engine));

                OpenRoute(engine);
                Tick(engine, 20.0);
                Tick(engine, 40.0);
                Assert.Empty(uplink.Ran);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ASendAgainSendsTheWholeGroupAndItRunsOnce()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new GroupTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);

                var members = new[] { new Member(), new Member() };
                engine.DispatchGroupAndWait(
                    Centre,
                    new[]
                    {
                        Send(GroupTestUplink.SetGroup, Args("Custom01", true), "m1", members[0]),
                        Send(GroupTestUplink.SetGroup, Args("Custom02", true), "m2", members[1]),
                    },
                    Op);
                Tick(engine, 10.0);

                object? reply = null;
                var again = new UplinkResendRequest { Epoch = Journey(engine).Epoch, Craft = CraftNode, LaneSeq = 1 };
                engine.DispatchCommandAndWait(ChannelEngine.UplinkResendCommand, again, Centre, r => reply = r, Op);
                Assert.IsType<CommandResult<UplinkActionReply>>(reply);
                Assert.Equal(2, Assert.Single(Pending(engine)).Attempts);

                OpenRoute(engine);
                Tick(engine, 11.0);
                Tick(engine, 11.0 + OneWaySeconds + 1.0);
                Tick(engine, 11.0 + 2 * OneWaySeconds + 2.0);

                Assert.Equal(new[] { "Custom01:True", "Custom02:True" }, uplink.Ran);
                Assert.Equal("done:Custom01", members[0].Result);
                Assert.Equal("done:Custom02", members[1].Result);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AFailureAtTheCraftStopsTheRestAndSaysWhatRan()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new GroupTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                OpenRoute(engine);
                Tick(engine, 0.0);

                var members = new[] { new Member(), new Member(), new Member() };
                engine.DispatchGroupAndWait(
                    Centre,
                    new[]
                    {
                        Send(GroupTestUplink.SetGroup, Args("Custom01", true), "m1", members[0]),
                        Send(GroupTestUplink.Fails, "x", "m2", members[1]),
                        Send(GroupTestUplink.SetGroup, Args("Custom03", true), "m3", members[2]),
                    },
                    Op);
                Tick(engine, 1.0);
                Tick(engine, 1.0 + OneWaySeconds + 1.0);
                Tick(engine, 1.0 + 2 * OneWaySeconds + 2.0);

                Assert.Equal(new[] { "Custom01:True" }, uplink.Ran);
                Assert.Equal("done:Custom01", members[0].Result);
                var failed = Assert.IsType<CommandResult>(members[1].Result);
                Assert.False(failed.Success);
                Assert.Equal(FaultCode.GroupStopped, members[2].Refused);
                Assert.Contains("did run", members[2].RefusedWith);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AHeldGroupSurvivesASaveAndALoadWhole()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new GroupTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);
                var members = new[] { new Member(), new Member() };
                engine.DispatchGroupAndWait(
                    Centre,
                    new[]
                    {
                        Send(GroupTestUplink.SetGroup, Args("Custom01", true), "m1", members[0]),
                        Send(GroupTestUplink.SetGroup, Args("Custom02", false), "m2", members[1]),
                    },
                    Op);
                Tick(engine, 1.0);

                var saved = DeliverySnapshotCodec.Decode(DeliverySnapshotCodec.Encode(engine.DeliverySnapshotNow()));
                Assert.NotNull(saved);
                engine.NoteGameLoaded(saved, savedUt: 1.0);
                Tick(engine, 2.0);
                Assert.Single(engine.DeliverySnapshotNow().Held);

                OpenRoute(engine);
                Tick(engine, 3.0);
                Tick(engine, 3.0 + OneWaySeconds + 1.0);

                Assert.Equal(new[] { "Custom01:True", "Custom02:False" }, uplink.Ran);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The game is quit with a command held on a lane and started again: the
        /// request that sent it died with the old process, and the client that
        /// reconnected finds the reply by the request id it chose.
        /// </summary>
        [Fact]
        public async Task AHeldCommandSavedAcrossARestartIsAnsweredToTheClientByItsRequestId()
        {
            DeliverySnapshot written;
            using (var before = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0))
            {
                before.RegisterUplink(new GroupTestUplink());
                before.Start();
                try
                {
                    CutRoute(before);
                    Tick(before, 0.0);
                    before.DispatchCommandAndWait(GroupTestUplink.SetGroup, Args("Custom01", true), Centre, _ => { }, Op, clientRequestId: "client-7");
                    Tick(before, 1.0);
                    written = DeliverySnapshotCodec.Decode(DeliverySnapshotCodec.Encode(before.DeliverySnapshotNow()))!;
                }
                finally
                {
                    before.Stop();
                }
            }

            using var after = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var afterUplink = new GroupTestUplink();
            after.RegisterUplink(afterUplink);
            after.RegisterCommandCentreSource(new VesselCentreSource(Centre));
            after.Start();
            try
            {
                CutRoute(after);
                Tick(after, 0.5);
                await using var reconnected = await TestClient.ConnectAsync(after.BoundPort, Op);
                await reconnected.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = Centre }));
                after.NoteGameLoaded(written, savedUt: 1.0);
                Tick(after, 2.0);
                OpenRoute(after);
                Tick(after, 3.0);
                Tick(after, 3.0 + OneWaySeconds + 1.0);
                Tick(after, 3.0 + 2 * OneWaySeconds + 2.0);

                Assert.Equal(new[] { "Custom01:True" }, afterUplink.Ran);
                var answer = await ReceiveTypedAsync<CommandResponse<object?>>(reconnected, Op);
                Assert.Equal("client-7", answer.RequestId);
                Assert.Equal("done:Custom01", answer.Result);
            }
            finally
            {
                after.Stop();
            }
        }

        /// <summary>
        /// The same restart, but the route never opens and the command runs out
        /// of time where it is held: the client is refused by its request id
        /// rather than left waiting.
        /// </summary>
        [Fact]
        public async Task AHeldCommandThatExpiresAfterARestartIsRefusedToTheClientByItsRequestId()
        {
            DeliverySnapshot written;
            using (var before = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0))
            {
                before.RegisterUplink(new GroupTestUplink());
                before.Start();
                try
                {
                    CutRoute(before);
                    Tick(before, 0.0);
                    before.DispatchCommandAndWait(GroupTestUplink.SetGroup, Args("Custom01", true), Centre, _ => { }, Op, clientRequestId: "client-8");
                    Tick(before, 1.0);
                    written = DeliverySnapshotCodec.Decode(DeliverySnapshotCodec.Encode(before.DeliverySnapshotNow()))!;
                }
                finally
                {
                    before.Stop();
                }
            }

            using var after = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var afterUplink = new GroupTestUplink();
            after.RegisterUplink(afterUplink);
            after.RegisterCommandCentreSource(new VesselCentreSource(Centre));
            after.Start();
            try
            {
                CutRoute(after);
                Tick(after, 0.5);
                await using var reconnected = await TestClient.ConnectAsync(after.BoundPort, Op);
                await reconnected.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = Centre }));
                after.NoteGameLoaded(written, savedUt: 1.0);
                Tick(after, 2.0);
                Tick(after, 5000.0);
                Tick(after, 6000.0);

                var refusal = await ReceiveTypedAsync<ErrorMsg>(reconnected, Op);
                Assert.Equal("client-8", refusal.RequestId);
                Assert.Equal(FaultCode.CommandExpired, refusal.Code);
                Assert.Empty(afterUplink.Ran);
            }
            finally
            {
                after.Stop();
            }
        }

        [Fact]
        public async Task ACommandGroupFrameIsAnsweredOnceForEachMemberUnderItsOwnRequestId()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new GroupTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Op);
                await client.SendAsync(EnvelopeCodec.WriteCommandGroup(new CommandGroupRequest
                {
                    GroupId = "g1",
                    Members = new List<CommandRequest<object?>>
                    {
                        new CommandRequest<object?> { RequestId = "r1", Command = GroupTestUplink.SetGroup, Args = Args("Custom01", true) },
                        new CommandRequest<object?> { RequestId = "r2", Command = "group.nothing", Args = Args("Custom02", true) },
                    },
                }));

                var first = await ReceiveTypedAsync<ErrorMsg>(client, Op);
                var second = await ReceiveTypedAsync<ErrorMsg>(client, Op);
                var byId = new[] { first, second }.ToDictionary(e => e.RequestId!);
                Assert.Equal(FaultCode.GroupRefused, byId["r1"].Code);
                Assert.Equal(FaultCode.CommandUnavailable, byId["r2"].Code);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACommandGroupFrameRoundTripsThroughTheCodec()
        {
            var group = new CommandGroupRequest
            {
                GroupId = "g7",
                Members = new List<CommandRequest<object?>>
                {
                    new CommandRequest<object?> { RequestId = "a", Command = "x.one", Label = "One", Args = Args("Custom01", true), Vantage = "ksc" },
                    new CommandRequest<object?> { RequestId = "b", Command = "x.two", Args = 4.0 },
                },
            };

            var parsed = Assert.IsType<CommandGroupRequest>(EnvelopeCodec.ParseClientMessage(EnvelopeCodec.WriteCommandGroup(group)));

            Assert.Equal("g7", parsed.GroupId);
            Assert.Equal(new[] { "a", "b" }, parsed.Members.Select(m => m.RequestId));
            Assert.Equal("One", parsed.Members[0].Label);
            Assert.Equal("ksc", parsed.Members[0].Vantage);
            Assert.Equal(4.0, parsed.Members[1].Args);
        }

        private sealed class SetGroupArgs
        {
            public string Group { get; set; } = "";

            public bool State { get; set; }
        }

        private static Dictionary<string, object?> Args(string group, bool state) =>
            new Dictionary<string, object?> { ["group"] = group, ["state"] = state };

        private sealed class VesselCentreSource : ICommandCentreSource
        {
            private readonly string _id;

            public VesselCentreSource(string id) => _id = id;

            public string ProviderId => "command-group-test";

            public IEnumerable<ICommandCentre> Enumerate() => new ICommandCentre[] { new VesselCentre(_id) };

            private sealed class VesselCentre : ICommandCentre
            {
                public VesselCentre(string id) => Id = id;

                public string Id { get; }
                public string DisplayName => Id;
                public CommandCentreKind Kind => CommandCentreKind.CrewedVessel;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }

        private static void CutRoute(ChannelEngine engine)
        {
            engine.SetAuthorityDelays(System.Array.Empty<(string, string, double)>());
            engine.SetUnroutable(new Dictionary<string, IReadOnlyCollection<string>>
            {
                [Centre] = new[] { AuthorityMatrixPass.FleetNode(CraftId) },
            });
        }

        private static void OpenRoute(ChannelEngine engine)
        {
            engine.SetAuthorityDelays(new[] { (Centre, CraftId, OneWaySeconds) });
            engine.SetUnroutable(new Dictionary<string, IReadOnlyCollection<string>>());
        }

        private static List<PendingUplink> Pending(ChannelEngine engine) =>
            Assert.IsType<PendingUplinkQueue>(engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending;

        private static CommsJourney Journey(ChannelEngine engine) => engine.JourneyAt(Centre);

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() }, Op);

        /// <summary>
        /// Delayed commands addressed to the craft's own node, shaped like
        /// <c>vessel.control.setActionGroup</c>, one that fails, one addressed to a
        /// different craft and one that is instant.
        /// </summary>
        private sealed class GroupTestUplink : ISitrepUplink
        {
            public const string SetGroup = "group.set";
            public const string Fails = "group.fails";
            public const string OtherCraft = "group.other";
            public const string Instant = "group.instant";
            private const string Topic = "fleet." + CraftId + ".group";
            private const string OtherTopic = "fleet.H.group";

            private readonly List<string> _ran = new List<string>();

            public IReadOnlyList<string> Ran
            {
                get
                {
                    lock (_ran)
                    {
                        return _ran.ToList();
                    }
                }
            }

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "command-group-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                    },
                    new ChannelDeclaration
                    {
                        Topic = OtherTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = SetGroup, Delay = DelayRole.Delayed, Subject = Topic },
                    new CommandDeclaration { Command = Fails, Delay = DelayRole.Delayed, Subject = Topic },
                    new CommandDeclaration { Command = OtherCraft, Delay = DelayRole.Delayed, Subject = OtherTopic },
                    new CommandDeclaration { Command = Instant, Delay = DelayRole.TrueNow, Subject = Topic },
                },
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Topic, _ => null);
                host.AddChannelSource(OtherTopic, _ => null);
                host.AddCommandHandler<SetGroupArgs, string>(SetGroup, args =>
                {
                    lock (_ran)
                    {
                        _ran.Add(args.Group + ":" + args.State);
                    }
                    return "done:" + args.Group;
                });
                host.AddCommandHandler<string, CommandResult>(Fails, _ => CommandResult.Fail(CommandErrorCode.WrongState, "nope"));
                host.AddCommandHandler<string, string>(OtherCraft, args => "other:" + args);
                host.AddCommandHandler<string, string>(Instant, args => "instant:" + args);
            }
        }
    }
}
