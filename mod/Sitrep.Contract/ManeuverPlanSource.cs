using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The provider of the active craft's maneuver plan, registered for the
    /// <see cref="ManeuverPlanCapability.Id"/> capability: one interface with a
    /// swappable provider, as with <see cref="IActionGroupsBackend"/> and
    /// <see cref="ICommsBackend"/>, so <c>vessel.maneuver</c> looks identical
    /// whoever provides it. Stock's own patched-conic solver is the provider in
    /// an unmodified game.
    ///
    /// <para><b>Threading.</b> An implementation reads live KSP, so it is only
    /// ever called on the main thread, during the capture. Never call a
    /// provider from a channel-source mapper, which runs off the main
    /// thread.</para>
    /// <internal>
    /// A capability rather than a mod's own Domain because core needs a defined
    /// value for "what burns are planned" whatever is installed, and stock's
    /// solver is the correct one for an unmodified game rather than a null
    /// object; Sitrep.Host.Propagation.PropagationElection passes and states the
    /// same test. A Sitrep.Host view provider maps an already-captured
    /// KspSnapshot and may run on the Courier thread; a provider may not.
    /// </internal>
    /// </summary>
    /// <category>Uplink API</category>
    public interface IManeuverPlanSource : ISitrepProvider
    {
        /// <summary>
        /// The burns planned for the craft being captured, ordered by
        /// execution, earliest <see cref="ManeuverNode.Ut"/> first.
        ///
        /// <para><b>Null and empty are different values and both are real.</b>
        /// An empty list means "there is a planner and it has no burns
        /// queued", which is the overwhelmingly common case. Null means "there
        /// is no planner at all", which stock reaches on its own: an
        /// un-upgraded Tracking Station leaves
        /// <c>Vessel.patchedConicSolver</c> NULL, so an early-career craft
        /// cannot hold a plan rather than merely not holding one. Collapsing
        /// those two onto <c>[]</c> tells an operator their plan is empty when
        /// the truth is that they cannot make one, and it is the same
        /// distinction <see cref="IActionGroupsBackend.Groups"/>
        /// draws for the same reason.</para>
        ///
        /// <para>A provider assigns each burn's
        /// <see cref="ManeuverNode.Id"/> itself, because only the provider
        /// knows what a burn's stable identity is in its own model.</para>
        /// </summary>
        IList<ManeuverNode>? Plan();

        /// <summary>
        /// Install a plan composed at a command centre, whole or not at all.
        ///
        /// <para>On the same interface as <see cref="Plan"/>: whoever reports the
        /// craft's plan is the only thing that can replace it, so an operator
        /// never reads one plan and changes another.</para>
        ///
        /// <para>Refusing is a normal outcome. A planner with no way to accept a
        /// whole plan says so, rather than accepting and installing part of
        /// it.</para>
        /// </summary>
        /// <param name="plan">The plan to install, in full.</param>
        /// <returns>Success once the whole plan is installed, or a refusal with nothing installed.</returns>
        CommandResult SendPlan(SendManeuverPlanArgs plan);
    }

    /// <summary>
    /// The capability id an <see cref="IManeuverPlanSource"/> is registered
    /// for. Use this constant rather than writing the string: a mismatched id
    /// fails silently, as a plan that never arrives.
    /// </summary>
    /// <category>Uplink API</category>
    public static class ManeuverPlanCapability
    {
        /// <summary>The capability id, <c>"maneuverPlan"</c>.</summary>
        public const string Id = "maneuverPlan";
    }
}
