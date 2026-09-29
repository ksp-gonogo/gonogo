using System.Collections.Generic;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Tells the engine which centre-to-centre pairs have a routed path this pass.
    ///
    /// <para>The delay ledger cannot answer that on its own: a pair that loses
    /// its route writes no row, and the row it had before stays where it was.
    /// So a delay being on file is not evidence of a path, and anything that must
    /// not reach a centre it has no route to asks this set instead.</para>
    ///
    /// <para>Off <c>IUplinkHost</c> because its only writer is gonogo's own
    /// command-centre pass, which already references this assembly.</para>
    /// </summary>
    public interface ICentreRouteWriter
    {
        /// <summary>
        /// Replace the whole set. Each key is a centre as a VANTAGE, and its
        /// values are the centres it has a routed path to as a destination, the
        /// same orientation as <c>IUplinkHost.SetCentreDelay</c>. A centre always
        /// reaches itself, whether or not it is listed.
        /// </summary>
        void SetCentreRoutes(IReadOnlyDictionary<string, IReadOnlyCollection<string>> routes);
    }
}
