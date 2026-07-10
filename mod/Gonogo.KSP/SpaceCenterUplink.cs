using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>spaceCenter.*</c> uplink — declares the two launch-site / scene
    /// channels (<c>spaceCenter.launchSites</c>, <c>spaceCenter.scene</c>) and
    /// wires <see cref="SpaceCenterViewProvider"/>'s builders as their channel
    /// sources. A NEW file rather than an addition to <see cref="SystemUplink"/>,
    /// so it doesn't thrash any existing uplink's ChannelDeclaration list.
    ///
    /// No <see cref="ISnapshotSampler"/> is registered: <c>KspHost.Sample</c>
    /// already populates the raw <c>"scene"</c> and <c>"spaceCenter"</c> snapshot
    /// keys unconditionally (see its own doc comments), so the providers have
    /// their data — <see cref="IUplinkHost.AddSampler"/> is for a future uplink
    /// whose data ISN'T already on the snapshot.
    ///
    /// <para>Both channels are <see cref="DelayRole.TrueNow"/>: launch-site
    /// roster and current scene are ground-side game facts, known independent of
    /// any vessel's comms link — the same class as <c>system.bodies</c> /
    /// <c>game.dlc</c> / <c>ksp.revertAvailability</c>. Both hand back a fresh
    /// list/dict every call, so ChannelEmitter's change-gate reads every
    /// considered sample as "changed"; a 30s keyframe floor covers the steady
    /// state (sites and scene rarely change tick-to-tick).</para>
    /// </summary>
    [SitrepUplink("spaceCenter")]
    public sealed class SpaceCenterUplink : ISitrepUplink
    {
        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "spaceCenter",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = SpaceCenterViewProvider.LaunchSitesTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
                new ChannelDeclaration
                {
                    Topic = SpaceCenterViewProvider.SceneTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(SpaceCenterViewProvider.LaunchSitesTopic, SpaceCenterViewProvider.BuildLaunchSites);
            host.AddChannelSource(SpaceCenterViewProvider.SceneTopic, SpaceCenterViewProvider.BuildScene);
        }
    }
}
