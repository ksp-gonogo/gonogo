using System.Collections.Generic;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>career.status</c> capture surface — added THIS session so a
    /// live recording carries KSC/career state (funds/reputation/science,
    /// facility levels+costs, contracts, strategies, unlocked tech count)
    /// alongside <c>system.*</c>/<c>vessel.*</c>. Mirrors
    /// <see cref="SystemExtension"/>'s retrofit shape exactly: this class is
    /// thin KSP-adjacent wiring; the actual mapping lives in the KSP-free
    /// <c>Sitrep.Host</c> assembly (<see cref="CareerViewProvider"/>),
    /// headlessly testable there. No <see cref="ISnapshotSampler"/> is
    /// registered because <c>KspHost.Sample</c> already populates the raw
    /// <c>"career"</c> snapshot key unconditionally (guarded to career mode
    /// only — see <c>KspHost.BuildCareer</c>'s doc comment).
    ///
    /// <para>Read-only capture for this session — no commands. Career
    /// actuation (accept/decline contract, upgrade facility, unlock tech,
    /// activate/deactivate strategy) is a follow-up, scoped in the master
    /// plan's Career/KSC section.</para>
    /// </summary>
    public sealed class CareerExtension : ISitrepExtension
    {
        public ExtensionManifest Manifest { get; } = new ExtensionManifest
        {
            Id = "career",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = CareerViewProvider.Topic,
                    Delivery = Delivery.LossyLatest,
                    // Career state changes on player action (accept a
                    // contract, spend funds, activate a strategy), not per
                    // frame - same 30s keyframe + "re-emit every sample tick
                    // reads as changed" cadence system.bodies uses (the
                    // payload is a fresh Dictionary tree every call, so
                    // ChannelEmitter's change-gate falls back to
                    // reference/Equals comparison).
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IExtensionHost host)
        {
            host.AddChannelSource(CareerViewProvider.Topic, CareerViewProvider.BuildCareer);
        }
    }
}
