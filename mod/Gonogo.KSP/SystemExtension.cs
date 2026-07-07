using System.Collections.Generic;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>system.bodies</c> retrofit — the reference
    /// <see cref="ISitrepExtension"/>, proving the extension contract fits
    /// the exact channel <c>GonogoBodiesServer</c> used to hand-wire. See
    /// <c>local_docs/telemetry-mod/extension-sdk-contract-design.md</c> §6.1
    /// (this class matches that sketch almost verbatim).
    ///
    /// Only ONE line of actual wiring survives the retrofit:
    /// <see cref="SystemViewProvider.BuildSystemBodies"/> drops straight in
    /// as the <see cref="IExtensionHost.AddChannelSource"/> mapper argument,
    /// unchanged. No <see cref="ISnapshotSampler"/> is registered because
    /// <c>KspHost.Sample</c> already populates the raw <c>"bodies"</c>
    /// snapshot key unconditionally (see its own doc comment) — a future
    /// extension whose data ISN'T already on the snapshot is what
    /// <see cref="IExtensionHost.AddSampler"/> exists for.
    /// </summary>
    public sealed class SystemExtension : ISitrepExtension
    {
        public ExtensionManifest Manifest { get; } = new ExtensionManifest
        {
            Id = "system",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = SystemViewProvider.Topic,
                    Delivery = Delivery.LossyLatest,
                    // system.bodies is a static structured channel (orbital
                    // elements barely change tick to tick) - a 30s keyframe
                    // cadence plus accepting a re-emit at whatever cadence
                    // GonogoAddon samples at (currently ~1s UT) is fine per
                    // the streaming-slice-1 plan. The quantum is irrelevant
                    // here: the payload is a Dictionary, so ChannelEmitter's
                    // change-gate falls back to reference/Equals comparison,
                    // and BuildSystemBodies hands back a fresh Dictionary
                    // every call - so every considered sample reads as
                    // "changed". Unchanged from GonogoBodiesServer.BodiesEmissionPolicy.
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                // system.vessels -- the M3 R3 roster capture-add. Same cadence
                // as system.bodies: a re-emit every sample tick reads as
                // "changed" (fresh Dictionary/List every call), a 30s
                // keyframe floor covers a genuinely idle roster.
                new ChannelDeclaration
                {
                    Topic = SystemViewProvider.VesselsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IExtensionHost host)
        {
            host.AddChannelSource(SystemViewProvider.Topic, SystemViewProvider.BuildSystemBodies);
            host.AddChannelSource(SystemViewProvider.VesselsTopic, SystemViewProvider.BuildSystemVessels);
        }
    }
}
