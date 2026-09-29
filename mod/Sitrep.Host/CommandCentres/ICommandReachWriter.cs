using System.Collections.Generic;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Tells the engine, once per pass, which centres reach which subjects: the
    /// delay rows a centre is quoted against each craft, and the subjects it has
    /// no route to at all, so a command from it to one of those is refused.
    ///
    /// <para>Off <c>IUplinkHost</c> because its only writer is gonogo's own
    /// command-centre pass, which already references this assembly.</para>
    /// </summary>
    public interface ICommandReachWriter
    {
        /// <summary>
        /// Replace every centre's delay to each named craft. The set is the
        /// whole pass: a (centre, craft) pair named last pass and not this one
        /// loses its row.
        /// </summary>
        void SetAuthorityDelays(IReadOnlyCollection<(string CentreId, string VesselId, double OneWaySeconds)> rows);

        /// <summary>
        /// Replace the whole set. Each key is a centre as a VANTAGE, and its
        /// values are the subject nodes it has no route to. A centre not listed
        /// is never refused on its own reach.
        /// </summary>
        void SetUnroutable(IReadOnlyDictionary<string, IReadOnlyCollection<string>> nodesByCentre);
    }
}
