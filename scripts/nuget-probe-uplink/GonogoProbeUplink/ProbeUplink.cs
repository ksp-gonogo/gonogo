using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoProbeUplink
{
    /// <summary>
    /// Publishes the game's universal time on <c>probe.clock</c>, read on the main
    /// thread and published from the Courier. The KSP read lives in
    /// <c>ProbeUplink.Ksp.cs</c>, so this half compiles into a net10.0 test project.
    /// </summary>
    [SitrepUplink("probe")]
    public sealed partial class ProbeUplink : ISitrepUplink
    {
        public const string ClockTopic = "probe.clock";

        private readonly Func<double?> _readUt;
        private IChannelPublisher? _clock;

        internal ProbeUplink(Func<double?> readUt)
        {
            _readUt = readUt;
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "probe",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = ClockTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(
                        keyframeIntervalUt: 30,
                        quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            _clock = host.Publisher(ClockTopic);
            host.AddSampledSource(_ => _readUt(), Handle);
        }

        public UplinkHealth Health() => UplinkHealth.Healthy;

        /// <summary>A capture with no readable UT publishes nothing rather than a zero.</summary>
        internal void Handle(object? captured)
        {
            if (_clock == null || captured is not double ut)
            {
                return;
            }
            _clock.Publish(new Dictionary<string, object?> { ["ut"] = ut }, ut);
        }
    }
}
