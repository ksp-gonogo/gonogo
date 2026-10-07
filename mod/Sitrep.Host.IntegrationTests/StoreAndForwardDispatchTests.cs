using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A delayed command addressed to a craft its centre has no route to is held
    /// at the centre rather than refused, runs once a route opens, and reports
    /// each step of its journey back on <c>comms.journey</c>; a cancel stops it,
    /// and a game load starts the network again from what the save carried.
    /// </summary>
    public class StoreAndForwardDispatchTests
    {
        private const string Centre = "vessel:F";
        private const string CraftId = "G";
        private const string CraftNode = "vessel:G";
        private const double OneWaySeconds = 4.0;

        [Fact]
        public void AHeldCommandRunsOnceItsRouteOpensAndItsReplySettlesTheRequest()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HeldCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);

                object? result = null;
                engine.DispatchCommandAndWait(HeldCommandTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op);
                Tick(engine, 100.0);

                Assert.Equal(0, uplink.HandledCount);
                Assert.Null(result);
                Assert.Contains(Journey(engine).Events, e => e.Kind == JourneyEventKind.Held && e.Craft == CraftNode && e.LaneSeq == 1);

                OpenRoute(engine);
                Tick(engine, 101.0);
                Tick(engine, 101.0 + OneWaySeconds + 1.0);
                Assert.Equal(1, uplink.HandledCount);

                Tick(engine, 101.0 + 2 * OneWaySeconds + 2.0);
                Assert.NotNull(result);
                Assert.Contains(Journey(engine).Events, e => e.Kind == JourneyEventKind.Ran && e.LaneSeq == 1);
                Assert.Empty(Pending(engine));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACancelStopsAHeldCommandAndRefusesItsRequest()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HeldCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);

                FaultCode? refused = null;
                engine.DispatchCommandAndWait(HeldCommandTestUplink.Command, "x", Centre, _ => { }, TestBudgets.Op, onRefused: (code, _) => refused = code);
                Tick(engine, 10.0);

                object? reply = null;
                var cancel = new UplinkCancelRequest { Epoch = Journey(engine).Epoch, Craft = CraftNode, LaneSeq = 1 };
                engine.DispatchCommandAndWait(ChannelEngine.UplinkCancelCommand, cancel, Centre, r => reply = r, TestBudgets.Op);
                Tick(engine, 11.0);

                var ok = Assert.IsType<CommandResult<UplinkActionReply>>(reply);
                Assert.Equal(1, ok.Payload!.ThroughSeq);
                Assert.Equal(FaultCode.CommandCancelled, refused);
                Assert.Empty(Pending(engine));

                OpenRoute(engine);
                Tick(engine, 20.0);
                Tick(engine, 40.0);
                Assert.Equal(0, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ASendAgainSettlesTheOriginalRequestWhicheverCopyRuns()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HeldCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);

                object? result = null;
                engine.DispatchCommandAndWait(HeldCommandTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op);
                Tick(engine, 10.0);

                object? reply = null;
                var again = new UplinkResendRequest { Epoch = Journey(engine).Epoch, Craft = CraftNode, LaneSeq = 1 };
                engine.DispatchCommandAndWait(ChannelEngine.UplinkResendCommand, again, Centre, r => reply = r, TestBudgets.Op);

                var ok = Assert.IsType<CommandResult<UplinkActionReply>>(reply);
                Assert.NotEqual("", ok.Payload!.Id);
                Assert.Equal(2, Assert.Single(Pending(engine)).Attempts);

                OpenRoute(engine);
                Tick(engine, 11.0);
                Tick(engine, 11.0 + OneWaySeconds + 1.0);
                Tick(engine, 11.0 + 2 * OneWaySeconds + 2.0);

                Assert.Equal(1, uplink.HandledCount);
                Assert.NotNull(result);
                Assert.Empty(Pending(engine));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Send again is for a command that is held somewhere or overdue. One
        /// that left on an open route and is not yet due is left to arrive: a
        /// second copy would only race the first. Once the reply the centre
        /// predicted is late, it may be sent again.
        /// </summary>
        [Fact]
        public void ACommandOnItsWayCanBeSentAgainOnlyOnceItsReplyIsLate()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HeldCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                OpenRoute(engine);
                Tick(engine, 0.0);
                engine.DispatchCommandAndWait(HeldCommandTestUplink.Command, "x", Centre, _ => { }, TestBudgets.Op);
                Tick(engine, 1.0);
                var predictedReply = Assert.Single(Pending(engine)).PredictedReplyUt;
                Assert.NotNull(predictedReply);
                // The craft's link goes while the command is on its way, so nothing answers.
                CutRoute(engine);
                Tick(engine, 2.0);

                var again = new UplinkResendRequest { Epoch = Journey(engine).Epoch, Craft = CraftNode, LaneSeq = 1 };
                object? early = null;
                engine.DispatchCommandAndWait(ChannelEngine.UplinkResendCommand, again, Centre, r => early = r, TestBudgets.Op);

                var refused = Assert.IsType<CommandResult>(early);
                Assert.False(refused.Success);
                Assert.Equal(1, Assert.Single(Pending(engine)).Attempts);

                Tick(engine, predictedReply!.Value + 1.0);
                object? late = null;
                engine.DispatchCommandAndWait(ChannelEngine.UplinkResendCommand, again, Centre, r => late = r, TestBudgets.Op);

                Assert.IsType<CommandResult<UplinkActionReply>>(late);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A command for the active craft is one light-second from landing when
        /// the game switches to another craft. It lands on that tick. It was sent
        /// to the craft that was active, so it does not run against the one that
        /// is now: the active craft used to be read after the clock had already
        /// landed it.
        /// </summary>
        [Fact]
        public async System.Threading.Tasks.Task ACommandLandingOnTheTickOfAVesselSwitchDoesNotRunAgainstTheNewCraft()
        {
            await using var world = await ReckonedVantageWorld.StartAsync();
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0, 1000.0 })
            {
                world.Tick(ut);
            }
            object? result = null;
            world.Engine.DispatchCommandAndWait(
                ScriptedContactUplink.ActiveCommand, "x", ScriptedContactGame.Home, r => result = r, TestBudgets.Op);
            Assert.Single(Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);

            world.Game.ActiveNow = "B";
            world.Tick(1003.0);
            world.Tick(1010.0);

            Assert.Equal(0, world.Uplink.ActiveHandledCount);
        }

        /// <summary>
        /// An order on its way to the active craft when the game goes to the
        /// Tracking Station is carried by light, not by the scene: it lands
        /// when it arrives. The craft is no longer loaded, so the game cannot
        /// apply it, and the centre is told so when the reply would reach it,
        /// rather than the order being caught on a link that reads down only
        /// because no craft is active.
        /// </summary>
        [Fact]
        public void AnOrderCrossingALeaveFromFlightLandsAndItsOutcomeComesHome()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: OneWaySeconds);
            var uplink = new ActiveCraftTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                TickActive(engine, uplink, 0.0, loaded: true);
                object? result = null;
                string? refusal = null;
                engine.DispatchCommandAndWait(ActiveCraftTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op, onRefused: (_, r) => refusal = r);
                Assert.Null(refusal);
                var sent = Assert.Single(Pending(engine));

                foreach (var ut in new[] { 1.0, 2.0, OneWaySeconds + 0.5, OneWaySeconds + 2.0, (2 * OneWaySeconds) + 1.0 })
                {
                    TickActive(engine, uplink, ut, loaded: false);
                }

                Assert.Equal(0, uplink.HandledCount);
                var outcome = Assert.IsType<CommandResult>(result);
                Assert.False(outcome.Success);
                Assert.Equal(CommandErrorCode.WrongState, outcome.ErrorCode);
                Assert.Empty(Pending(engine));
                var journey = Journey(engine).Events.Where(e => e.About == sent.Id).ToList();
                Assert.DoesNotContain(journey, e => e.Kind == JourneyEventKind.Held);
                Assert.Contains(journey, e => e.Kind == JourneyEventKind.Ran);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The same order, with the game back in flight before it arrives: it
        /// lands on the craft it was sent to and runs there.
        /// </summary>
        [Fact]
        public void AnOrderCrossingAShortLeaveFromFlightRunsWhenItArrives()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: OneWaySeconds);
            var uplink = new ActiveCraftTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                TickActive(engine, uplink, 0.0, loaded: true);
                object? result = null;
                engine.DispatchCommandAndWait(ActiveCraftTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op);

                TickActive(engine, uplink, 1.0, loaded: false);
                TickActive(engine, uplink, 2.0, loaded: false);
                foreach (var ut in new[] { 3.0, OneWaySeconds + 0.5, OneWaySeconds + 2.0, (2 * OneWaySeconds) + 1.0 })
                {
                    TickActive(engine, uplink, ut, loaded: true);
                }

                Assert.Equal(1, uplink.HandledCount);
                Assert.Equal("done:x", result);
                Assert.Empty(Pending(engine));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ASendAgainFromAnotherCentreDoesNotTouchThisCentresCommand()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HeldCommandTestUplink());
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);
                engine.DispatchCommandAndWait(HeldCommandTestUplink.Command, "x", Centre, _ => { }, TestBudgets.Op);
                Tick(engine, 1.0);

                object? reply = null;
                var again = new UplinkResendRequest { Epoch = Journey(engine).Epoch, Craft = CraftNode, LaneSeq = 1 };
                engine.DispatchCommandAndWait(ChannelEngine.UplinkResendCommand, again, "ground:Cape", r => reply = r, TestBudgets.Op);

                Assert.False(Assert.IsType<CommandResult>(reply).Success);
                Assert.Equal(1, Assert.Single(Pending(engine)).Attempts);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACancelNamingAnEarlierTimelineIsRefused()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HeldCommandTestUplink());
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);
                engine.DispatchCommandAndWait(HeldCommandTestUplink.Command, "x", Centre, _ => { }, TestBudgets.Op);
                Tick(engine, 1.0);

                object? reply = null;
                var cancel = new UplinkCancelRequest { Epoch = Journey(engine).Epoch + 1, Craft = CraftNode, LaneSeq = 1 };
                engine.DispatchCommandAndWait(ChannelEngine.UplinkCancelCommand, cancel, Centre, r => reply = r, TestBudgets.Op);

                var fail = Assert.IsType<CommandResult>(reply);
                Assert.False(fail.Success);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A quickload turns the clock back to before an order was sent. On the
        /// timeline it lands on the order was never sent, so it does not run,
        /// and the request that sent it is told so rather than left waiting.
        /// </summary>
        [Fact]
        public void AnOrderARewindUndoesIsRefusedAsUndoneByTheLoad()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HeldCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                OpenRoute(engine);
                Tick(engine, 0.0);
                Tick(engine, 10.0);
                FaultCode? code = null;
                string? reason = null;
                object? result = null;
                engine.DispatchCommandAndWait(
                    HeldCommandTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op,
                    onRefused: (c, r) =>
                    {
                        code = c;
                        reason = r;
                    });
                Tick(engine, 11.0);

                Tick(engine, 5.0);

                Assert.Equal(FaultCode.UndoneByLoad, code);
                Assert.NotNull(reason);
                Assert.Empty(Pending(engine));

                Tick(engine, 30.0);
                Assert.Equal(0, uplink.HandledCount);
                Assert.Null(result);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A load whose save carried an order on its way keeps it on its way, and
        /// its reply still settles the request that sent it.
        /// </summary>
        [Fact]
        public void AnOrderTheLoadedSaveCarriedStillSettlesItsRequest()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HeldCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                OpenRoute(engine);
                Tick(engine, 0.0);
                FaultCode? code = null;
                object? result = null;
                engine.DispatchCommandAndWait(
                    HeldCommandTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op,
                    onRefused: (c, _) => code = c);
                Tick(engine, 0.5);

                engine.NoteGameLoaded(engine.DeliverySnapshotNow(), savedUt: 0.5);
                Tick(engine, 1.0);
                Assert.Single(Pending(engine));

                Tick(engine, 1.0 + OneWaySeconds + 1.0);
                Tick(engine, 1.0 + 2 * OneWaySeconds + 2.0);

                Assert.Null(code);
                Assert.Equal(1, uplink.HandledCount);
                Assert.NotNull(result);
                Assert.Empty(Pending(engine));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AGameLoadDropsWhatWasHeldAndRestoresWhatTheSaveCarried()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HeldCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);
                engine.DispatchCommandAndWait(HeldCommandTestUplink.Command, "x", Centre, _ => { }, TestBudgets.Op);
                Tick(engine, 1.0);

                var saved = engine.DeliverySnapshotNow();
                Assert.Single(saved.Held);

                engine.NoteGameLoaded(null);
                Tick(engine, 2.0);
                Assert.Empty(engine.DeliverySnapshotNow().Held);

                engine.NoteGameLoaded(saved);
                Assert.Same(saved, engine.DeliverySnapshotNow());
                Tick(engine, 3.0);
                Assert.Single(engine.DeliverySnapshotNow().Held);

                OpenRoute(engine);
                Tick(engine, 4.0);
                Tick(engine, 4.0 + OneWaySeconds + 1.0);
                Assert.Equal(1, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
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
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() }, TestBudgets.Op);

        /// <summary>A tick with the craft loaded as the active vessel, or with none loaded, as in the Tracking Station.</summary>
        private static void TickActive(ChannelEngine engine, ActiveCraftTestUplink uplink, double ut, bool loaded)
        {
            uplink.Loaded = loaded;
            var values = new Dictionary<string, object?>();
            if (loaded)
            {
                values["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = CraftId },
                };
            }
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = values }, TestBudgets.Op);
        }

        /// <summary>
        /// One delayed command for whichever craft is active. The active
        /// vessel's link reads down whenever no craft is loaded, as the game
        /// reads it in the Tracking Station, while the craft's own link, which
        /// the fleet capture reports in every scene, stays up.
        /// </summary>
        private sealed class ActiveCraftTestUplink : ISitrepUplink
        {
            public const string Command = "held.active";
            private const string Topic = "active-test.state";

            private int _handled;
            private volatile bool _loaded = true;

            public int HandledCount => Volatile.Read(ref _handled);

            public bool Loaded
            {
                get => _loaded;
                set => _loaded = value;
            }

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "store-and-forward-active-test",
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
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = Topic },
                },
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.AddSampledSource(_ => true, _ =>
                {
                    host.SetVesselDelay(CraftId, OneWaySeconds);
                    host.SetVesselConnectivity(CraftId, true);
                });
                host.AddChannelSource(Topic, _ => null);
                host.SetConnectivitySource(_ => _loaded);
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    Interlocked.Increment(ref _handled);
                    return "done:" + args;
                });
            }
        }

        /// <summary>One delayed command whose subject is a named craft's own node.</summary>
        private sealed class HeldCommandTestUplink : ISitrepUplink
        {
            public const string Command = "held.craft";
            private const string Topic = "fleet." + CraftId + ".state";

            private int _handled;

            public int HandledCount => Volatile.Read(ref _handled);

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "store-and-forward-test",
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
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = Topic },
                },
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Topic, _ => null);
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    Interlocked.Increment(ref _handled);
                    return "done:" + args;
                });
            }
        }
    }
}
