using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What one command centre is told about the other centres on its roster:
    /// how far apart they are (<c>commandCentre.separation</c>), how far each
    /// is from the active craft (<c>commandCentre.activeVesselDelay</c>), and
    /// which have left (<c>commandCentre.unreachable</c>).
    ///
    /// <para>Every figure is worked out from the receiving centre's own roster
    /// and its own contact plan, which are made of what that centre has heard.
    /// So a centre is never quoted a signal delay to a craft it has not heard
    /// is a centre, and a figure moves only when the news that moves it has
    /// arrived. The delays the engine times traffic by are not these: those
    /// are measured over the game's own links, because they decide when light
    /// that was really sent really lands.</para>
    /// </summary>
    public static class CentreFigures
    {
        /// <summary>
        /// Every ordered pair of centres on <paramref name="roster"/> the plan
        /// has an open route between now, with each centre's own zero. A pair
        /// with no open route has no entry.
        /// </summary>
        /// <param name="roster">The receiving centre's own roster.</param>
        /// <param name="plan">Its own contact plan, or null when it has none.</param>
        /// <param name="home">The home centre, or null.</param>
        /// <param name="antennas">Every ground station, each of which is home's own antenna: see <see cref="GroundNetwork"/>.</param>
        /// <param name="ut">Now.</param>
        /// <param name="lightFactor">What a real signal delay is multiplied by: see <see cref="DeliveryInputs.LightFactor"/>.</param>
        public static CommandCentreSeparation Separation(
            IReadOnlyList<CommandCentreEntry> roster,
            ContactPlan? plan,
            string? home,
            IReadOnlyCollection<string>? antennas,
            double ut,
            double lightFactor)
        {
            var pairs = new List<CentreSeparationEntry>();
            // The nodes each centre sends and hears by, worked out once for the centre and not once for each pair it is in.
            var ends = new IReadOnlyCollection<string>?[roster.Count];
            for (var i = 0; i < roster.Count; i++)
            {
                ends[i] = roster[i].Id == null ? null : GroundNetwork.EndsOf(roster[i].Id!, home, antennas);
            }
            for (var i = 0; i < roster.Count; i++)
            {
                var from = roster[i].Id;
                // One search from each centre answers for every centre it is paired with.
                EarliestArrivals? arrivals = null;
                for (var j = 0; j < roster.Count; j++)
                {
                    var to = roster[j].Id;
                    var seconds = Between(from, to, plan, ends[i], ends[j], ut, lightFactor, ref arrivals);
                    if (seconds != null)
                    {
                        pairs.Add(new CentreSeparationEntry { From = from!, To = to!, OneWaySeconds = seconds.Value });
                    }
                }
            }
            return new CommandCentreSeparation { Pairs = pairs };
        }

        /// <summary>
        /// Each centre on <paramref name="roster"/>'s own delay to the active
        /// craft, as the receiving centre's plan has it. <paramref name="noRoute"/>
        /// is the ledger's word that the receiving centre has none. The home centre is
        /// never listed, a centre with no open route is not listed, and the
        /// centre that is the active craft is listed at zero.
        /// </summary>
        public static CommandCentreActiveVesselDelay ActiveVesselDelays(
            IReadOnlyList<CommandCentreEntry> roster,
            ContactPlan? plan,
            string? activeCraft,
            string? home,
            IReadOnlyCollection<string>? antennas,
            double ut,
            double lightFactor,
            bool noRoute = false)
        {
            var centres = new List<CentreDelayEntry>();
            if (activeCraft == null)
            {
                return new CommandCentreActiveVesselDelay { Centres = centres, NoRoute = noRoute };
            }
            // Every centre's first figure is of the routes leaving the craft at the same instant, which one search answers.
            EarliestArrivals? leavingNow = null;
            foreach (var centre in roster)
            {
                if (centre.Id == null || centre.Id == home)
                {
                    continue;
                }
                var seconds = AsHeardBy(activeCraft, centre.Id, plan, home, antennas, ut, lightFactor, ref leavingNow);
                if (seconds != null)
                {
                    centres.Add(new CentreDelayEntry { Id = centre.Id, OneWaySeconds = seconds.Value });
                }
            }
            return new CommandCentreActiveVesselDelay { Centres = centres, NoRoute = noRoute };
        }

        /// <summary>
        /// The delay between two nodes as the receiving centre can know it: the
        /// route open when the signal it hears now left, which is <paramref name="ut"/>
        /// less that delay, found by repeating until the figure settles. A centre
        /// is never told the route as it is at <paramref name="ut"/> itself, which
        /// no signal could have carried to it yet. Null with no open route then,
        /// and never earlier than the plan's own start.
        /// </summary>
        private static double? AsHeardBy(
            string? from,
            string? to,
            ContactPlan? plan,
            string? home,
            IReadOnlyCollection<string>? antennas,
            double ut,
            double lightFactor,
            ref EarliestArrivals? leavingNow)
        {
            var seconds = Between(from, to, plan, home, antennas, ut, lightFactor, ref leavingNow);
            if (seconds == null || plan == null)
            {
                return seconds;
            }
            for (var pass = 0; pass < SettlePasses; pass++)
            {
                var at = Math.Max(plan.FromUt, ut - seconds.Value);
                var settled = Between(from, to, plan, home, antennas, at, lightFactor);
                if (settled == null || Math.Abs(settled.Value - seconds.Value) < SettledToSeconds)
                {
                    return settled;
                }
                seconds = settled;
            }
            return seconds;
        }

        private const int SettlePasses = 6;

        private const double SettledToSeconds = 0.001;

        /// <summary>
        /// The signal delay of the route the plan has open now between two nodes,
        /// measured as <c>comms.delay</c> measures a path: the length of each
        /// hop to where its receiver will be, at the speed the game is set to
        /// model. Zero for a node and itself, null with no open route.
        /// </summary>
        public static double? Between(
            string? from,
            string? to,
            ContactPlan? plan,
            string? home,
            IReadOnlyCollection<string>? antennas,
            double ut,
            double lightFactor)
        {
            if (from == null || to == null)
            {
                return null;
            }
            if (from == to)
            {
                return 0.0;
            }
            if (plan == null)
            {
                return null;
            }
            return Over(
                ContactRouter.EarliestArrivalBetween(
                    plan, GroundNetwork.EndsOf(from, home, antennas), GroundNetwork.EndsOf(to, home, antennas), ut, null, lightFactor),
                lightFactor);
        }

        /// <param name="arrivals">
        /// The routes leaving <paramref name="from"/> at <paramref name="ut"/> over <paramref name="plan"/>,
        /// searched for on the first call that needs them and read on every later call with the same three.
        /// </param>
        private static double? Between(
            string? from,
            string? to,
            ContactPlan? plan,
            string? home,
            IReadOnlyCollection<string>? antennas,
            double ut,
            double lightFactor,
            ref EarliestArrivals? arrivals) =>
            Between(
                from,
                to,
                plan,
                from == null ? null : GroundNetwork.EndsOf(from, home, antennas),
                to == null ? null : GroundNetwork.EndsOf(to, home, antennas),
                ut,
                lightFactor,
                ref arrivals);

        /// <param name="fromEnds">The nodes <paramref name="from"/> sends by, or null when it is null.</param>
        /// <param name="toEnds">The nodes <paramref name="to"/> hears by, or null when it is null.</param>
        private static double? Between(
            string? from,
            string? to,
            ContactPlan? plan,
            IReadOnlyCollection<string>? fromEnds,
            IReadOnlyCollection<string>? toEnds,
            double ut,
            double lightFactor,
            ref EarliestArrivals? arrivals)
        {
            if (from == null || to == null)
            {
                return null;
            }
            if (from == to)
            {
                return 0.0;
            }
            if (plan == null)
            {
                return null;
            }
            arrivals ??= ContactRouter.EarliestArrivalsFrom(plan, fromEnds!, ut, null, lightFactor);
            return Over(arrivals.To(toEnds!), lightFactor);
        }

        /// <summary>The signal delay of <paramref name="route"/> when every hop of it is open as the message reaches it, or null.</summary>
        private static double? Over(ContactRoute? route, double lightFactor)
        {
            if (route == null || !route.Live)
            {
                return null;
            }
            var metres = 0.0;
            foreach (var hop in route.Hops)
            {
                metres += hop.DistanceMeters;
            }
            return metres / SignalDelay.SpeedOfLightMetersPerSecond * lightFactor;
        }
    }

    /// <summary>
    /// Which centres have left one command centre's own roster, and when each
    /// was last on it. A centre that has never been on that roster is not
    /// remembered: an absent id is a fact about what is unknown, not about
    /// what is reachable. Courier thread only.
    /// </summary>
    public sealed class RosterMemory
    {
        private readonly Dictionary<string, UnreachableCentreEntry> _lastOn = new Dictionary<string, UnreachableCentreEntry>(StringComparer.Ordinal);
        private readonly HashSet<string> _on = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// Notes the roster as it stands at <paramref name="ut"/>.
        /// <paramref name="heard"/> is the newest state the centre has received
        /// of each craft, which is what says why a craft left.
        /// </summary>
        public void Observe(IReadOnlyList<CommandCentreEntry> roster, double ut, IReadOnlyCollection<CraftState>? heard = null)
        {
            _on.Clear();
            foreach (var entry in roster)
            {
                if (entry.Id == null)
                {
                    continue;
                }
                _on.Add(entry.Id);
                _lastOn[entry.Id] = new UnreachableCentreEntry
                {
                    Id = entry.Id,
                    DisplayName = entry.DisplayName ?? "",
                    Kind = entry.Kind ?? "",
                    LastReachableUt = ut,
                };
            }
            foreach (var gone in _lastOn.Values)
            {
                if (!_on.Contains(gone.Id) && !CentreRoster.IsCraft(gone.Id))
                {
                    gone.Reason = UnreachableReason.NoLongerExists;
                }
            }
            if (heard == null)
            {
                return;
            }
            foreach (var state in heard)
            {
                if (!_on.Contains(state.Id) && _lastOn.TryGetValue(state.Id, out var gone))
                {
                    gone.Reason = state.Exists ? UnreachableReason.NoLongerCentre : UnreachableReason.NoLongerExists;
                }
            }
        }

        /// <summary>Every centre that has been on the roster and is not now, by id.</summary>
        public List<UnreachableCentreEntry> Unreachable()
        {
            var gone = new List<UnreachableCentreEntry>();
            foreach (var entry in _lastOn.Values)
            {
                if (!_on.Contains(entry.Id))
                {
                    gone.Add(entry);
                }
            }
            gone.Sort((a, b) => string.CompareOrdinal(a.Id, b.Id));
            return gone;
        }
    }
}
