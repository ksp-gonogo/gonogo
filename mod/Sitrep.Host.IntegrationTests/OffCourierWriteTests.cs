using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A vessel's delay and a dynamic topic's declaration live in maps the
    /// Courier reads mid-tick without a lock. An Uplink that sets either from a
    /// game event, on the main thread, has the write handed to the Courier
    /// rather than racing it.
    /// </summary>
    public class OffCourierWriteTests
    {
        private const string Probe = "probe";

        [Fact]
        public void ADelayAndADynamicTopicSetOffTheCourierWaitForIt()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new ParkingUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            var node = ChannelEngine.FleetNodePrefix + Probe;
            var topic = ParkingUplink.Prefix + Probe + ".science";
            try
            {
                engine.TickAndWait(1.0, null, TestBudgets.Op);
                uplink.Park = true;
                engine.Tick(2.0, null);
                Assert.True(uplink.Parked.Wait(TestBudgets.Op), "the Courier never reached the parking handle");

                engine.SetVesselDelay(Probe, 7.0);
                uplink.Events!.Publisher(Probe + ".science");

                Assert.Equal(0.0, engine.LedgerDelayFor("KSC", node));
                Assert.Null(engine.DeclarationOf(topic));

                uplink.Release.Set();
                engine.TickAndWait(3.0, null, TestBudgets.Op);

                Assert.Equal(7.0, engine.LedgerDelayFor("KSC", node));
                Assert.NotNull(engine.DeclarationOf(topic));
            }
            finally
            {
                uplink.Release.Set();
                engine.Stop();
            }
        }

        /// <summary>A dynamic namespace whose Courier-side handle can be made to wait, holding the Courier still.</summary>
        private sealed class ParkingUplink : ISitrepUplink
        {
            public const string Prefix = "parking.";

            private volatile bool _park;

            public bool Park
            {
                get => _park;
                set => _park = value;
            }

            public ManualResetEventSlim Parked { get; } = new ManualResetEventSlim(false);

            public ManualResetEventSlim Release { get; } = new ManualResetEventSlim(false);

            public IDynamicChannelSource? Events { get; private set; }

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "parking-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>(),
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                Events = host.RegisterDynamicNamespace(Prefix, new ChannelDeclaration
                {
                    Kind = SampleKind.Event,
                    Delivery = Delivery.ReliableOrdered,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                });
                host.AddSampledSource(_ => null, _ =>
                {
                    if (!_park)
                    {
                        return;
                    }
                    _park = false;
                    Parked.Set();
                    Release.Wait();
                });
            }
        }
    }
}
