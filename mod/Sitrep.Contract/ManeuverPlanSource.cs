using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The provider of the active craft's maneuver plan, registered for the
    /// <see cref="ManeuverPlanCapability.Id"/> capability, so
    /// <c>vessel.maneuver</c> looks the same whoever provides it. Stock's own
    /// patched-conic solver is the provider in an unmodified game.
    ///
    /// <para><b>Threading.</b> An implementation reads live KSP, so it is only
    /// ever called on the main thread, during capture. Never call it from a
    /// channel-source mapper, which runs off the main thread.</para>
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
        /// <para><b>Null and empty.</b> An empty list means there is a planner
        /// with no burns queued, the common case. Null means there is no planner
        /// at all, as for a craft before the Tracking Station is upgraded, which
        /// cannot hold a plan. Never return an empty list for that case: it tells
        /// the operator their plan is empty when they cannot make one.</para>
        ///
        /// <para>A provider assigns each burn's
        /// <see cref="ManeuverNode.Id"/> itself, because only the provider
        /// knows what a burn's stable identity is in its own model.</para>
        /// </summary>
        IList<ManeuverNode>? Plan();
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
