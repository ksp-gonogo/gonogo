namespace Sitrep.Core
{
    /// <summary>
    /// Writes a fleet vessel's route into the delay ledger as its ordered
    /// <see cref="Hop"/>s, rather than as the single scalar
    /// <c>SetVesselDelay</c> carries.
    ///
    /// <para>Deliberately NOT on <c>IUplinkHost</c>. That interface lives in
    /// <c>Sitrep.Contract</c>, which <c>Sitrep.Core</c> depends on, so a journey
    /// declared there cannot name <see cref="Journey"/> and would need a
    /// field-for-field mirror type in the contract purely to cross the
    /// assembly boundary. Declaring the capability HERE, where the ledger's own
    /// types are in scope, removes both the mirror and the marshalling. The
    /// only implementer is the channel engine, and the only caller is the KSP
    /// host, both of which already reference this project.</para>
    ///
    /// <para>Ordering matters and is not enforceable here: the hops' seconds
    /// must sum to the same one-way total passed to <c>SetVesselDelay</c> for
    /// the identical route, and this call must come AFTER it for the same
    /// vessel, because a bare scalar write retires any journey the node
    /// already had.</para>
    /// </summary>
    public interface IVesselJourneyWriter
    {
        /// <summary>
        /// Record <paramref name="journey"/> as the route to
        /// <paramref name="vesselId"/>, replacing whatever that vessel's node
        /// held before.
        /// </summary>
        void SetVesselJourney(string vesselId, Journey journey);
    }
}
