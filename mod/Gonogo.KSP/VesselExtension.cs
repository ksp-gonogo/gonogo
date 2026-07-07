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
            },
        };

        public void Register(IExtensionHost host)
        {
            host.AddChannelSource(VesselViewProvider.IdentityTopic, VesselViewProvider.BuildIdentityWire);
            host.AddChannelSource(VesselViewProvider.OrbitTopic, VesselViewProvider.BuildOrbitWire);
            host.AddChannelSource(VesselViewProvider.OrbitTruthTopic, VesselViewProvider.BuildOrbitTruthWire);
            host.AddChannelSource(VesselViewProvider.FlightTopic, VesselViewProvider.BuildFlightWire);

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
