using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Isru;

namespace Gonogo.KSP
{
    /// <summary>
    /// The bundled CORE ISRU registration: the resource-ops analogue of
    /// <see cref="ReliabilityCoreUplink"/>. It OWNS the exclusive <c>"isru"</c>
    /// capability (registering <see cref="StockIsruBackend"/> as the always-present
    /// Vanilla factory), declares the two <c>isru.*</c> channels ONCE, and sources
    /// them from whichever backend the election picked: resolved at capture time
    /// via <c>host.Kernel.Query&lt;IIsruBackend&gt;("isru")</c>. A modelling mod
    /// registers a provider from its OWN uplink's Register and declares neither
    /// channel itself; that is the shared-namespace-single-declaration rule
    /// comms.*/reliability.*/science.* all follow.
    ///
    /// <para>The capture/handle split is load-bearing, not ceremony. Both backend
    /// readers walk live PartModules, which is only legal on the main thread, while
    /// a channel mapper runs on the Courier thread. So the reads happen in
    /// <see cref="CaptureOnMain"/> and the publish, which touches no KSP at all,
    /// happens in <see cref="HandleOnCourier"/>.</para>
    /// </summary>
    [SitrepUplink("isru")]
    public sealed class IsruCoreUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        public const string DrillsTopic = "isru.drills";
        public const string ConvertersTopic = "isru.converters";

        private IChannelPublisher? _drills;
        private IChannelPublisher? _converters;
        private Kernel? _kernel;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "isru",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Delayed(DrillsTopic),
                Delayed(ConvertersTopic),
            },
        };

        private static ChannelDeclaration Delayed(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            // Vessel-sourced part state, so it rides the light-time delay clock like
            // every other readout that comes off the craft.
            Delay = DelayRole.Delayed,
        };

        /// <summary>
        /// Declared HERE in the pre-Register capability pass (same two-pass fix as
        /// CommsCoreUplink/ReliabilityCoreUplink), so the capability exists before
        /// any provider uplink's Register runs: a provider registration can never
        /// race ahead of this declaration regardless of assembly-scan order.
        /// </summary>
        public void DeclareCapabilities(Kernel kernel) =>
            IsruElection.RegisterCapability(kernel, _ => new StockIsruBackend());

        public void Register(IUplinkHost host)
        {
            _kernel = host.Kernel;
            _drills = host.Publisher(DrillsTopic);
            _converters = host.Publisher(ConvertersTopic);
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, DrillsTopic, ConvertersTopic);
        }

        /// <summary>MAIN-THREAD capture: resolve the elected backend and walk its part modules (live KSP, safe here).</summary>
        private object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var backend = _kernel != null ? IsruElection.Elected(_kernel) : null;
            if (backend == null)
            {
                return null; // election not resolved yet (pre-flight)
            }

            try
            {
                return new IsruCapture
                {
                    Ut = snapshot?.Ut ?? 0.0,
                    Drills = new List<IsruDrillEntry>(backend.Drills()),
                    Converters = new List<IsruConverterEntry>(backend.Converters()),
                };
            }
            catch (Exception)
            {
                // NULL-SAFE: a backend read that threw on a transient/unloaded vessel
                // yields no ISRU capture THIS tick (last-known stays), retried next
                // tick: never fail-softs the whole uplink.
                return null;
            }
        }

        /// <summary>COURIER-THREAD handle: publish the captured payloads. No KSP access.</summary>
        private void HandleOnCourier(object? captured)
        {
            if (captured is not IsruCapture capture)
            {
                return;
            }

            _drills?.Publish(capture.Drills, capture.Ut);
            _converters?.Publish(capture.Converters, capture.Ut);
        }

        public UplinkHealth Health() =>
            _kernel != null && IsruElection.Elected(_kernel) != null
                ? UplinkHealth.Healthy
                : new UplinkHealth(UplinkHealthState.Unavailable, "isru capability not resolved");

        private sealed class IsruCapture
        {
            public double Ut;
            public List<IsruDrillEntry> Drills = new();
            public List<IsruConverterEntry> Converters = new();
        }
    }
}
