using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Core.StoreAndForward;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A delayed command on the live path, not held by store-and-forward, saved
    /// with the game while it is on its way. Sent at UT 0 with a five-second
    /// signal delay, it runs at 5 and its answer is home at 10.
    /// </summary>
    public class LivePathCommandLoadTests
    {
        private const double Delay = 5.0;

        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public void AQuickloadToASaveWrittenBeforeItRanRunsItOnceOnTheNewTimeline()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                Tick(engine, 0.0);
                var answers = Dispatch(engine, out var refusals);
                Tick(engine, 2.0);
                engine.NoteSaved(engine.DeliverySnapshotNow(), null, 2.0);
                Tick(engine, 7.0);
                Assert.Equal(1, uplink.Runs);

                Tick(engine, 2.0);
                Tick(engine, 4.9);
                Assert.Equal(1, uplink.Runs);
                Tick(engine, 5.0);
                Assert.Equal(2, uplink.Runs);
                Tick(engine, 10.0);
                Tick(engine, 30.0);

                Assert.Equal(2, uplink.Runs);
                Assert.Equal(new object?[] { "ran:x" }, answers);
                Assert.Empty(refusals);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AQuickloadToASaveWrittenAfterItRanDoesNotRunItAgain()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                Tick(engine, 0.0);
                var answers = Dispatch(engine, out var refusals);
                Tick(engine, 6.0);
                Assert.Equal(1, uplink.Runs);
                engine.NoteSaved(engine.DeliverySnapshotNow(), null, 6.0);
                Tick(engine, 8.0);

                Tick(engine, 6.0);
                Tick(engine, 9.9);
                Assert.Empty(answers);
                Tick(engine, 10.0);
                Tick(engine, 30.0);

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
        /// Loading a save from disk, rather than quickloading the one this
        /// process wrote, reads the command back from the save's own text.
        /// </summary>
        [Fact]
        public void ALoadedSaveCarriesTheCommandAndWhetherItHadRun()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                Tick(engine, 0.0);
                var answers = Dispatch(engine, out var refusals);
                Tick(engine, 6.0);
                var written = Written(engine);
                Tick(engine, 8.0);

                engine.NoteGameLoaded(written, savedUt: 6.0);
                Tick(engine, 6.0);
                Tick(engine, 10.0);
                Tick(engine, 30.0);

                Assert.Equal(1, uplink.Runs);
                Assert.Equal(new object?[] { "ran:x" }, answers);
                Assert.Empty(refusals);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void AQuickloadToASaveFromBeforeItWasSentUndoesIt()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                Tick(engine, 0.0);
                var carried = Dispatch(engine, out var carriedRefusals);
                Tick(engine, 1.0);
                engine.NoteSaved(engine.DeliverySnapshotNow(), null, 1.0);
                Tick(engine, 2.0);
                var sentLater = Dispatch(engine, out var sentLaterRefusals);
                Tick(engine, 3.0);

                Tick(engine, 1.0);
                Tick(engine, 30.0);

                Assert.Equal(1, uplink.Runs);
                Assert.Equal(new object?[] { "ran:x" }, carried);
                Assert.Empty(carriedRefusals);
                Assert.Empty(sentLater);
                Assert.Equal(new[] { FaultCode.UndoneByLoad }, sentLaterRefusals);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A revert to launch loads the game as it was saved at launch, which
        /// carries nothing sent since.
        /// </summary>
        [Fact]
        public void ARevertToLaunchUndoesWhatWasSentSinceLaunch()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                Tick(engine, 0.0);
                var atLaunch = Written(engine);
                Tick(engine, 20.0);
                var answers = Dispatch(engine, out var refusals);
                Tick(engine, 22.0);

                engine.NoteGameLoaded(atLaunch, savedUt: 0.0);
                Tick(engine, 0.0);
                Tick(engine, 60.0);

                Assert.Equal(0, uplink.Runs);
                Assert.Empty(answers);
                Assert.Equal(new[] { FaultCode.UndoneByLoad }, refusals);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ALoadOfASaveThatCarriedNoSnapshotRestoresNothing()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                Tick(engine, 0.0);
                var answers = Dispatch(engine, out var refusals);
                Tick(engine, 2.0);

                engine.NoteGameLoaded(null, savedUt: 2.0);
                Tick(engine, 2.0);
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
        /// The game is quit and started again, so the request that sent the
        /// command died with the old process. The client reconnected while the
        /// game loaded, and its answer reaches it on the new connection, by the
        /// request id it chose.
        /// </summary>
        [Fact]
        public async Task AfterARestartTheAnswerReachesTheClientThatReconnected()
        {
            DeliverySnapshot written;
            using (var before = NewEngine(out var beforeUplink))
            {
                try
                {
                    await using var client = await TestClient.ConnectAsync(before.BoundPort, Timeout);
                    Tick(before, 0.0);
                    await SendCommandAsync(client, "client-1");
                    await ReceiveTypedAsync<CommandAccepted>(client, Timeout);
                    Tick(before, 2.0);
                    written = Written(before);
                    Assert.Equal(0, beforeUplink.Runs);
                }
                finally
                {
                    before.Stop();
                }
            }

            using var after = NewEngine(out var afterUplink);
            try
            {
                await using var reconnected = await TestClient.ConnectAsync(after.BoundPort, Timeout);
                after.NoteGameLoaded(written, savedUt: 2.0);
                Tick(after, 2.0);
                Tick(after, 5.0);
                Assert.Equal(1, afterUplink.Runs);
                Tick(after, 10.0);

                var answer = await ReceiveTypedAsync<CommandResponse<object?>>(reconnected, Timeout);
                Assert.Equal("client-1", answer.RequestId);
                Assert.Equal("ran:x", answer.Result);
            }
            finally
            {
                after.Stop();
            }
        }

        /// <summary>
        /// A client whose connection closed while its command was on its way
        /// finds the answer on its next connection, and so does any client that
        /// sits down at that centre afterwards; one that never sent that
        /// request id ignores it.
        /// </summary>
        [Fact]
        public async Task AnAnswerForAClosedConnectionIsSentToTheNextConnectionAtThatCentre()
        {
            using var engine = NewEngine(out var uplink);
            try
            {
                Tick(engine, 0.0);
                var first = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SendCommandAsync(first, "client-2");
                await ReceiveTypedAsync<CommandAccepted>(first, Timeout);
                await first.DisposeAsync();
                await WaitForAsync(() => engine.SessionCountForTests == 0);

                Tick(engine, 10.0);
                Assert.Equal(1, uplink.Runs);

                await using var next = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                var answer = await ReceiveTypedAsync<CommandResponse<object?>>(next, Timeout);
                Assert.Equal("client-2", answer.RequestId);
                Assert.Equal("ran:x", answer.Result);
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

        /// <summary>What a save writes and a later load of it reads back.</summary>
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

        private static Task SendCommandAsync(TestClient client, string requestId) =>
            client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = requestId,
                Command = LiveCommandTestUplink.Command,
                Args = "x",
                SentAt = 0.0,
            }));

        private static async Task WaitForAsync(Func<bool> condition)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (!condition())
            {
                if (DateTime.UtcNow > deadline)
                {
                    throw new TimeoutException("The engine did not see the connection close within " + Timeout + ".");
                }
                await Task.Delay(10);
            }
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, LiveCommandTestUplink.Snapshot(ut), Timeout);

        /// <summary>One delayed command addressed to no craft, so it travels the live path.</summary>
        private sealed class LiveCommandTestUplink : ISitrepUplink
        {
            public const string Command = "live-load-test.run";
            private const string Topic = "live-load-test.state";

            private int _runs;

            public int Runs => Volatile.Read(ref _runs);

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "live-load-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
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
