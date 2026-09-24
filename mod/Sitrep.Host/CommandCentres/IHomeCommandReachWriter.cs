using System.Collections.Generic;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Tells the engine which command centres cannot reach the home command's
    /// ledger at all this pass, so a command addressed to it from one of them is
    /// dropped at dispatch like a command into any other dead link.
    ///
    /// <para>Off <c>IUplinkHost</c> because its only writer is gonogo's own
    /// command-centre pass, which already references this assembly.</para>
    /// </summary>
    public interface IHomeCommandReachWriter
    {
        /// <summary>
        /// Replace the whole set: a centre named last pass and not this one
        /// reaches the ledger again.
        /// </summary>
        void SetOffTheGroundNetwork(IReadOnlyCollection<string> centreIds);
    }
}
