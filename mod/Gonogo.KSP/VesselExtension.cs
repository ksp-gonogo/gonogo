using System.Collections.Generic;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// M1 Task 1 — the vessel telemetry extension foundation. Registers the
    /// four core vessel channels (identity/orbit/orbit.truth/flight) with
    /// <see cref="VesselViewProvider"/>'s typed mappers (via its wire-adapter
    /// <c>*Wire</c> overloads — see that class's doc comment), and wires the
    /// subject-provenance + epoch mechanism
    /// local_docs/telemetry-mod/m1-provider-taxonomy-design.md §6.1/§8.1 call
    /// "must-ship, unretrofittable": every <c>vessel.*</c> sample already
    /// carries <c>meta.source = "vessel:&lt;guid&gt;"</c> (VesselViewProvider's
    /// job); this extension additionally registers <see cref="VesselEpochSampler"/>,
    /// which detects an active-vessel GUID change and forces an
    /// unconditional keyframe on every vessel channel for that same tick via
    /// <see cref="IExtensionHost.ForceKeyframe"/>.
    ///
    /// Mirrors <see cref="SystemExtension"/>'s retrofit shape exactly: this
    /// class is thin KSP-adjacent wiring; all the actual mapping/epoching
    /// logic lives in the KSP-free <c>Sitrep.Host</c> assembly
    /// (<see cref="VesselViewProvider"/>/<see cref="VesselEpochSampler"/>),
    /// headlessly testable there.
    /// </summary>
    public sealed class VesselExtension : ISitrepExtension
    {
        public ExtensionManifest Manifest { get; } = new ExtensionManifest
        {
            Id = "vessel",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Channel(VesselViewProvider.IdentityTopic),
                // Orbital elements barely move on-rails (maneuver/SOI
                // transitions only) but can move every tick off-rails
                // (powered/atmospheric flight) -- a 30s keyframe cadence
                // follows system.bodies' precedent (SystemExtension). The
                // payload is a Dictionary tree (see VesselViewProvider's
                // wire-adapter doc comment), so ChannelEmitter's change-gate
                // falls back to reference/Equals comparison exactly like
                // system.bodies -- deadband refinement for these structured
                // channels is a follow-up, not required for this
                // foundation.
                Channel(VesselViewProvider.OrbitTopic),
                // Dev-gated debug channel (design doc §6.5) -- same cadence
                // as orbit. There is no engine-level "hide from the picker"
                // flag yet (a future SDK/picker concern), so this is
                // dev-only BY CONVENTION: never bind it from a widget.
                Channel(VesselViewProvider.OrbitTruthTopic),
                Channel(VesselViewProvider.FlightTopic),
                // ---- M1 Task 2 channels -- same pattern, same cadence;
                // per-channel deadband/rate-clamp tuning is deferred exactly
                // like Task 1's (see the OrbitTopic comment above).
                Channel(VesselViewProvider.AttitudeTopic),
                Channel(VesselViewProvider.ResourcesTopic),
                Channel(VesselViewProvider.ThermalTopic),
                Channel(VesselViewProvider.ControlTopic),
                Channel(VesselViewProvider.CommsTopic),
                Channel(VesselViewProvider.PropulsionTopic),
                Channel(VesselViewProvider.ManeuverTopic),
                Channel(VesselViewProvider.TargetTopic),
                Channel(VesselViewProvider.CrewTopic),
                Channel(VesselViewProvider.StructureTopic),
                // time.warp -- see WarpState's doc comment for why this
                // vessel-gated channel is still declared/registered here
                // alongside the genuinely vessel-scoped ones.
                Channel(VesselViewProvider.WarpTopic),
            },
        };

        public void Register(IExtensionHost host)
        {
            host.AddChannelSource(VesselViewProvider.IdentityTopic, VesselViewProvider.BuildIdentityWire);
            host.AddChannelSource(VesselViewProvider.OrbitTopic, VesselViewProvider.BuildOrbitWire);
            host.AddChannelSource(VesselViewProvider.OrbitTruthTopic, VesselViewProvider.BuildOrbitTruthWire);
            host.AddChannelSource(VesselViewProvider.FlightTopic, VesselViewProvider.BuildFlightWire);
            host.AddChannelSource(VesselViewProvider.AttitudeTopic, VesselViewProvider.BuildAttitudeWire);
            host.AddChannelSource(VesselViewProvider.ResourcesTopic, VesselViewProvider.BuildResourcesWire);
            host.AddChannelSource(VesselViewProvider.ThermalTopic, VesselViewProvider.BuildThermalWire);
            host.AddChannelSource(VesselViewProvider.ControlTopic, VesselViewProvider.BuildControlWire);
            host.AddChannelSource(VesselViewProvider.CommsTopic, VesselViewProvider.BuildCommsWire);
            host.AddChannelSource(VesselViewProvider.PropulsionTopic, VesselViewProvider.BuildPropulsionWire);
            host.AddChannelSource(VesselViewProvider.ManeuverTopic, VesselViewProvider.BuildManeuverWire);
            host.AddChannelSource(VesselViewProvider.TargetTopic, VesselViewProvider.BuildTargetWire);
            host.AddChannelSource(VesselViewProvider.CrewTopic, VesselViewProvider.BuildCrewWire);
            host.AddChannelSource(VesselViewProvider.StructureTopic, VesselViewProvider.BuildStructureWire);
            host.AddChannelSource(VesselViewProvider.WarpTopic, VesselViewProvider.BuildWarpWire);

            host.AddSampler(new VesselEpochSampler(host));
        }

        private static ChannelDeclaration Channel(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };
    }
}
