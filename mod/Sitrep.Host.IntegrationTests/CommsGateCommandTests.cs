using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The comms-loss UPLINK gate. The reveal gate already freezes the DOWNLINK
    /// on disconnect (see <c>RevealGateTests</c>); this proves the symmetric
    /// uplink rule: a DELAYED command (e.g. a kOS keystroke, a vessel actuation)
    /// dispatched while the vessel's comms link is DOWN must be dropped with
    /// honest silence — it must NEVER reach the CPU and never resolve, rather
    /// than being delivered after the light-time delay as if the blackout never
    /// happened. Regression for the live-observed bug where keystrokes still
    /// reached the in-game kOS terminal during a signal blackout.
    /// </summary>
    public class CommsGateCommandTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        [Fact]
        public void DelayedCommandDispatchedDuringCommsLossIsDroppedNeverReachingTheCpu()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 5);
            var uplink = new CommsGateTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                // Link DOWN: capture connectivity = false on the tick, exactly
                // what freezes the downlink reveal gate.
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: false), Timeout);

                var resolved = false;
                engine.DispatchCommandAndWait(
                    CommsGateTestUplink.Command,
                    "x",
                    "vantage-1",
                    _ => { resolved = true; },
                    TimeSpan.FromMilliseconds(300));

                // Advance well past the full round trip (2 * 5s). Honest silence:
                // the command is dropped at dispatch — it never reaches the CPU
                // and never resolves.
                engine.TickAndWait(20.0, FreezeGateTestUplink.Snapshot(20.0, connected: false), Timeout);

                Assert.Equal(0, uplink.HandledCount);
                Assert.False(
                    resolved,
                    "a delayed command dispatched during comms loss must be dropped (honest silence), never delivered on reconnect");
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void DelayedCommandWhileConnectedStillReachesTheCpuAfterTheDelay()
        {
            // The positive control: the gate must only drop during a blackout —
            // a normal connected dispatch still rides the light-time delay and
            // reaches the CPU once the round trip elapses.
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 5);
            var uplink = new CommsGateTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, FreezeGateTestUplink.Snapshot(0.0, connected: true), Timeout);

                engine.DispatchCommandAndWait(
                    CommsGateTestUplink.Command,
                    "x",
                    "vantage-1",
                    _ => { },
                    TimeSpan.FromMilliseconds(300));

                // Not yet — a delayed command rides the Courier's uplink delay.
                Assert.Equal(0, uplink.HandledCount);

                // After the uplink delay elapses, it reaches the CPU.
                engine.TickAndWait(10.0, FreezeGateTestUplink.Snapshot(10.0, connected: true), Timeout);
                Assert.Equal(1, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void DelayedCommandExecutesAfterTheLiveSignalDelayNotInstantly()
        {
            // The uplink asymmetry bug: a delayed command (a keystroke, a vessel
            // actuation) was delivered to the craft near-instantly — the Courier's
            // network delay defaults to 0 and the live signal delay was only ever
            // applied to the DOWNLINK reveal gate, never to command dispatch. The
            // command must reach the craft at t0 + the live one-way signal delay,
            // symmetric with the downlink. networkDelaySeconds:0 is the production
            // shape (see GonogoAddon).
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new CommsGateTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                const double signalDelay = 5.0;
                engine.TickAndWait(
                    0.0,
                    FreezeGateTestUplink.Snapshot(0.0, connected: true, delay: signalDelay),
                    Timeout);

                engine.DispatchCommandAndWait(
                    CommsGateTestUplink.Command, "x", "vantage-1", _ => { },
                    TimeSpan.FromMilliseconds(300));

                // At UT 2 (< the 5s signal delay) the command must NOT have
                // reached the craft yet — it rides the signal-delay uplink, not
                // the zero network delay.
                engine.TickAndWait(
                    2.0,
                    FreezeGateTestUplink.Snapshot(2.0, connected: true, delay: signalDelay),
                    Timeout);
                Assert.Equal(0, uplink.HandledCount);

                // At UT 5 (= the signal delay) it reaches the craft.
                engine.TickAndWait(
                    5.0,
                    FreezeGateTestUplink.Snapshot(5.0, connected: true, delay: signalDelay),
                    Timeout);
                Assert.Equal(1, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class CommsGateTestUplink : ISitrepUplink
        {
            public const string Command = "gate.keystroke";
            private int _handled;

            public int HandledCount => Volatile.Read(ref _handled);

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "comms-gate-test",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delayed = true },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    Interlocked.Increment(ref _handled);
                    return "pong:" + args;
                });
                host.SetConnectivitySource(ComputeConnected);
                // Same production-shape signal-delay source the bundled
                // CommsCoreUplink registers — reads a one-way delay off the
                // tick snapshot's "delay" key (absent ⇒ no delay).
                host.SetSignalDelaySource(ComputeDelay);
            }

            private static bool? ComputeConnected(KspSnapshot? snapshot)
            {
                if (snapshot == null
                    || !snapshot.Values.TryGetValue("connected", out var value)
                    || value == null)
                {
                    return null;
                }
                return Convert.ToBoolean(value);
            }

            private static CommsDelay? ComputeDelay(KspSnapshot? snapshot)
            {
                if (snapshot == null
                    || !snapshot.Values.TryGetValue("delay", out var value)
                    || value == null)
                {
                    return null;
                }
                return new CommsDelay
                {
                    OneWaySeconds = Convert.ToDouble(value),
                    Source = CommsDelaySource.SignalDelay,
                };
            }
        }
    }
}
