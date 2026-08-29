// mod/GonogoTestFlightUplink/TestFlightUplink.cs
// The [SitrepUplink("testflight")] uplink: a client-less reliability PROVIDER.
// It declares NO channels of its own - TestFlight's presence is conveyed by
// system.uplinks health (Health() below) and by reliability.summary.source ==
// "testflight" once its provider wins the election, so a dedicated
// testflight.available topic (and a client package to register it) would be
// pure overhead for a provider with no widget.
//
// It does NOT declare the "reliability" capability or the reliability.* channels
// - the shared reliability core registrar owns those (mirroring how a core
// capability registrar owns a capability while a mod uplink only registers a
// provider). Registering the provider IS the election gate, done in Register
// (the capability is declared in the earlier discovery pass), gated on the
// TestFlight probe.
using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoTestFlightUplink
{
    [SitrepUplink("testflight")]
    public sealed class TestFlightUplink : ISitrepUplink
    {
        private readonly TestFlightReflection _tf = new();

        /// <summary>
        /// Why the provider is not registered, when registration itself threw. The
        /// Kernel emits NO notice for a provider that never registered, so this
        /// uplink's own Health() is the only route by which "registration threw" is
        /// distinguishable from "the mod is not installed".
        /// </summary>
        private string? _registrationError;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "testflight",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>(),
        };

        public void Register(IUplinkHost host)
        {
            // Register the TestFlight reliability provider ONLY when TestFlight is
            // actually loaded - registering IS the election gate (same as the other
            // capability providers). Priority 10 > the fallback provider's 1, so
            // TestFlight WINS under RO/RP-1 where both are live. Wrapped so a
            // registration failure is surfaced, not swallowed.
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
                    // UnityEngine.Debug, not Console.Error: the latter is invisible
                    // in KSP, which is how a silently-dropped provider looked
                    // identical to an uninstalled mod.
                    _registrationError = ex.Message;
                    UnityEngine.Debug.LogError(
                        "[Gonogo] TestFlightUplink could not register reliability provider: " + ex.Message);
                }
            }
        }

        public UplinkHealth Health()
        {
            if (!_tf.IsAvailable)
            {
                return new UplinkHealth(UplinkHealthState.Unavailable, "TestFlight assembly not loaded");
            }
            if (_registrationError != null)
            {
                return new UplinkHealth(
                    UplinkHealthState.Degraded,
                    "reliability provider registration threw: " + _registrationError);
            }
            return UplinkHealth.Healthy;
        }
    }
}
