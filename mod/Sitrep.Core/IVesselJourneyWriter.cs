namespace Sitrep.Core
{
    /// <summary>
    /// Writes a fleet vessel's route into the delay ledger as its ordered
    /// <see cref="Hop"/>s, rather than as the single scalar
    /// <c>SetVesselDelay</c> carries, and the breaks observed in it.
    ///
    /// <para>Lives here rather than on <c>IUplinkHost</c> so it can name
    /// <see cref="Journey"/> directly: <c>Sitrep.Core</c> depends on
    /// <c>Sitrep.Contract</c>, so the ledger's own types are out of scope from
    /// there. Its implementer and its caller both reference this project.</para>
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

        /// <summary>
        /// Record a break in <paramref name="vesselId"/>'s route home against
        /// that vessel's own node, so light it sent that had not crossed the
        /// break never arrives (see <c>INetwork.DropPath</c>).
        /// </summary>
        void SetVesselPathBreak(string vesselId, Sitrep.Contract.PathBreak found);
    }
}
