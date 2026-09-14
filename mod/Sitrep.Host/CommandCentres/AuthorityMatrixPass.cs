using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Populates the per-(authority, subject) command-delay matrix: for every
    /// active command centre x every fleet subject, write the explicit
    /// (vantage = centre.Id, node = fleet.&lt;guid&gt;) delay pair. This is the
    /// EXPLICIT-PAIR tier of <c>StubNetwork.DelayTo</c>'s 3-tier lookup, so it
    /// overrides the <c>SetNodeDelay</c> node-default for the selected vantage
    /// while leaving the KSC-uniform node-default underneath for any unselected
    /// vantage.
    ///
    /// <para>Two subject namespaces, same tier: <see cref="Populate"/> writes the
    /// centre-to-VESSEL rows, <see cref="PopulateCentrePairs"/> the
    /// centre-to-CENTRE ones. <see cref="PopulateActiveVessel"/> and
    /// <see cref="PopulateHomeCommand"/> each write one more node, the active craft's
    /// and the career ledger's. The second is what makes a centre addressable as a
    /// SUBJECT and not only as a vantage; without it an act aimed at another
    /// centre (a currency spend routed to the program's home) has no delay row
    /// to read.</para>
    ///
    /// <para>KSP-free by construction: the routing (a centre's CommNet
    /// <c>ControlPath</c> to a subject, straight-line from a position) is injected
    /// as <c>routeDelay</c> by the KSP layer, which owns the KSP types. The two
    /// policy rules this class enforces are both KSP-free:</para>
    /// <list type="bullet">
    /// <item>No min-over-authorities: each authority writes its OWN row; the
    /// dispatched delay is the selected vantage's row, never a min collapse.</item>
    /// <item>Self-at-zero: a <see cref="CommandCentreKind.CrewedVessel"/> centre is
    /// authoritative about its OWN subject row, written as an explicit zero exactly as
    /// <see cref="PopulateCentrePairs"/> writes a centre's row against itself. A vantage
    /// is where the operator is standing, and light-time is the distance to somewhere
    /// else, so zero is the honest number for a craft observing itself. The row is
    /// reachable only from that craft's own vantage, because the no-min rule above is
    /// what keeps it there</item>
    /// </list>
    ///
    /// <para>The self row used to be EXCLUDED instead, citing delay-spec red-team
    /// BLOCKER-2. That defect was the min-over-authorities collapse: with a min, the
    /// subject's own onboard control contributed a 0 that every other operator's number
    /// collapsed onto. The no-min rule is the guard against it, and the exclusion was a
    /// second defence against a collapse this pass does not perform, paid for by a
    /// pinned pilot reading their own craft at the ground's light-time.</para>
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
                        /*
                         * A craft is no distance from itself, and this pass has to say
                         * so itself: the routing callback reports null for a self-path
                         * (a node-to-node solve where both ends are the same node is
                         * not a route), so leaving it to routeDelay would write no row
                         * and drop the pair through to the node-default, which is the
                         * ground's light-time to that craft.
                         */
                        setDelay(centre.Id, FleetNode(guid), 0.0);
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
        /// Populates each active centre's delay to the ACTIVE craft, the row every ordinary
        /// channel is delivered on (<see cref="ChannelEngine.NodeId"/>): those channels have
        /// no per-vessel node because they always describe whichever craft is active.
        ///
        /// <para>The crewed centre that IS the active craft is written as zero, by the same
        /// self-at-zero rule <see cref="Populate"/> applies to its fleet row. Any other centre
        /// is written at its route to the active craft, and a centre with no route gets no
        /// row.</para>
        ///
        /// <para>The home centre gets no row either, because it already has the right one.
        /// With no row a vantage reads the whole-network default, which is the active craft's
        /// own solved path home: the same path <see cref="Populate"/>'s routing reads for the
        /// home centre's fleet row. That default also carries the hold the engine puts on it
        /// while the craft is out of contact, which a row written from the path would not,
        /// since a craft with no link measures an empty path at zero.</para>
        /// </summary>
        /// <param name="activeCentres">The registry's currently-active centres.</param>
        /// <param name="activeGuid">The active craft's guid, or null when nothing is active (no row is written).</param>
        /// <param name="homeCentreId">The home centre as the routing callback identifies it, or null.</param>
        /// <param name="routeDelay">
        /// KSP-layer routing, the same callback <see cref="Populate"/> takes: one-way seconds
        /// from a centre to a subject guid, or null when unreachable.
        /// </param>
        /// <param name="setDelay">Writes the (centre, active craft) row.</param>
        public void PopulateActiveVessel(
            IReadOnlyList<ICommandCentre> activeCentres,
            string? activeGuid,
            string? homeCentreId,
            Func<ICommandCentre, string, double?> routeDelay,
            Action<string, double> setDelay)
        {
            if (activeGuid == null)
            {
                return;
            }

            foreach (var centre in activeCentres)
            {
                if (centre.Kind == CommandCentreKind.CrewedVessel && centre.Id == "vessel:" + activeGuid)
                {
                    setDelay(centre.Id, 0.0);
                    continue;
                }

                if (centre.Id == homeCentreId)
                {
                    continue;
                }

                var seconds = routeDelay(centre, activeGuid);
                if (seconds == null)
                {
                    continue;
                }

                setDelay(centre.Id, seconds.Value);
            }
        }

        /// <summary>
        /// Populates each active centre's delay to the HOME COMMAND's ledger, the row
        /// every <see cref="ChannelDeclaration.HeldAtHome"/> channel is delivered on.
        ///
        /// <para>The ledger is reached over the ground network, so the home centre and
        /// every ground station are written as zero, and any other centre as its own
        /// path home, whichever station that path ends at. A route to the one station
        /// the claimant named is deliberately not what is asked: a vessel talking to a
        /// different station reaches the ledger there, and would otherwise be told the
        /// ledger is unreachable or quoted a delay to a station it is not using.</para>
        /// </summary>
        /// <param name="activeCentres">The registry's currently-active centres.</param>
        /// <param name="homeCentreId">
        /// The centre the roster marks home, the claimant's answer or the ground station
        /// standing in for it, or null when there is none.
        /// </param>
        /// <param name="secondsToHome">
        /// KSP-layer measurement of a non-ground centre's path home, or null when the
        /// centre has no measurable path at all, in which case no row is written.
        /// </param>
        /// <param name="setDelay">Writes the (centre, home ledger) row.</param>
        public void PopulateHomeCommand(
            IReadOnlyList<ICommandCentre> activeCentres,
            string? homeCentreId,
            Func<ICommandCentre, double?> secondsToHome,
            Action<string, double> setDelay)
        {
            foreach (var centre in activeCentres)
            {
                if (centre.Id == homeCentreId || centre.Kind == CommandCentreKind.GroundStation)
                {
                    setDelay(centre.Id, 0.0);
                    continue;
                }

                var seconds = secondsToHome(centre);
                if (seconds == null)
                {
                    continue;
                }

                setDelay(centre.Id, seconds.Value);
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
