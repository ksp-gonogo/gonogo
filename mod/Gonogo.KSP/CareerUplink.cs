using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>career.status</c> capture surface — added THIS session so a
    /// live recording carries KSC/career state (funds/reputation/science,
    /// facility levels+costs, contracts, strategies, unlocked tech count)
    /// alongside <c>system.*</c>/<c>vessel.*</c>. Mirrors
    /// <see cref="SystemUplink"/>'s retrofit shape exactly: this class is
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
    [SitrepUplink("career")]
    public sealed class CareerUplink : ISitrepUplink
    {
        public UplinkManifest Manifest { get; } = new UplinkManifest
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
                    // Explicit retrofit, judgment call documented in
                    // contract-dynamic-delay-report.md: career state (funds,
                    // contracts, strategies) is KSC/ground-side bookkeeping,
                    // not something learned over a vessel's comms link, so
                    // TrueNow — same class as system.bodies/scansat.available.
                    Delay = DelayRole.TrueNow,
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(CareerViewProvider.Topic, CareerViewProvider.BuildCareer);
        }
    }
}
