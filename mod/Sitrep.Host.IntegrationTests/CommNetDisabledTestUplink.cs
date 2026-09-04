using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Comms;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// <c>Gonogo.KSP.CommsCoreUplink</c>'s registration shape, KSP-free: the
    /// exclusive <c>"comms"</c> capability, a true-now <c>comms.delay</c>, the
    /// freeze-exempt <c>comms.link</c> MetaTopic, one ordinary Delayed
    /// telemetry channel, and the two subscription-independent server-side
    /// seams (<see cref="IUplinkHost.SetSignalDelaySource"/> /
    /// <see cref="IUplinkHost.SetConnectivitySource"/>) sourced from the
    /// ELECTED backend rather than from the snapshot.
    ///
    /// <para>The backend is <see cref="DeadGraphBackend"/>: what stock reports
    /// once <c>CommNetScenario</c> has destroyed itself. Whether this save
    /// models comms at all is the constructor argument, standing in for the
    /// live difficulty read; everything downstream of it is the shipped
    /// <see cref="CommsModelPolicy"/>.</para>
    /// </summary>
    internal sealed class CommNetDisabledTestUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        internal const string DelayedTopic = "commnetoff.telemetry";

        private readonly bool? _modelPresent;
        private readonly SignalDelayConfig _authored =
            new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        private Kernel? _kernel;

        internal CommNetDisabledTestUplink(bool? modelPresent) => _modelPresent = modelPresent;

        public UplinkHealth Health() =>
            CommsHealth.Evaluate(_kernel != null && CommsElection.Elected(_kernel) != null, _modelPresent);

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "commnet-off-test",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = ChannelEngine.CommsDelayTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = ChannelEngine.ConnectivityMetaTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = DelayedTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void DeclareCapabilities(Kernel kernel) =>
            CommsElection.RegisterCapability(kernel, _ => new DeadGraphBackend());

        public void Register(IUplinkHost host)
        {
            _kernel = host.Kernel;
            host.AddChannelSource(ChannelEngine.CommsDelayTopic, _ => Delay());
            host.AddChannelSource(ChannelEngine.ConnectivityMetaTopic, _ => Link());
            host.AddChannelSource(DelayedTopic, Telemetry);
            host.SetSignalDelaySource(_ => Delay());
            host.SetConnectivitySource(_ => Connected());
        }

        /// <summary>Every tick carries one telemetry reading, so a frozen channel is visibly a channel with something to say.</summary>
        internal static KspSnapshot Snapshot(double ut) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?> { ["reading"] = 100.0 + ut },
        };

        private static object? Telemetry(KspSnapshot? snapshot) =>
            snapshot != null && snapshot.Values != null && snapshot.Values.TryGetValue("reading", out var v)
                ? v
                : null;

        private SignalDelayConfig Config() => CommsModelPolicy.Effective(_authored, _modelPresent);

        private ICommsBackend? Backend() => CommsModelPolicy.Effective(
            _kernel != null ? CommsElection.Elected(_kernel) : null,
            _modelPresent,
            () => CommsControlSource.Full,
            () => new PayloadMeta { Source = "vessel:x", Quality = Quality.Loaded });

        private CommsDelay? Delay()
        {
            var backend = Backend();
            if (backend == null)
            {
                return null;
            }
            var path = backend.Path();
            return SignalDelay.Compute(Config(), path, path.Meta?.Source ?? "", path.Meta?.Quality ?? Quality.OnRails);
        }

        private bool? Connected() => Backend()?.Connectivity().Connected;

        private object? Link()
        {
            var connected = Connected();
            return connected == null
                ? null
                : new CommsLink
                {
                    Connected = connected.Value,
                    Meta = new PayloadMeta { Source = "vessel:x", Quality = Quality.Loaded },
                };
        }

        /// <summary>
        /// What stock's own object graph reports once the CommNet difficulty
        /// option is off: disconnected, no control, an empty path, forever.
        /// </summary>
        internal sealed class DeadGraphBackend : ICommsBackend
        {
            public string ProviderId => "commnet";

            public CommsConnectivity Connectivity() => new CommsConnectivity
            {
                Connected = false,
                ControlSource = CommsControlSource.None,
                HasLocalControl = false,
                Meta = new PayloadMeta { Source = "vessel:x", Quality = Quality.Loaded },
            };

            public CommsSignalStrength SignalStrength() => new CommsSignalStrength
            {
                Value = 0.0,
                Meta = new PayloadMeta { Source = "vessel:x", Quality = Quality.Loaded },
            };

            public CommsControlState ControlState() => new CommsControlState
            {
                State = CommsControlStateKind.None,
                Reason = "no connection to a command source",
                Meta = new PayloadMeta { Source = "vessel:x", Quality = Quality.Loaded },
            };

            public CommsPath Path() => new CommsPath
            {
                Hops = new List<CommsHop>(),
                Meta = new PayloadMeta { Source = "vessel:x", Quality = Quality.Loaded },
            };

            public CommsNetwork Network() => new CommsNetwork
            {
                Meta = new PayloadMeta { Source = "vessel:x", Quality = Quality.Loaded },
            };

            public ICommsOcclusionModel OcclusionModel() => CommsOcclusionModels.Unknown;
        }
    }
}
