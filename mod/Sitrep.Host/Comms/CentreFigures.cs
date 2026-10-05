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
    /// So a centre is never quoted a light-time to a craft it has not heard
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
        /// <param name="lightFactor">What a real light time is multiplied by: see <see cref="DeliveryInputs.LightFactor"/>.</param>
        public static CommandCentreSeparation Separation(
            IReadOnlyList<CommandCentreEntry> roster,
            ContactPlan? plan,
            string? home,
            IReadOnlyCollection<string>? antennas,
            double ut,
            double lightFactor)
        {
            var pairs = new List<CentreSeparationEntry>();
            foreach (var from in roster)
            {
                foreach (var to in roster)
                {
                    var seconds = Between(from.Id, to.Id, plan, home, antennas, ut, lightFactor);
                    if (seconds != null)
                    {
                        pairs.Add(new CentreSeparationEntry { From = from.Id!, To = to.Id!, OneWaySeconds = seconds.Value });
                    }
                }
            }
            return new CommandCentreSeparation { Pairs = pairs };
        }

        /// <summary>
        /// Each centre on <paramref name="roster"/>'s own delay to the active
        /// craft, as the receiving centre's plan has it. The home centre is
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
            double lightFactor)
        {
            var centres = new List<CentreDelayEntry>();
            if (activeCraft == null)
            {
                return new CommandCentreActiveVesselDelay { Centres = centres };
            }
            foreach (var centre in roster)
            {
                if (centre.Id == null || centre.Id == home)
                {
                    continue;
                }
                var seconds = Between(activeCraft, centre.Id, plan, home, antennas, ut, lightFactor);
                if (seconds != null)
                {
                    centres.Add(new CentreDelayEntry { Id = centre.Id, OneWaySeconds = seconds.Value });
                }
            }
            return new CommandCentreActiveVesselDelay { Centres = centres };
        }

        /// <summary>
        /// The light-time of the route the plan has open now between two nodes,
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
            var route = ContactRouter.EarliestArrivalBetween(
                plan, GroundNetwork.EndsOf(from, home, antennas), GroundNetwork.EndsOf(to, home, antennas), ut, null, lightFactor);
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

        /// <summary>Notes the roster as it stands at <paramref name="ut"/>.</summary>
        public void Observe(IReadOnlyList<CommandCentreEntry> roster, double ut)
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
