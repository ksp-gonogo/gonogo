using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Core.StoreAndForward;
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

        /// <summary>
        /// Signal delay switched off removes the waiting and not the missing
        /// route: a command held for want of a path is still held, and still
        /// pending, until a path opens.
        /// </summary>
        [Fact]
        public void SwitchingDelayOffDoesNotDeliverACommandHeldForWantOfAPath()
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
                Tick(engine, 10.0);
                Assert.Single(Pending(engine));

                using var off = engine.DelayModifiers.Register(0.0, "test: switched off");
                Tick(engine, 20.0);
                Tick(engine, 30.0);

                Assert.Equal(0, uplink.HandledCount);
                Assert.Single(Pending(engine));
                Assert.Contains(Journey(engine).Events, e => e.Kind == JourneyEventKind.Held && e.Craft == CraftNode);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Signal delay switched off delivers a command already travelling over the
        /// held path at once, and the reply home with it, where it would have run
        /// a light time later. The reply that sets off afterwards takes the hop
        /// delay the authority holds, which this harness does not fold the switch
        /// into.
        /// </summary>
        [Fact]
        public void SwitchingDelayOffDeliversACommandTravellingOverTheHeldPathAtOnce()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HeldCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                OpenRoute(engine);
                Tick(engine, 0.0);
                object? result = null;
                engine.DispatchCommandAndWait(HeldCommandTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op);
                Tick(engine, 1.0);
                Assert.Equal(0, uplink.HandledCount);

                using var off = engine.DelayModifiers.Register(0.0, "test: switched off");
                Tick(engine, 1.5);
                Tick(engine, 2.0);

                Assert.Equal(1, uplink.HandledCount);
                Tick(engine, 7.0);
                Assert.NotNull(result);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AHeldCommandThatExpiresReportsAgainstItsCraftAndRefusesItsRequest()
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
                var entry = Assert.Single(Pending(engine));

                Tick(engine, (entry.ExpiresAtUt ?? 0.0) + 1.0);

                var expired = Assert.Single(Journey(engine).Events, e => e.Kind == JourneyEventKind.Expired);
                Assert.Equal(entry.Craft, expired.Craft);
                Assert.Equal(entry.LaneSeq, expired.LaneSeq);
                Assert.True(expired.AtUt >= entry.ExpiresAtUt);
                Assert.Equal(FaultCode.CommandExpired, refused);
                Assert.Empty(Pending(engine));
                Assert.Equal(0, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AReplyThatCannotComeHomeIsMarkedOverdueThenRefusedAsNotReceivedRatherThanExpired()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HeldCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                OpenRoute(engine);
                Tick(engine, 0.0);

                FaultCode? refused = null;
                string? reason = null;
                engine.DispatchCommandAndWait(HeldCommandTestUplink.Command, "x", Centre, _ => { }, TestBudgets.Op, onRefused: (code, why) =>
                {
                    refused = code;
                    reason = why;
                });
                Tick(engine, 1.0);
                Tick(engine, 1.0 + OneWaySeconds + 0.5);
                Assert.Equal(1, uplink.HandledCount);

                CutRoute(engine);
                var entry = Assert.Single(Pending(engine));
                Assert.Null(entry.ReplyOverdueUt);
                Tick(engine, (entry.PredictedReplyUt ?? 0.0) - 1.0);
                Assert.Null(Assert.Single(Pending(engine)).ReplyOverdueUt);

                Tick(engine, (entry.PredictedReplyUt ?? 0.0) + 10.0);
                Assert.NotNull(Assert.Single(Pending(engine)).ReplyOverdueUt);
                Assert.Null(refused);

                Tick(engine, (entry.ExpiresAtUt ?? 0.0) + 2 * OneWaySeconds + 60.0);
                Assert.Equal(FaultCode.ReplyNotReceived, refused);
                Assert.DoesNotContain("expired before it could run", reason);
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

        /// <summary>The refusal for a repeated order number says it in words an operator reads, with no request or node ids in it.</summary>
        [Fact]
        public void TheRefusalForARepeatedOrderNumberNamesNoInternalIds()
        {
            Assert.DoesNotMatch(@"\b[cr]\d+\b|ground:|vessel:", ChannelEngine.OrderAlreadyWaitingDetail);
        }

        [Fact]
        public void EveryCommandSentAfterALoadRunsBesideTheTwoTheSaveCarried()
        {
            DeliverySnapshot saved;
            using (var before = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0))
            {
                before.RegisterUplink(new HeldCommandTestUplink());
                before.Start();
                try
                {
                    CutRoute(before);
                    Tick(before, 0.0);
                    for (var i = 1; i <= 2; i++)
                    {
                        before.DispatchCommandAndWait(HeldCommandTestUplink.Command, "carried" + i, Centre, _ => { }, TestBudgets.Op);
                    }

                    Tick(before, 1.0);
                    saved = before.DeliverySnapshotNow();
                    Assert.Equal(2, saved.Held.Count);
                }
                finally
                {
                    before.Stop();
                }
            }

            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HeldCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);
                engine.NoteGameLoaded(saved);
                Tick(engine, 2.0);
                for (var i = 1; i <= 4; i++)
                {
                    engine.DispatchCommandAndWait(HeldCommandTestUplink.Command, "after" + i, Centre, _ => { }, TestBudgets.Op);
                }

                Tick(engine, 3.0);
                Assert.Equal(6, engine.DeliverySnapshotNow().Held.Count);

                OpenRoute(engine);
                Tick(engine, 4.0);
                Tick(engine, 4.0 + OneWaySeconds + 1.0);
                Assert.Equal(6, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A throttle goes to the active craft on the live path, and the game
        /// switches to another craft before it lands. It is refused there rather
        /// than run against the craft that is active now, and the centre hears why.
        /// </summary>
        [Fact]
        public void AThrottleLandingAfterAVesselSwitchDoesNotRunOnTheNewCraft()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: OneWaySeconds);
            var uplink = new ActiveCraftTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                TickActive(engine, uplink, 0.0, loaded: true);
                object? result = null;
                engine.DispatchCommandAndWait(
                    ActiveCraftTestUplink.ThrottleCommand,
                    new Dictionary<string, object?> { ["value"] = 1.0 },
                    Centre,
                    r => result = r,
                    TestBudgets.Op);
                Assert.Empty(Journey(engine).Events);

                foreach (var ut in new[] { 1.0, OneWaySeconds + 1.0, (2 * OneWaySeconds) + 1.0 })
                {
                    TickActive(engine, uplink, ut, loaded: true, craft: "H");
                }

                Assert.Equal(0, uplink.ThrottledCount);
                var outcome = Assert.IsType<CommandResult>(result);
                Assert.False(outcome.Success);
                Assert.Equal(CommandErrorCode.WrongState, outcome.ErrorCode);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The operator's screen runs one signal delay behind the game. An order pressed
        /// while the screen still shows the craft the game has switched away from is
        /// refused at the press, so it is never tagged with, and run on, the new craft.
        /// </summary>
        [Fact]
        public void AnOrderPressedWhileSeeingTheCraftTheGameSwitchedAwayFromIsRefusedAtThePress()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: OneWaySeconds);
            var uplink = new ActiveCraftTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                TickActive(engine, uplink, 0.0, loaded: true);
                TickActive(engine, uplink, 1.0, loaded: true, craft: "H");
                object? result = null;
                engine.DispatchCommandAndWait(ActiveCraftTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op, seenVesselId: CraftId);

                var refusal = Assert.IsType<CommandResult>(result);
                Assert.False(refusal.Success);
                Assert.Equal(CommandErrorCode.WrongState, refusal.ErrorCode);
                Assert.Empty(Pending(engine));
                Assert.Empty(Journey(engine).Events);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>The same press naming the craft that is active, or naming none, is accepted.</summary>
        [Fact]
        public void AnOrderPressedWhileSeeingTheActiveCraftOrNoneIsAccepted()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: OneWaySeconds);
            var uplink = new ActiveCraftTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                TickActive(engine, uplink, 0.0, loaded: true);
                engine.DispatchCommandAndWait(ActiveCraftTestUplink.Command, "x", Centre, _ => { }, TestBudgets.Op, seenVesselId: CraftId);
                engine.DispatchCommandAndWait(ActiveCraftTestUplink.Command, "x", Centre, _ => { }, TestBudgets.Op);

                Assert.Equal(2, Pending(engine).Count);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A held command's gates are asked again where it lands: one that
        /// passed at the press and fails by the time the command reaches the
        /// craft is refused there, as a member of a group would be.
        /// </summary>
        [Fact]
        public void AHeldCommandWhoseGateHasClosedByTheTimeItLandsIsRefused()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: OneWaySeconds);
            var uplink = new ActiveCraftTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                TickActive(engine, uplink, 0.0, loaded: true);
                object? result = null;
                engine.DispatchCommandAndWait(ActiveCraftTestUplink.GatedCommand, "x", Centre, r => result = r, TestBudgets.Op);
                Assert.Single(Pending(engine));

                uplink.GateOpen = false;
                foreach (var ut in new[] { 1.0, OneWaySeconds + 1.0, (2 * OneWaySeconds) + 2.0 })
                {
                    TickActive(engine, uplink, ut, loaded: true);
                }

                Assert.Equal(0, uplink.HandledCount);
                var outcome = Assert.IsType<CommandResult>(result);
                Assert.False(outcome.Success);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The tick's snapshot still names the craft the command was sent to, and
        /// the game has switched away in the frames before the main thread runs
        /// it. The check made on the main thread catches the switch.
        /// </summary>
        [Fact]
        public void ACommandIsCheckedAgainstTheGamesActiveVesselOnTheThreadThatRunsIt()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: OneWaySeconds, executeCommandsOnMainThread: true);
            var uplink = new ActiveCraftTestUplink();
            engine.RegisterUplink(uplink);
            var reported = new ReportedVessel { Id = CraftId };
            engine.Kernel.RegisterCapability(new CapabilityDescriptor { Id = ActiveVesselCapability.Id, Exclusive = true, Vanilla = _ => reported });
            engine.ResolveCapabilities();
            engine.Start();
            using var stop = new ManualResetEventSlim(false);
            var pump = new Thread(() =>
            {
                while (!stop.IsSet)
                {
                    engine.RunPendingCommands();
                    Thread.Sleep(2);
                }
            })
            { IsBackground = true, Name = "test-main-thread-pump" };
            pump.Start();
            try
            {
                TickActive(engine, uplink, 0.0, loaded: true);
                object? result = null;
                engine.DispatchCommandAndWait(ActiveCraftTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op);
                Assert.Single(Pending(engine));

                reported.Id = "H";
                foreach (var ut in new[] { 1.0, OneWaySeconds + 1.0, (2 * OneWaySeconds) + 2.0 })
                {
                    TickActive(engine, uplink, ut, loaded: true);
                }

                Assert.Equal(0, uplink.HandledCount);
                var outcome = Assert.IsType<CommandResult>(result);
                Assert.False(outcome.Success);
                Assert.Equal(CommandErrorCode.WrongState, outcome.ErrorCode);
            }
            finally
            {
                stop.Set();
                pump.Join(TestBudgets.Op);
                engine.Stop();
            }
        }

        private sealed class ReportedVessel : IActiveVessel
        {
            private volatile string? _id;

            public string? Id
            {
                get => _id;
                set => _id = value;
            }

            public string ProviderId => "test-active-vessel";

            public object? Reported => _id;

            public string? ReportedId => _id;

            public bool SubstitutedForEva => false;
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
        /// The craft's own link reads down while the centre's plan says the way is
        /// open: every copy is caught on landing, and the centre is told so
        /// instead of hearing nothing until the order expires.
        /// </summary>
        [Fact]
        public void AnOrderCaughtOnLandingBecauseTheLedgerReadsTheCraftDownIsReportedLost()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: OneWaySeconds);
            var uplink = new ActiveCraftTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                TickActive(engine, uplink, 0.0, loaded: true);
                engine.DispatchCommandAndWait(ActiveCraftTestUplink.Command, "x", Centre, _ => { }, TestBudgets.Op);
                var sent = Assert.Single(Pending(engine));
                uplink.Link = false;

                foreach (var ut in new[] { 1.0, 2.0, OneWaySeconds + 0.5, OneWaySeconds + 2.0, (2 * OneWaySeconds) + 1.0 })
                {
                    TickActive(engine, uplink, ut, loaded: false);
                }

                Assert.Equal(0, uplink.HandledCount);
                var lost = Assert.Single(Journey(engine).Events, e => e.About == sent.Id && e.Kind == JourneyEventKind.LostOnLanding);
                Assert.Contains("copy 1", lost.Detail);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// An order for the active craft is refused at the press, with a reason the
        /// operator can read, when no craft is loaded as the active vessel: it could
        /// only land on a craft the game cannot apply it to, and waiting would not
        /// change that.
        /// </summary>
        [Fact]
        public void AnOrderForTheActiveCraftIsRefusedAtThePressWhenNoCraftIsLoaded()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: OneWaySeconds);
            var uplink = new ActiveCraftTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                TickActive(engine, uplink, 0.0, loaded: true);
                TickActive(engine, uplink, 1.0, loaded: false);
                object? result = null;
                string? failure = null;
                engine.DispatchCommandAndWait(ActiveCraftTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op, onRefused: (_, r) => failure = r);

                var refusal = Assert.IsType<CommandResult>(result);
                Assert.False(refusal.Success);
                Assert.Equal(CommandErrorCode.WrongScene, refusal.ErrorCode);
                Assert.Contains("not in flight", refusal.Detail);
                Assert.Null(failure);
                Assert.Empty(Pending(engine));
                TickActive(engine, uplink, 2.0 * OneWaySeconds, loaded: false);
                Assert.Equal(0, uplink.HandledCount);
                Assert.Empty(Journey(engine).Events);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A tick that carries the vessel's other readings but not its identity says
        /// nothing about whether a craft is loaded. The press is neither refused as
        /// "not in flight" nor sent on a guess: the craft last known to be loaded
        /// stays loaded until a tick shows there is none.
        /// </summary>
        [Fact]
        public void AnOrderForTheActiveCraftIsNotRefusedBecauseItsIdentityCouldNotBeRead()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: OneWaySeconds);
            var uplink = new ActiveCraftTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                TickActive(engine, uplink, 0.0, loaded: true);
                uplink.Loaded = true;
                engine.TickAndWait(
                    1.0,
                    new KspSnapshot
                    {
                        Ut = 1.0,
                        Values = new Dictionary<string, object?>
                        {
                            ["vessel"] = new Dictionary<string, object?>
                            {
                                ["orbit"] = new Dictionary<string, object?> { ["sma"] = 700000.0 },
                            },
                        },
                    },
                    TestBudgets.Op);

                object? result = null;
                engine.DispatchCommandAndWait(ActiveCraftTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op);

                Assert.Null(result);
                Assert.Single(Pending(engine));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>No identity and no vessel at all is a tick with no craft loaded, and the press is refused as before.</summary>
        [Fact]
        public void AnOrderIsStillRefusedWhenATickCarriesNoVesselAtAll()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: OneWaySeconds);
            var uplink = new ActiveCraftTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                TickActive(engine, uplink, 0.0, loaded: true);
                TickActive(engine, uplink, 1.0, loaded: false);
                object? result = null;
                engine.DispatchCommandAndWait(ActiveCraftTestUplink.Command, "x", Centre, r => result = r, TestBudgets.Op);

                Assert.Equal(CommandErrorCode.WrongScene, Assert.IsType<CommandResult>(result).ErrorCode);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>The same press with the active craft loaded is accepted, sent and run.</summary>
        [Fact]
        public void AnOrderForTheActiveCraftStillGoesThroughWhenItIsLoaded()
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
                Assert.Single(Pending(engine));

                foreach (var ut in new[] { 1.0, OneWaySeconds + 0.5, OneWaySeconds + 2.0, (2 * OneWaySeconds) + 1.0 })
                {
                    TickActive(engine, uplink, ut, loaded: true);
                }

                Assert.Equal(1, uplink.HandledCount);
                Assert.Equal("done:x", result);
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

        /// <summary>
        /// A command sent after a load is held beside the ones the save carried, even when
        /// this process mints the request id one of them already has. A new command that
        /// shared an id with a carried one was never held, and every later command on its
        /// lane then waited behind its number.
        /// </summary>
        [Fact]
        public void ACommandSentAfterALoadIsHeldBesideTheOnesTheSaveCarried()
        {
            DeliverySnapshot saved;
            using (var before = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0))
            {
                before.RegisterUplink(new HeldCommandTestUplink());
                before.Start();
                try
                {
                    CutRoute(before);
                    Tick(before, 0.0);
                    before.DispatchCommandAndWait(HeldCommandTestUplink.Command, "first", Centre, _ => { }, TestBudgets.Op);
                    Tick(before, 1.0);
                    saved = before.DeliverySnapshotNow();
                    Assert.Single(saved.Held);
                }
                finally
                {
                    before.Stop();
                }
            }

            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new HeldCommandTestUplink());
            engine.Start();
            try
            {
                CutRoute(engine);
                Tick(engine, 0.0);
                engine.NoteGameLoaded(saved);
                Tick(engine, 2.0);
                Assert.Single(engine.DeliverySnapshotNow().Held);

                engine.DispatchCommandAndWait(HeldCommandTestUplink.Command, "second", Centre, _ => { }, TestBudgets.Op);
                Tick(engine, 3.0);

                Assert.Equal(2, engine.DeliverySnapshotNow().Held.Count);
                Assert.Equal(2, engine.DeliverySnapshotNow().Held.Select(h => h.Message.Id).Distinct().Count());
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
        private static void TickActive(ChannelEngine engine, ActiveCraftTestUplink uplink, double ut, bool loaded, string craft = CraftId)
        {
            uplink.Loaded = loaded;
            var values = new Dictionary<string, object?>();
            if (loaded)
            {
                values["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = craft },
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

            /// <summary>A continuous input, which goes on the live path rather than being held.</summary>
            public const string ThrottleCommand = "vessel.control.setThrottle";
            private const string Topic = "active-test.state";

            /// <summary>A held command behind a gate the test opens and closes.</summary>
            public const string GatedCommand = "held.gated";
            private const string GateKind = "test-open";

            private int _handled;
            private int _throttled;
            private volatile bool _gateOpen = true;

            public bool GateOpen
            {
                get => _gateOpen;
                set => _gateOpen = value;
            }

            public int ThrottledCount => Volatile.Read(ref _throttled);

            private sealed class OpenGate : ICommandGateEvaluator
            {
                private readonly ActiveCraftTestUplink _uplink;

                public OpenGate(ActiveCraftTestUplink uplink)
                {
                    _uplink = uplink;
                }

                public string Kind => GateKind;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) =>
                    _uplink.GateOpen
                        ? GateVerdict.Pass()
                        : GateVerdict.Fail(new LimitBreach { Facility = "LaunchPad", Quantity = "mass", Limit = 18.0, Actual = 19.4, Unit = "t" });
            }
            private volatile bool _loaded = true;
            private volatile bool _link = true;

            /// <summary>What the fleet capture reports of the craft's own link.</summary>
            public bool Link
            {
                get => _link;
                set => _link = value;
            }

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
                    { Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = Topic },
                    new CommandDeclaration { Command = ThrottleCommand, Delay = DelayRole.Delayed, Subject = Topic },
                    new CommandDeclaration
                    {
                        Command = GatedCommand,
                        Delay = DelayRole.Delayed,
                        Subject = Topic,
                        Requires = new[] { new CommandRequirement { Kind = GateKind } },
                    },
                },
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<Dictionary<string, object?>, string>(ThrottleCommand, _ =>
                {
                    Interlocked.Increment(ref _throttled);
                    return "throttled";
                });
                host.AddCommandHandler<string, string>(GatedCommand, args =>
                {
                    Interlocked.Increment(ref _handled);
                    return "done:" + args;
                });
                host.AddGateEvaluator(new OpenGate(this));
                host.AddSampledSource(_ => true, _ =>
                {
                    host.SetVesselDelay(CraftId, OneWaySeconds);
                    host.SetVesselConnectivity(CraftId, _link);
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
                    { Kind = SampleKind.Continuous,
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
