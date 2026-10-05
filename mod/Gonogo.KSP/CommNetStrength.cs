using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;

namespace Gonogo.KSP
{
    /// <summary>
    /// Stock CommNet's two strength rules, kept apart from the backend so they
    /// can be run without a game: a link's strength from its longest range, and
    /// a path's from its links.
    /// </summary>
    public static class CommNetStrength
    {
        /// <summary>The strength model for a pair with this longest range, or null when it has none stated.</summary>
        public static IContactLinkStrength? For(double? maxRangeMeters) =>
            maxRangeMeters == null || double.IsNaN(maxRangeMeters.Value) ? null : new RangeCurveStrength(maxRangeMeters.Value);

        /// <summary>A path's strength as stock has it: every link's strength multiplied together.</summary>
        public static double Product(IReadOnlyList<double> hopStrengths)
        {
            var whole = 1.0;
            foreach (var strength in hopStrengths)
            {
                whole *= strength;
            }
            return whole;
        }
    }
}
