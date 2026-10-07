using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command the host has taken and then fails to carry is refused aloud.
    /// A dispatch that throws anywhere on its way through the host otherwise
    /// ends with no accept, no response and no error, which a client cannot
    /// tell from a command still in flight.
    /// </summary>
    public class DispatchFailureTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public void ADispatchThatThrowsIsRefusedAloudAndLeavesNothingPending()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 5);
            var uplink = new DelayedTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                FaultCode? code = null;
                string? refusal = null;
                engine.DispatchCommandAndWait(
                    DelayedTestUplink.Command, "x", "vantage-1",
                    _ => { },
                    Timeout,
                    onRefused: (c, reason) =>
                    {
                        code = c;
                        refusal = reason;
                    },
                    onAccepted: _ => throw new InvalidOperationException("the accept frame could not be written"));

                Assert.Equal(FaultCode.CommandUnavailable, code);
                Assert.NotNull(refusal);
                Assert.Contains(DelayedTestUplink.Command, refusal);
                Assert.Contains("the accept frame could not be written", refusal);
                Assert.Contains("it was not sent", refusal);
                Assert.Empty(Assert.IsType<PendingUplinkQueue>(engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending);

                engine.TickAndWait(20.0, null, Timeout);
                Assert.Equal(0, uplink.HandledCount);

                // As a throwing handler does, it leaves its command refused at once from then on, rather than failing the same way at every press.
                string? next = null;
                engine.DispatchCommandAndWait(
                    DelayedTestUplink.Command, "x", "vantage-1",
                    _ => { },
                    Timeout,
                    onRefused: (_, reason) => next = reason);
                Assert.NotNull(next);
                Assert.Contains("the accept frame could not be written", next);
            }
            finally { engine.Stop(); }
        }

        private sealed class DelayedTestUplink : ISitrepUplink
        {
            public const string Command = "dispatch-failure.ping";
            private const string Topic = "dispatch-failure.subject";
            private int _handled;

            public int HandledCount => Volatile.Read(ref _handled);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "dispatch-failure-test",
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
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = Topic },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Topic, _ => null);
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    Interlocked.Increment(ref _handled);
                    return "pong:" + args;
                });
            }
        }
    }
}
