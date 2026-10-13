using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The delay the engine holds for a craft that is out of contact belongs to
    /// that craft. A different craft that comes up dark has never been heard, so
    /// it is not held at the light-time the previous one last had.
    /// </summary>
    public class ActiveVesselSwitchDelayTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private const string VesselA = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string VesselB = "bbbbbbbb-0000-0000-0000-000000000000";
        private const string Vantage = "ground:Kerbal Space Center";

        private static KspSnapshot Snapshot(double ut, string vesselId, double? delay, bool connected) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = vesselId, ["name"] = vesselId },
                },
                ["delay"] = delay,
                ["connected"] = connected,
            },
        };

        [Fact]
        public void ACraftThatComesUpDarkIsNotHeldAtThePreviousCraftsDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new PathUplink());
            engine.Start();
            try
            {
                engine.TickAndWait(1.0, Snapshot(1.0, VesselA, 45.0, connected: true), Timeout);
                engine.TickAndWait(2.0, Snapshot(2.0, VesselA, 45.0, connected: true), Timeout);
                Assert.Equal(45.0, engine.LedgerDelayFor(Vantage, ChannelEngine.NodeId));

                engine.TickAndWait(3.0, Snapshot(3.0, VesselB, null, connected: false), Timeout);

                Assert.Equal(0.0, engine.LedgerDelayFor(Vantage, ChannelEngine.NodeId));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACraftThatGoesDarkIsStillHeldAtItsOwnLastDelay()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new PathUplink());
            engine.Start();
            try
            {
                engine.TickAndWait(1.0, Snapshot(1.0, VesselA, 45.0, connected: true), Timeout);
                engine.TickAndWait(2.0, Snapshot(2.0, VesselA, null, connected: false), Timeout);

                Assert.Equal(45.0, engine.LedgerDelayFor(Vantage, ChannelEngine.NodeId));
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class PathUplink : ISitrepUplink
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "switch-delay-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>(),
            };

            public void Register(IUplinkHost host)
            {
                host.SetSignalDelaySource(snapshot =>
                    new CommsDelay
                    {
                        OneWaySeconds = snapshot != null && snapshot.Values.TryGetValue("delay", out var raw) && raw != null
                            ? Convert.ToDouble(raw)
                            : (double?)null,
                        Source = CommsDelaySource.SignalDelay,
                    });
                host.SetConnectivitySource(snapshot =>
                    snapshot != null && snapshot.Values.TryGetValue("connected", out var raw) && raw != null
                        ? Convert.ToBoolean(raw)
                        : (bool?)null);
            }
        }
    }
}
