using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// How a game load becomes a timeline: one reset per load, a rewind when the
    /// loaded save is still on the current line, a fresh timeline otherwise. A
    /// delayed command on the live path is sent with a five-second signal delay,
    /// so one sent at UT 0 runs at 5.
    /// </summary>
    public class LoadMarkerTests
    {
        private const double Delay = 5.0;

        private static readonly TimeSpan Timeout = TestBudgets.Op;

        /// <summary>
        /// A load the game did not mark resets twice: once when the clock goes back,
        /// restoring from a later save that does not carry the command, and again when
        /// the loaded save arrives carrying it. The command was told it will not run
        /// at the first, so it must not run after the second.
        /// </summary>
        [Fact]
        public void ACommandToldALoadUndidItDoesNotRunWhenTheSameLoadResetsAgain()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                Tick(engine, 0.0);
                var answers = Dispatch(engine, out var refusals);
                Tick(engine, 1.0);
                var quicksave = Written(engine);
                Tick(engine, 3.0);
                engine.NoteSaved(new DeliverySnapshot(), null, 3.0);
                Tick(engine, 4.0);

                Tick(engine, 1.0);
                Assert.Equal(new[] { FaultCode.UndoneByLoad }, refusals);
                engine.NoteGameLoaded(quicksave, savedUt: 1.0);
                Tick(engine, 1.0);
                Tick(engine, 5.0);
                Tick(engine, 30.0);

                Assert.Equal(0, uplink.Runs);
                Assert.Empty(answers);
                Assert.Equal(new[] { FaultCode.UndoneByLoad }, refusals);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The same load, marked by the game before its clock goes back: the backward
        /// tick waits for the save, so the one reset restores the save that was loaded
        /// and the command it carries runs once and answers its request.
        /// </summary>
        [Fact]
        public void AMarkedLoadResetsOnceAndRestoresTheSaveItLoaded()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                Tick(engine, 0.0);
                var answers = Dispatch(engine, out var refusals);
                Tick(engine, 1.0);
                var quicksave = Written(engine);
                engine.NoteSaved(quicksave, null, 1.0, token: "quicksave");
                Tick(engine, 3.0);
                engine.NoteSaved(new DeliverySnapshot(), null, 3.0, token: "vessel-switch");
                Tick(engine, 4.0);
                var resetsBefore = engine.TimelineResetsForTests;

                engine.NoteLoadStarted();
                Tick(engine, 1.0);
                Assert.Equal(resetsBefore, engine.TimelineResetsForTests);
                engine.NoteGameLoaded(quicksave, savedUt: 1.0, token: "quicksave");
                Tick(engine, 1.0);
                Tick(engine, 5.0);
                Tick(engine, 10.0);
                Tick(engine, 30.0);

                Assert.Equal(resetsBefore + 1, engine.TimelineResetsForTests);
                Assert.Equal(1, uplink.Runs);
                Assert.Equal(new object?[] { "ran:x" }, answers);
                Assert.Empty(refusals);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A save written after the quicksave (a vessel switch, an autosave) does not
        /// make the quicksave a different game: its history up to the save is kept.
        /// </summary>
        [Fact]
        public void LoadingThisRunsOwnSaveFromBeforeALaterSaveKeepsTheHistoryBeforeIt()
        {
            using var engine = NewEngine(out _);
            try
            {
                Tick(engine, 0.0);
                Tick(engine, 5.0);
                var quicksave = Written(engine);
                engine.NoteSaved(quicksave, null, 5.0, token: "quicksave");
                Tick(engine, 8.0);
                engine.NoteSaved(Written(engine), null, 8.0, token: "vessel-switch");
                Tick(engine, 10.0);

                engine.NoteLoadStarted();
                engine.NoteGameLoaded(quicksave, savedUt: 5.0, token: "quicksave");
                Tick(engine, 5.0);

                Assert.Equal(5.0, engine.LastTimelineResetUtForTests);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A save from a stretch the timeline has since rewound past holds history
        /// that is no longer in the archive, so loading it starts afresh.
        /// </summary>
        [Fact]
        public void LoadingASaveFromAnAbandonedStretchStartsAFreshTimeline()
        {
            using var engine = NewEngine(out _);
            try
            {
                Tick(engine, 0.0);
                Tick(engine, 10.0);
                var quicksave = Written(engine);
                engine.NoteSaved(quicksave, null, 10.0, token: "quicksave");
                Tick(engine, 12.0);
                Tick(engine, 2.0);
                Tick(engine, 6.0);

                engine.NoteLoadStarted();
                engine.NoteGameLoaded(quicksave, savedUt: 10.0, token: "quicksave");
                Tick(engine, 10.0);

                Assert.Equal(double.NegativeInfinity, engine.LastTimelineResetUtForTests);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// F5, revert, fly a little, F9: the quicksave is this run's latest save, and
        /// UT moves forward from the reverted flight to it. The load still starts a
        /// timeline, and the command the quicksave carries comes back and runs.
        /// </summary>
        [Fact]
        public void AForwardLoadOfThisRunsLatestSaveStartsATimelineAndRestoresWhatItCarried()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                Tick(engine, 0.0);
                var atLaunch = Written(engine);
                Tick(engine, 8.0);
                Dispatch(engine, out _);
                Tick(engine, 9.0);
                var quicksave = Written(engine);
                engine.NoteSaved(quicksave, null, 9.0, token: "quicksave");
                Tick(engine, 10.0);

                engine.NoteLoadStarted();
                engine.NoteGameLoaded(atLaunch, savedUt: 0.0);
                Tick(engine, 0.0);
                Tick(engine, 5.0);
                Assert.Equal(0, uplink.Runs);
                var resetsBefore = engine.TimelineResetsForTests;

                engine.NoteLoadStarted();
                engine.NoteSaveReloaded(quicksave, null, 9.0, token: "quicksave");
                Tick(engine, 9.0);
                Assert.Equal(resetsBefore + 1, engine.TimelineResetsForTests);
                Assert.Equal(double.NegativeInfinity, engine.LastTimelineResetUtForTests);
                Tick(engine, 13.0);
                Tick(engine, 30.0);

                Assert.Equal(1, uplink.Runs);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>A scene change reloads the latest save with no mark, and starts nothing.</summary>
        [Fact]
        public void ASceneRoundTripStartsNoTimeline()
        {
            using var engine = NewEngine(out _);
            try
            {
                Tick(engine, 0.0);
                Tick(engine, 9.0);
                var save = Written(engine);
                engine.NoteSaved(save, null, 9.0, token: "scene");
                var resetsBefore = engine.TimelineResetsForTests;

                engine.NoteSaveReloaded(save, null, 9.0, token: "scene");
                Tick(engine, 9.5);

                Assert.Equal(resetsBefore, engine.TimelineResetsForTests);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A mark the scenario never answers (a revert to the editor, which loads no
        /// flight scenario) gives way, and the clock having gone back while it was
        /// held still starts a timeline, at the earliest UT seen meanwhile.
        /// </summary>
        [Fact]
        public void AnAbandonedMarkLetsTheClockGoingBackStartATimeline()
        {
            using var engine = NewEngine(out _);
            try
            {
                Tick(engine, 0.0);
                Tick(engine, 10.0);
                var resetsBefore = engine.TimelineResetsForTests;

                engine.NoteLoadStarted();
                Tick(engine, 2.0);
                Tick(engine, 3.0);
                Assert.Equal(resetsBefore, engine.TimelineResetsForTests);
                engine.NoteLoadAbandoned();
                Tick(engine, 3.5);

                Assert.Equal(resetsBefore + 1, engine.TimelineResetsForTests);
                Assert.Equal(2.0, engine.LastTimelineResetUtForTests);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static ChannelEngine NewEngine(out LiveCommandTestUplink uplink)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            uplink = new LiveCommandTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            return engine;
        }

        private static DeliverySnapshot Written(ChannelEngine engine) =>
            DeliverySnapshotCodec.Decode(DeliverySnapshotCodec.Encode(engine.DeliverySnapshotNow()))!;

        private static List<object?> Dispatch(ChannelEngine engine, out List<FaultCode> refusals)
        {
            var answers = new List<object?>();
            var refused = new List<FaultCode>();
            engine.DispatchCommandAndWait(
                LiveCommandTestUplink.Command,
                "x",
                "KSC",
                answers.Add,
                Timeout,
                onRefused: (code, _) => refused.Add(code));
            refusals = refused;
            return answers;
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, LiveCommandTestUplink.Snapshot(ut), Timeout);

        private sealed class LiveCommandTestUplink : ISitrepUplink
        {
            public const string Command = "load-marker-test.run";
            private const string Topic = "load-marker-test.state";

            private int _runs;

            public int Runs => Volatile.Read(ref _runs);

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "load-marker-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
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
                    Interlocked.Increment(ref _runs);
                    return "ran:" + args;
                });
                host.SetConnectivitySource(_ => true);
                host.SetSignalDelaySource(_ => new CommsDelay
                {
                    OneWaySeconds = Delay,
                    Source = CommsDelaySource.SignalDelay,
                });
            }

            public static KspSnapshot Snapshot(double ut) =>
                new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() };
        }
    }
}
