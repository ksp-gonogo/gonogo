using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>parts.power</c> capture surface: added THIS session so a live
    /// recording carries power production (solar/battery/fuel-cell/
    /// alternator) alongside <c>career.*</c>/<c>science.*</c>. Mirrors
    /// <see cref="CareerUplink"/>'s retrofit shape; the actual mapping
    /// lives in <see cref="PartsViewProvider"/>. No <see cref="ISnapshotSampler"/>
    /// is registered, <c>KspHost.Sample</c> already populates the raw
    /// <c>"parts"</c> snapshot key (guarded to "there's an active vessel",
    /// see <c>KspHost.BuildParts</c>'s doc comment).
    ///
    /// <para>The Breaking Ground robotics channels + commands that used to
    /// live here (rotor/hinge/piston servo state, and the servo/rotor
    /// actuation commands) moved to the bundled, DLC-gated
    /// <see cref="BreakingGroundUplink"/>: robotics is a Serenity-specific
    /// surface, not vanilla parts data, and doesn't belong co-mingled with
    /// power production. <see cref="BreakingGroundUplink"/> still reads the
    /// same raw <c>Values["parts"]</c> snapshot key <c>KspHost.BuildParts</c>
    /// populates; only which Uplink registers the channel sources changed.</para>
    /// </summary>
    [SitrepUplink("parts")]
    public sealed class PartsUplink : ISitrepUplink
    {
        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "parts",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = PartsViewProvider.PowerTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit: part/vessel-sourced telemetry, rides the delay clock like vessel.*.
                    Delay = DelayRole.Delayed,
                },
            },
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>): a plain
        /// channel uplink is Healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(PartsViewProvider.PowerTopic, PartsViewProvider.BuildPower);
        }
    }
}
