using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The exclusive <c>actionGroups</c> capability id every action-groups
    /// backend competes for. Declared here so the core mod and an Uplink
    /// spell it from one constant.
    /// </summary>
    /// <category>Host and Kernel</category>
    public static class ActionGroupsCapability
    {
        /// <summary>The capability id, <c>"actionGroups"</c>.</summary>
        public const string Id = "actionGroups";
    }

    /// <summary>
    /// The action-groups capability: one client-facing shape, with the backend
    /// that supplies it swappable, the same pattern as
    /// <see cref="ICommsBackend"/>.
    ///
    /// <para>The core mod registers an always-present stock backend for this
    /// exclusive capability; a mod-specific Uplink registers a higher-priority
    /// provider that is elected only when its mod is loaded, and the winner is
    /// resolved each time the vessel is captured. The topics never change, so
    /// the mod-specific Uplink ships no client of its own.</para>
    ///
    /// <para>Stock KSP has ten unnamed custom groups; Action Groups Extended
    /// (AGX) gives the player up to 250 that they name. Because
    /// <c>vessel.control.actionGroups</c> is a named, variable-length list of
    /// <see cref="ActionGroupState"/>, an AGX backend elected over the stock
    /// one needs no client change: a widget renders whatever names and indices
    /// arrive.</para>
    ///
    /// <para><b>Threading.</b> An implementation reads live KSP, so it is only
    /// ever called on the game's main thread, during vessel capture. Never call
    /// a backend from a channel-source closure, which runs on the stream
    /// thread.</para>
    /// <internal>
    /// The election helper stays in Sitrep.Host: registering the capability and
    /// resolving the winner are core's side of the seam. The stock backend is
    /// StockActionGroupsBackend; the caller is Gonogo.KSP.KspHost.BuildControl,
    /// the same main-thread seam CommsCoreUplink.CaptureOnMain uses. A Sitrep.Host
    /// view-provider maps an already-captured KspSnapshot and may run on the
    /// Courier thread; a backend may not.
    /// </internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public interface IActionGroupsBackend : ISitrepProvider
    {
        /// <summary>
        /// Every custom action group this backend knows, each named and
        /// carrying its own 1-based index, ordered by index ascending. Stock
        /// yields ten (<c>AG1..AG10</c>); an AGX backend may yield up to 250
        /// with the player's own names.
        ///
        /// <para>Return null when there is nothing to report this tick (no
        /// active vessel, or no action-group data): null means "not available
        /// this tick". An empty list would instead claim the vessel has no
        /// groups.</para>
        ///
        /// <para>A backend that can enumerate a group but not read it reports
        /// the entry with a null <see cref="ActionGroupState.State"/> rather
        /// than dropping it or defaulting it to false: dropping the entry hides
        /// a group the vessel has, and false claims it is disengaged. A null
        /// list is for a whole-tick failure, a null state for a single
        /// group.</para>
        /// </summary>
        IList<ActionGroupState>? Groups();

        /// <summary>
        /// Sets one group by its 1-based <see cref="ActionGroupState.Index"/>.
        /// The backend owns the valid range, since only it knows how many
        /// groups exist (ten on stock, up to 250 under AGX).
        /// <internal>
        /// The false return is what lets VesselCommandProvider.HandleSetActionGroup
        /// fail an unknown group cleanly without hardcoding the stock 1..10 bound.
        /// </internal>
        /// </summary>
        /// <param name="index">The group's 1-based index.</param>
        /// <param name="state">True to engage the group, false to disengage it.</param>
        /// <returns>False when the index is not one this backend knows, and the command should fail; true when the group was set.</returns>
        bool SetGroup(int index, bool state);
    }
}
