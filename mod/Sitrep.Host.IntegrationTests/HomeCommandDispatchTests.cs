using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command addressed to the home command's ledger from a vessel vantage is
    /// refused exactly when that vessel cannot reach the ground network, and
    /// never because the one station named home is out of its reach.
    /// </summary>
    public class HomeCommandDispatchTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Settle = TimeSpan.FromMilliseconds(300);

        private const string Vessel = "vessel:G";
        private const double ActiveVesselDelay = 240.0;

        /// <summary>
        /// A vessel whose route reaches no ground station cannot reach the ledger,
        /// and its spend is dropped at dispatch the way a command into any dead
        /// link is: never executed, never answered.
        /// </summary>
        [Fact]
        public void ASpendFromAVesselThatReachesNoGroundStationIsDropped()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HomeSpendTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.SetHomeCommandDelay(Vessel, 3.0);
                engine.SetOffTheGroundNetwork(new[] { Vessel });
                engine.TickAndWait(0.0, HomeLedgerTestUplink.Snapshot(0.0, ledger: 10.0, delay: ActiveVesselDelay), Timeout);

                var resolved = false;
                double? flightTime = null;
                engine.DispatchCommandAndWait(
                    HomeSpendTestUplink.Command,
                    "funds",
                    Vessel,
                    _ => resolved = true,
                    Settle,
                    onAccepted: seconds => flightTime = seconds);

                Tick(engine, 100.0);

                Assert.Equal(0, uplink.HandledCount);
                Assert.False(resolved);
                Assert.Null(flightTime);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The other side of the same rule: a vessel whose route ends at a ground
        /// station that is not the home centre still reaches the ledger, because
        /// every station carries it. Only being named off the ground network
        /// drops a spend, and a vantage that stops being named is heard again.
        /// </summary>
        [Fact]
        public void ASpendFromAVesselReachingAnyGroundStationIsCarried()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HomeSpendTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.SetHomeCommandDelay(Vessel, 3.0);
                engine.SetOffTheGroundNetwork(new[] { Vessel });
                engine.SetOffTheGroundNetwork(Array.Empty<string>());
                engine.TickAndWait(0.0, HomeLedgerTestUplink.Snapshot(0.0, ledger: 10.0, delay: ActiveVesselDelay), Timeout);

                engine.DispatchCommandAndWait(HomeSpendTestUplink.Command, "funds", Vessel, _ => { }, Settle);
                Tick(engine, 3.0);

                Assert.Equal(1, uplink.HandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Being off the ground network is about reaching the ledger, not about
        /// the vantage: the same vessel can still command a subject that is not
        /// held at home.
        /// </summary>
        [Fact]
        public void BeingOffTheGroundNetworkDoesNotDropACommandToAnotherSubject()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new HomeSpendTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.SetOffTheGroundNetwork(new[] { Vessel });
                engine.TickAndWait(0.0, HomeLedgerTestUplink.Snapshot(0.0, ledger: 10.0, delay: 0.0), Timeout);

                engine.DispatchCommandAndWait(HomeSpendTestUplink.CraftCommand, "x", Vessel, _ => { }, Settle);
                engine.TickAndWait(1.0, HomeLedgerTestUplink.Snapshot(1.0, ledger: 10.0, delay: 0.0), Timeout);

                Assert.Equal(1, uplink.CraftHandledCount);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, HomeLedgerTestUplink.Snapshot(ut, ledger: 10.0, delay: ActiveVesselDelay), Timeout);
    }

    /// <summary>
    /// A ledger topic held at home and a spend whose subject is it, declared
    /// the way a career command is, beside one command on the active craft.
    /// </summary>
    internal sealed class HomeSpendTestUplink : ISitrepUplink
    {
        public const string Command = "home.spend";
        public const string CraftCommand = "home.craftCommand";

        private int _handled;
        private int _craftHandled;

        public int HandledCount => Volatile.Read(ref _handled);

        public int CraftHandledCount => Volatile.Read(ref _craftHandled);

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "home-spend-test",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = HomeLedgerTestUplink.LedgerTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                    HeldAtHome = true,
                },
                new ChannelDeclaration
                {
                    Topic = HomeLedgerTestUplink.CraftTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                },
            },
            Commands = new List<CommandDeclaration>
            {
                new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = HomeLedgerTestUplink.LedgerTopic },
                new CommandDeclaration { Command = CraftCommand, Delay = DelayRole.Delayed, Subject = HomeLedgerTestUplink.CraftTopic },
            },
        };

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(HomeLedgerTestUplink.LedgerTopic, snapshot =>
                snapshot != null && snapshot.Values.TryGetValue("ledger", out var value) ? value : null);
            host.AddChannelSource(HomeLedgerTestUplink.CraftTopic, snapshot =>
                snapshot != null && snapshot.Values.TryGetValue("craft", out var value) ? value : null);
            host.AddCommandHandler<string, string>(Command, args =>
            {
                Interlocked.Increment(ref _handled);
                return "spent:" + args;
            });
            host.AddCommandHandler<string, string>(CraftCommand, args =>
            {
                Interlocked.Increment(ref _craftHandled);
                return "done:" + args;
            });
            host.SetSignalDelaySource(snapshot =>
                snapshot != null && snapshot.Values.TryGetValue("delay", out var value) && value is double seconds
                    ? new CommsDelay { OneWaySeconds = seconds, Source = CommsDelaySource.SignalDelay }
                    : null);
        }
    }
}
