using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Maneuver
{
    /// <summary>
    /// The maneuver-plan capability seam: the same shape
    /// <see cref="Sitrep.Host.ActionGroups.IActionGroupsBackend"/> and
    /// <see cref="Sitrep.Host.Comms.ICommsBackend"/> established, for the same
    /// reason. ONE client interface, SWAPPABLE authority, and
    /// <c>vessel.maneuver</c> looks identical whoever sources it.
    ///
    /// <para><b>Why this is a capability and not a mod's own Domain.</b> Core
    /// needs a defined answer to "what burns are planned" whatever is
    /// installed, "there are none" counts as one, and stock's own patched-conic
    /// solver is the genuinely CORRECT answer for an unmodified game rather
    /// than a null object standing in for a missing one. That is the test
    /// <c>PropagationElection</c> already passes and states; a plurality of
    /// competing mods is evidence for a capability, never a requirement of
    /// one.</para>
    ///
    /// <para><b>Threading: read this before adding a provider.</b> An
    /// implementation reads LIVE KSP, unlike a <c>Sitrep.Host</c> view provider
    /// which maps an already-captured <see cref="KspSnapshot"/> and may run on
    /// the Courier thread. It is therefore only ever called from the
    /// main-thread capture. Never call a provider from a channel-source
    /// closure.</para>
    /// </summary>
    public interface IManeuverPlanSource
    {
        /// <summary>
        /// Stable id of this provider, for diagnostics and for the wire.
        /// Nothing outside the election may branch on which provider is active,
        /// so a provider says what it is rather than being interrogated.
        /// </summary>
        string ProviderId { get; }

        /// <summary>
        /// The burns planned for the craft being captured, ordered by
        /// execution, earliest <see cref="ManeuverNode.Ut"/> first.
        ///
        /// <para><b>Null and empty are different answers and both are real.</b>
        /// An empty list means "there is a planner and it has no burns
        /// queued", which is the overwhelmingly common case. Null means "there
        /// is no planner at all", which stock reaches on its own: an
        /// un-upgraded Tracking Station leaves
        /// <c>Vessel.patchedConicSolver</c> NULL, so an early-career craft
        /// cannot hold a plan rather than merely not holding one. Collapsing
        /// those two onto <c>[]</c> tells an operator their plan is empty when
        /// the truth is that they cannot make one, and it is the same
        /// distinction <see cref="Sitrep.Host.ActionGroups.IActionGroupsBackend.Groups"/>
        /// draws for the same reason.</para>
        ///
        /// <para>A provider assigns each burn's
        /// <see cref="ManeuverNode.Id"/> itself, because only the provider
        /// knows what a burn's stable identity is in its own model.</para>
        /// </summary>
        IList<ManeuverNode>? Plan();
    }
}
