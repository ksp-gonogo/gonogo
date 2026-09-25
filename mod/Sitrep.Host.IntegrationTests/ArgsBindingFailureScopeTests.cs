using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A call whose args cannot bind to the command's declared args type is the
    /// caller's mistake: it is refused as malformed for that call alone, the
    /// handler never runs, and the command answers the next well-formed call.
    ///
    /// <para>Binding used to run inside the handler, so a malformed call counted
    /// as a handler failure and refused the command for the rest of the
    /// session.</para>
    /// </summary>
    public class ArgsBindingFailureScopeTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private sealed class Outcome
        {
            public bool Resolved;
            public object? Result;
            public string? Refusal;
            public string? Malformed;
        }

        private static Outcome Dispatch(ChannelEngine engine, string command, object? args)
        {
            var outcome = new Outcome();
            engine.DispatchCommandAndWait(
                command, args, "vantage-1",
                r => { outcome.Resolved = true; outcome.Result = r; },
                Timeout,
                onRefused: reason => outcome.Refusal = reason,
                onMalformed: reason => outcome.Malformed = reason);
            return outcome;
        }

        /// <summary>A number where the args record declares a string.</summary>
        private static Dictionary<string, object?> Malformed() =>
            new Dictionary<string, object?> { ["editor"] = 3.0 };

        private static Dictionary<string, object?> WellFormed() =>
            new Dictionary<string, object?> { ["editor"] = "VAB" };

        [Fact]
        public void AMalformedCallIsRefusedAloneAndTheNextWellFormedCallRuns()
        {
            var uplink = new ProbeUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                var bad = Dispatch(engine, ProbeUplink.Revert, Malformed());

                Assert.False(bad.Resolved);
                Assert.Null(bad.Refusal);
                Assert.NotNull(bad.Malformed);
                Assert.Contains(ProbeUplink.Revert, bad.Malformed);
                Assert.Contains(nameof(RevertToEditorArgs), bad.Malformed);
                Assert.Equal(0, uplink.RevertRuns);

                var good = Dispatch(engine, ProbeUplink.Revert, WellFormed());

                Assert.Null(good.Refusal);
                Assert.Null(good.Malformed);
                Assert.Equal("reverted to VAB", good.Result);
                Assert.Equal(1, uplink.RevertRuns);
                Assert.True(engine.AvailabilityOf(ProbeUplink.UplinkId).IsAvailable);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// Refused at dispatch, so a delayed command's malformed call is answered
        /// at once rather than after its light-time, and never reaches the Courier.
        /// </summary>
        [Fact]
        public void AMalformedDelayedCallIsRefusedAtDispatchAndTheCommandStaysUp()
        {
            var uplink = new ProbeUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 5);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                var bad = Dispatch(engine, ProbeUplink.DelayedRevert, Malformed());
                Assert.NotNull(bad.Malformed);
                Assert.Contains(ProbeUplink.DelayedRevert, bad.Malformed);

                var good = Dispatch(engine, ProbeUplink.DelayedRevert, WellFormed());
                engine.TickAndWait(20.0, null, Timeout);

                Assert.Null(good.Refusal);
                Assert.Equal("reverted to VAB", good.Result);
                Assert.Equal(1, uplink.RevertRuns);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// Over the socket the malformed call gets an <c>invalid-envelope</c>
        /// error carrying its requestId, the same answer as any other unreadable
        /// command-request, and not the <c>E_UNAVAILABLE</c> an unavailable
        /// command gets.
        /// </summary>
        [Fact]
        public async Task OverTheWireAMalformedCallIsAnInvalidEnvelopeAndTheNextCallAnswers()
        {
            var uplink = new ProbeUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync(Request("r-bad", Malformed()));
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("invalid-envelope", error.Code);
                Assert.Equal("r-bad", error.RequestId);
                Assert.Contains(ProbeUplink.Revert, error.Message);

                await client.SendAsync(Request("r-good", WellFormed()));
                var response = await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);
                Assert.Equal("r-good", response.RequestId);
                Assert.Equal("reverted to VAB", response.Result);
            }
            finally { engine.Stop(); }
        }

        private static string Request(string requestId, object? args) =>
            EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = requestId,
                Command = ProbeUplink.Revert,
                Args = args,
                SentAt = 0.0,
            });

        private sealed class ProbeUplink : ISitrepUplink
        {
            public const string UplinkId = "test-args-binding";
            public const string Revert = "test.revertToEditor";
            public const string DelayedRevert = "test.revertToEditorDelayed";
            public const string Topic = "test.argsBinding.state";

            private int _revertRuns;

            public int RevertRuns => Volatile.Read(ref _revertRuns);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = UplinkId,
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Revert, Delay = DelayRole.TrueNow },
                    new CommandDeclaration { Command = DelayedRevert, Delay = DelayRole.Delayed, Subject = Topic },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<RevertToEditorArgs, string>(Revert, Run);
                host.AddCommandHandler<RevertToEditorArgs, string>(DelayedRevert, Run);
            }

            private string Run(RevertToEditorArgs args)
            {
                Interlocked.Increment(ref _revertRuns);
                return "reverted to " + args.Editor;
            }
        }
    }
}
