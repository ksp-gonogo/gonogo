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
    /// <para>Two subject namespaces, same tier: <see cref="Populate"/> writes the
    /// centre-to-VESSEL rows, <see cref="PopulateCentrePairs"/> the
    /// centre-to-CENTRE ones. The second exists because a centre used to be
    /// addressable only as a vantage, which left an act aimed at another centre
    /// (a currency spend routed to the program's home) with no delay to read.</para>
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

        /// <summary>The per-subject node id for a command centre addressed as a DESTINATION.</summary>
        public static string CentreNode(string centreId) => ChannelEngine.CentreNodePrefix + centreId;

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

        /// <summary>
        /// Populates the CENTRE-to-CENTRE half of the same matrix: for every
        /// ordered pair of active centres, the delay from the first (as a
        /// vantage) to the second (as a destination <see cref="CentreNode"/>).
        /// This is what makes an act aimed at another centre, rather than at a
        /// craft, expressible at all.
        ///
        /// <para>A centre's row against ITSELF is written as an explicit zero,
        /// and it is the one zero in this file that is not a guess: a node is
        /// exactly no distance from itself. Without it the pair would fall
        /// through to the whole-network default delay, so an operator at the
        /// home centre commanding the home centre would inherit whatever
        /// light-time the active craft happens to be at, which is the wrong
        /// number and silently so. The routing callback still reports
        /// <c>null</c> for a self-path, because "route from a node to itself" is
        /// not a route; the zero is this pass's own statement, not a measurement.</para>
        /// </summary>
        /// <param name="activeCentres">The registry's currently-active centres.</param>
        /// <param name="routeDelay">
        /// KSP-layer routing: one-way seconds between two centres, or null when they are
        /// not routable to each other (the pair is then left unset, so nothing quotes a
        /// delay for a command that could not be delivered).
        /// </param>
        /// <param name="setDelay">Writes an explicit (vantage, node, seconds) pair.</param>
        public void PopulateCentrePairs(
            IReadOnlyList<ICommandCentre> activeCentres,
            Func<ICommandCentre, ICommandCentre, double?> routeDelay,
            Action<string, string, double> setDelay)
        {
            foreach (var from in activeCentres)
            {
                foreach (var to in activeCentres)
                {
                    if (from.Id == to.Id)
                    {
                        setDelay(from.Id, CentreNode(to.Id), 0.0);
                        continue;
                    }

                    var seconds = routeDelay(from, to);
                    if (seconds == null)
                    {
                        continue;
                    }

                    setDelay(from.Id, CentreNode(to.Id), seconds.Value);
                }
            }
        }
    }
}
