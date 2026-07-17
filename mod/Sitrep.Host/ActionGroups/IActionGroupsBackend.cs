using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.ActionGroups
{
    /// <summary>
    /// The action-groups capability seam — the exact shape
    /// <see cref="Sitrep.Host.Comms.ICommsBackend"/> established for comms, and
    /// for the same reason: ONE client interface, SWAPPABLE authority.
    ///
    /// <para><b>The precedent being mirrored</b> (see
    /// <c>Gonogo.KSP.CommsCoreUplink</c> / <c>GonogoRealAntennasUplink</c>):
    /// core registers an always-present vanilla factory for an exclusive
    /// capability; a mod-specific uplink registers a higher-priority provider
    /// that is elected only when that mod is actually loaded; the read path
    /// resolves the winner at CAPTURE time. Critically, <b>the topics never
    /// change and the mod-specific uplink ships no client at all</b> — the
    /// RealAntennas uplink adds zero client code, because <c>comms.*</c> looks
    /// identical whoever sources it.</para>
    ///
    /// <para><b>What that buys here:</b> stock KSP has exactly ten anonymous
    /// custom groups; Action Groups Extended (AGX) gives the player up to 250
    /// that they NAME. Because <c>vessel.control.actionGroups</c> is now a
    /// NAMED, arbitrary-length list (<see cref="ActionGroupState"/>) rather
    /// than a positional <c>bool[10]</c>, a future AGX backend elected over
    /// <c>StockActionGroupsBackend</c> needs <b>zero client change</b>: the
    /// widget already renders whatever names/indices arrive. That is the whole
    /// point of the seam, and it is why the contract had to stop being
    /// positional first. The AGX backend itself is a LATER phase — this phase
    /// only proves the seam by registering the stock backend through it.</para>
    ///
    /// <para><b>Threading — read this before adding a backend.</b> Unlike a
    /// <c>Sitrep.Host</c> view-provider (which maps an ALREADY-captured
    /// <see cref="KspSnapshot"/> and may run on the Courier thread), an
    /// implementation of this interface reads LIVE KSP. It is therefore only
    /// ever called from the main-thread capture (<c>Gonogo.KSP.KspHost</c>'s
    /// <c>BuildControl</c>), which is the same main-thread seam
    /// <c>CommsCoreUplink.CaptureOnMain</c> uses. Never call a backend from a
    /// channel-source closure.</para>
    /// </summary>
    public interface IActionGroupsBackend
    {
        /// <summary>
        /// Every CUSTOM action group this backend knows, each named and
        /// carrying its own 1-based index, ordered by index ascending. Stock
        /// yields ten (<c>AG1..AG10</c>); an AGX backend may yield up to 250
        /// with the player's own names. Returns null when there is nothing to
        /// report this tick (no active vessel / no action-group data) — a null
        /// is the contract's documented "not available this tick", NOT an
        /// empty list, which would wrongly assert "this vessel has no groups".
        /// </summary>
        IList<ActionGroupState>? Groups();

        /// <summary>
        /// Sets one group by its 1-based <see cref="ActionGroupState.Index"/>.
        /// Returns false when the index is not one this backend knows — which
        /// is what lets <c>VesselCommandProvider.HandleSetActionGroup</c> keep
        /// failing cleanly on an unknown group WITHOUT hardcoding the 1..10
        /// stock bound it can no longer assume (AGX legitimately goes to 250).
        /// The BACKEND owns the range, because only the backend knows it.
        /// </summary>
        bool SetGroup(int index, bool state);
    }
}
