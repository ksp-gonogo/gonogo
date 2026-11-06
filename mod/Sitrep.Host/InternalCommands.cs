using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// Commands the host sends on a client's behalf to keep something alive, such as the
    /// fly-by-wire lease renewal. They are dispatched and delayed like any other command
    /// but never listed on <c>system.uplink.pending</c>, so no operator sees one.
    /// </summary>
    public static class InternalCommands
    {
        private static readonly HashSet<string> Names = new HashSet<string>(StringComparer.Ordinal)
        {
            VesselCommandProvider.HoldFlyByWireCommand,
        };

        /// <summary>True when <paramref name="command"/> must stay off the pending list.</summary>
        public static bool Contains(string? command) => command != null && Names.Contains(command);
    }
}
