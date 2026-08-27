using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Sitrep.Host.Crew;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>spaceCenter.*</c> uplink: declares the launch-site / scene /
    /// crew-roster / saved-ships / parts-available / points-of-interest
    /// channels (<c>spaceCenter.launchSites</c>, <c>spaceCenter.scene</c>,
    /// <c>spaceCenter.crewRoster</c>, <c>spaceCenter.savedShips</c>,
    /// <c>spaceCenter.partsAvailable</c>, <c>spaceCenter.pois</c>) and wires
    /// <see cref="SpaceCenterViewProvider"/>'s builders as their channel
    /// sources. A NEW file rather than an addition to <see cref="SystemUplink"/>,
    /// so it doesn't thrash any existing uplink's ChannelDeclaration list.
    ///
    /// No <see cref="ISnapshotSampler"/> is registered: <c>KspHost.Sample</c>
    /// already populates the raw <c>"scene"</c> and <c>"spaceCenter"</c> snapshot
    /// keys (see its own doc comments), so the providers have their data,
    /// <see cref="IUplinkHost.AddSampler"/> is for a future uplink whose data
    /// ISN'T already on the snapshot.
    ///
    /// <para>All channels are <see cref="DelayRole.TrueNow"/>: launch-site
    /// roster, current scene, crew roster, saved craft and part count are
    /// ground-side game facts, known independent of any vessel's comms link,
    /// the same class as <c>system.bodies</c> / <c>game.dlc</c> /
    /// <c>ksp.revertAvailability</c>. Each hands back a fresh list/dict every
    /// call, so ChannelEmitter's change-gate reads every considered sample as
    /// "changed"; a 30s keyframe floor covers the steady state (these rarely
    /// change tick-to-tick).</para>
    /// </summary>
    [SitrepUplink("spaceCenter")]
    // IUplinkCapabilityDeclarer is what makes the host CALL DeclareCapabilities below.
    // Without it the method still compiles, still reads correctly, and is never invoked:
    // the capability goes undeclared and RP-1's provider fails with
    // "unknown capability crewStanding". Found on the rig 2026-08-27, invisible to the
    // suite because a test that calls DeclareCapabilities directly passes either way.
    public sealed class SpaceCenterUplink : ISitrepUplink, IUplinkCapabilityDeclarer
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
                new ChannelDeclaration
                {
                    Topic = SpaceCenterViewProvider.CrewRosterTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
                new ChannelDeclaration
                {
                    Topic = SpaceCenterViewProvider.SavedShipsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
                new ChannelDeclaration
                {
                    Topic = SpaceCenterViewProvider.PartsAvailableTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
                new ChannelDeclaration
                {
                    Topic = SpaceCenterViewProvider.PoisTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
                new ChannelDeclaration
                {
                    Topic = SpaceCenterViewProvider.AstronautComplexTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
            },
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>): a plain
        /// channel uplink is Healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        /// <summary>
        /// Declares the exclusive <c>"crewStanding"</c> capability: what this
        /// install makes of a kerbal whose roster status alone is not the answer.
        ///
        /// <para>Declared HERE, in the pre-Register capability pass, for the same
        /// two-pass reason the economy capability is declared in
        /// <see cref="CareerUplink"/>: a provider uplink's
        /// <c>RegisterProvider</c> throws if the capability does not exist yet,
        /// and assembly-scan discovery fixes no order between uplinks.</para>
        ///
        /// <para>Owned by THIS uplink because it owns
        /// <c>spaceCenter.crewRoster</c>, whose entries carry the elected
        /// backend's answer. That is the shared-namespace-single-declaration
        /// rule: a provider adds an interpretation, never a channel of its
        /// own.</para>
        /// </summary>
        public void DeclareCapabilities(Kernel kernel) =>
            CrewStandingElection.RegisterCapability(kernel);

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(SpaceCenterViewProvider.LaunchSitesTopic, SpaceCenterViewProvider.BuildLaunchSites);
            host.AddChannelSource(SpaceCenterViewProvider.SceneTopic, SpaceCenterViewProvider.BuildScene);
            host.AddChannelSource(SpaceCenterViewProvider.CrewRosterTopic, SpaceCenterViewProvider.BuildCrewRoster);
            host.AddChannelSource(SpaceCenterViewProvider.SavedShipsTopic, SpaceCenterViewProvider.BuildSavedShips);
            host.AddChannelSource(SpaceCenterViewProvider.PartsAvailableTopic, SpaceCenterViewProvider.BuildPartsAvailable);
            host.AddChannelSource(SpaceCenterViewProvider.PoisTopic, SpaceCenterViewProvider.BuildPois);
            host.AddChannelSource(SpaceCenterViewProvider.AstronautComplexTopic, SpaceCenterViewProvider.BuildAstronautComplex);
        }
    }
}
