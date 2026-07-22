// mod/GonogoTestFlightUplink/TestFlightUplink.cs
// The [SitrepUplink("testflight")] uplink: presence-gate topic + mandatory
// health + registration of the TestFlight reliability backend at Priority 10.
//
// It does NOT declare the "reliability" capability or the reliability.* channels
// - agent-6's ReliabilityCoreUplink owns those (mirroring how CommsCoreUplink
// owns "comms" while RealAntennasUplink only registers a provider). Registering
// the provider IS the election gate, done in Register (the capability is
// declared in the earlier discovery pass), gated on the TestFlight probe.
using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoTestFlightUplink
{
    [SitrepUplink("testflight")]
    public sealed class TestFlightUplink : ISitrepUplink
    {
        private const string AvailableTopic = "testflight.available";
        private readonly TestFlightReflection _tf = new();

        public UplinkManifest Manifest { get; }

        public TestFlightUplink()
        {
            Manifest = new UplinkManifest
            {
                Id = "testflight",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    // Ground-side fact (is TestFlight installed) - true-now, bare boolean,
                    // bypasses the delay clock. The reliability.* vessel telemetry is
                    // Delayed and declared by the reliability core uplink, not here.
                    new ChannelDeclaration
                    {
                        Topic = AvailableTopic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.TrueNow,
                    },
                },
            };
        }

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(AvailableTopic, _ => _tf.IsAvailable);

            // Register the TestFlight reliability provider ONLY when TestFlight is
            // actually loaded - registering IS the election gate (same as RA/comms).
            // Priority 10 > Kerbalism's 1, so TestFlight WINS under RO/RP-1 where both
            // are live. Wrapped so a registration failure is surfaced, not swallowed,
            // and the uplink still emits testflight.available.
            if (_tf.IsAvailable)
            {
                try
                {
                    host.Kernel.RegisterProvider(new ProviderRegistration
                    {
                        Capability = "reliability",
                        Id = "testflight",
                        Priority = 10.0,
                        Factory = _ => new TestFlightReliabilityBackend(_tf),
                    });
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("[TestFlightUplink] could not register reliability provider: " + ex.Message);
                }
            }
        }

        public UplinkHealth Health() =>
            _tf.IsAvailable
                ? UplinkHealth.Healthy
                : new UplinkHealth(UplinkHealthState.Unavailable, "TestFlight assembly not loaded");
    }
}
