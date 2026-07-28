using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Reliability;

namespace Gonogo.KSP
{
    /// <summary>
    /// The bundled CORE reliability registration: the reliability analogue of
    /// <see cref="CommsCoreUplink"/>. It OWNS the exclusive <c>"reliability"</c>
    /// capability (registering <see cref="NoneReliabilityBackend"/> as the
    /// always-present Vanilla factory), declares the two <c>reliability.*</c>
    /// channels ONCE, and sources them from whichever backend the election
    /// picked: resolved at capture time via
    /// <c>host.Kernel.Query&lt;IReliabilityBackend&gt;("reliability")</c>. Neither
    /// Kerbalism nor TestFlight declares these channels itself; that is the
    /// shared-namespace-single-declaration rule (same as comms.*).
    ///
    /// <para>Providers register from their OWN uplink's Register:
    /// GonogoKerbalismUplink (Priority 1, reports Unmodeled when
    /// Features.Reliability off) and GonogoTestFlightUplink (Priority 10,
    /// engine-authoritative: wins under RO). Under RO only TestFlight is live;
    /// in stock Kerbalism only Kerbalism is live; both-registered resolves by
    /// priority in the Kernel, never in the client.</para>
    /// </summary>
    [SitrepUplink("reliability")]
    public sealed class ReliabilityCoreUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        public const string SummaryTopic = "reliability.summary";
        public const string PartsTopic = "reliability.parts";

        private IChannelPublisher? _summary;
        private IChannelPublisher? _parts;
        private Kernel? _kernel;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "reliability",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Delayed(SummaryTopic),
                Delayed(PartsTopic),
            },
        };

        private static ChannelDeclaration Delayed(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            Delay = DelayRole.Delayed,
        };

        /// <summary>
        /// Declared HERE in the pre-Register capability pass (two-pass fix, same as
        /// CommsCoreUplink), so the capability exists before any provider uplink's
        /// Register runs, a Kerbalism/TestFlight provider registration can never
        /// race ahead of this declaration regardless of assembly-scan order.
        /// </summary>
        public void DeclareCapabilities(Kernel kernel) => ReliabilityElection.RegisterCapability(kernel);

        public void Register(IUplinkHost host)
        {
            _kernel = host.Kernel;
            _summary = host.Publisher(SummaryTopic);
            _parts = host.Publisher(PartsTopic);
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, SummaryTopic, PartsTopic);
        }

        /// <summary>MAIN-THREAD capture: resolve the elected backend and read its readouts (live KSP, safe here).</summary>
        private object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var backend = _kernel != null ? ReliabilityElection.Elected(_kernel) : null;
            if (backend == null)
            {
                return null; // election not resolved yet (pre-flight)
            }
            try
            {
                return new ReliabilityCapture
                {
                    Ut = snapshot?.Ut ?? 0.0,
                    Summary = backend.Summary(),
                    Parts = new List<ReliabilityPartEntry>(backend.Parts()),
                };
            }
            catch (Exception)
            {
                // NULL-SAFE: a backend read that threw on a transient/unloaded vessel
                // yields no reliability capture THIS tick (last-known stays), retried
                // next tick: never fail-softs the whole uplink.
                return null;
            }
        }

        /// <summary>COURIER-THREAD handle: publish the captured payloads. No KSP access.</summary>
        private void HandleOnCourier(object? captured)
        {
            if (captured is not ReliabilityCapture capture)
            {
                return;
            }
            _summary?.Publish(capture.Summary, capture.Ut);
            _parts?.Publish(capture.Parts, capture.Ut);
        }

        public UplinkHealth Health() =>
            _kernel != null && ReliabilityElection.Elected(_kernel) != null
                ? UplinkHealth.Healthy
                : new UplinkHealth(UplinkHealthState.Unavailable, "reliability capability not resolved");

        private sealed class ReliabilityCapture
        {
            public double Ut;
            public ReliabilitySummary Summary = new();
            public List<ReliabilityPartEntry> Parts = new();
        }
    }
}
