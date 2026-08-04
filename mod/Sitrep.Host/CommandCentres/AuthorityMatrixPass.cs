using System;
using System.Collections.Generic;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Populates the per-(authority, subject) command-delay matrix: for every
    /// active command centre x every fleet subject, write the explicit
    /// (vantage = centre.Id, node = fleet.&lt;guid&gt;) delay pair. This is the
    /// EXPLICIT-PAIR tier of <c>StubNetwork.DelayTo</c>'s 3-tier lookup, so it
    /// overrides Plan 2's <c>SetNodeDelay</c> node-default for the selected
    /// vantage while leaving the KSC-uniform node-default underneath for any
    /// unselected vantage.
    ///
    /// <para>KSP-free by construction: the routing (a centre's CommNet
    /// <c>ControlPath</c> to a subject, straight-line from a position) is injected
    /// as <c>routeDelay</c> by the KSP layer, which owns the KSP types. The two
    /// policy rules this class enforces are both KSP-free:</para>
    /// <list type="bullet">
    /// <item>Self-exclusion (red-team BLOCKER-2): a <see cref="CommandCentreKind.CrewedVessel"/>
    /// centre is excluded from ITS OWN subject row, else route(self-&gt;self)=0 reports
    /// 0 command delay for that craft to a full-light-time operator.</item>
    /// <item>No min-over-authorities: each authority writes its OWN row; the
    /// dispatched delay is the selected vantage's row, never a min collapse.</item>
    /// </list>
    /// </summary>
    public sealed class AuthorityMatrixPass
    {
        /// <summary>The per-subject node id for a vessel guid, matching Plan 2's fleet namespace.</summary>
        public static string FleetNode(string guid) => ChannelEngine.FleetNodePrefix + guid;

        /// <param name="activeCentres">The registry's currently-active centres.</param>
        /// <param name="subjectGuids">The fleet subject vessel guids (same set Plan 2's fleet pass walks).</param>
        /// <param name="routeDelay">
        /// KSP-layer routing: one-way seconds from a centre to a subject guid, or null when
        /// unreachable / not applicable (the pair is then left unset and falls through to the
        /// node-default). Provided by the caller so this class needs no KSP reference.
        /// </param>
        /// <param name="setDelay">
        /// Writes an explicit (vantage, node, seconds) pair (in production, <c>StubNetwork.SetDelay</c>).
        /// </param>
        public void Populate(
            IReadOnlyList<ICommandCentre> activeCentres,
            IReadOnlyList<string> subjectGuids,
            Func<ICommandCentre, string, double?> routeDelay,
            Action<string, string, double> setDelay)
        {
            foreach (var centre in activeCentres)
            {
                foreach (var guid in subjectGuids)
                {
                    if (centre.Kind == CommandCentreKind.CrewedVessel && centre.Id == "vessel:" + guid)
                    {
                        // Self-exclusion: no explicit row for a crewed centre's own subject.
                        continue;
                    }

                    var seconds = routeDelay(centre, guid);
                    if (seconds == null)
                    {
                        // Unreachable: leave the (vantage, node) pair unset.
                        continue;
                    }

                    setDelay(centre.Id, FleetNode(guid), seconds.Value);
                }
            }
        }
    }
}
