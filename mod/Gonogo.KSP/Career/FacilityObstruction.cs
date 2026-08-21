using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// A facility with craft parked on it cannot be upgraded, which stock knows
    /// and the console did not.
    ///
    /// <para><b>What was wrong.</b> <c>KSCFacilityContextMenu</c>'s dismiss
    /// handler is
    /// <c>if (WarnOfObstructingVessels(includeGrounds: true, onlyDestroyed: false)) break;</c>
    /// before <c>UpgradeFacility</c>: a hard block, with no dialog option to
    /// proceed. So a craft on the pad stopped the player upgrading the Launch
    /// Pad, and the console upgraded under it.</para>
    ///
    /// <para><c>WarnOfObstructingVessels</c> itself is private and spawns a
    /// dialog, so it cannot be called. The walk it does is public though:
    /// <c>SpaceCenterBuilding.FindVesselsAtFacility(FlightState, IEnumerable&lt;DestructibleBuilding&gt;)</c>
    /// over the building's own <c>destructibles</c>, plus
    /// <c>FindVesselsAtGrounds(FlightState, Transform)</c> for the grounds,
    /// which together are the same two halves. The caller runs those; this
    /// turns their answer into the refusal.</para>
    /// </summary>
    internal static class FacilityObstruction
    {
        /// <summary>
        /// The refusal for an upgrade blocked by parked craft, or null when the
        /// facility is clear.
        ///
        /// <para><paramref name="lead"/> and <paramref name="tail"/> are the
        /// game's own two sentence fragments around the vessel list
        /// (<c>#autoLOC_6002252</c> / <c>#autoLOC_6002253</c>), resolved by the
        /// caller because this file carries no KSP type. The names are joined on
        /// a comma rather than stock's newline: a <c>Detail</c> is one line in a
        /// console log, where a dialog has a column to itself.</para>
        /// </summary>
        public static CommandResult? Refusal(IList<string> obstructingVesselNames, string lead, string tail)
        {
            if (obstructingVesselNames == null || obstructingVesselNames.Count == 0) return null;

            var names = new List<string>();
            foreach (var name in obstructingVesselNames)
            {
                if (!string.IsNullOrWhiteSpace(name)) names.Add(name);
            }
            if (names.Count == 0) return null;

            return CommandResult.Fail(
                CommandErrorCode.SiteOccupied, lead + string.Join(", ", names.ToArray()) + tail);
        }
    }
}
