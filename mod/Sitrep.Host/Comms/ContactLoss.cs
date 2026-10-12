using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host.Comms
{
    /// <summary>The closed vocabulary of <see cref="CommsNextLoss.Basis"/>.</summary>
    public static class NextLossBasis
    {
        /// <summary>The plan closes the last open route at the instant.</summary>
        public const string PredictedLoss = "predicted-loss";

        /// <summary>In contact through the plan's horizon.</summary>
        public const string NoLossInWindow = "no-loss-in-window";

        /// <summary>No route is open now.</summary>
        public const string OutOfContact = "out-of-contact";

        /// <summary>The centre holds no plan that includes the craft.</summary>
        public const string NotPlanned = "not-planned";

        /// <summary>There is no active craft.</summary>
        public const string NoCraft = "no-craft";
    }

    /// <summary>
    /// When a command centre's own contact plan next has no open route between
    /// it and one craft.
    ///
    /// <para>Route-aware: a craft is in contact while any chain of open windows,
    /// through relays or through any of the centre's own antennas, joins it to
    /// the centre. A handover from one relay to the next keeps the craft in
    /// contact, so the answer is the end of the whole chain and never the end
    /// of one window.</para>
    ///
    /// <para>Windows, not light time: a window's close is the instant the link
    /// ends, and that is what a loss of signal is. The router's own routes are
    /// timed by when a message would land, which is earlier by the signal
    /// delay and is not what an operator calls loss of signal.</para>
    /// </summary>
    public static class ContactLoss
    {
        /// <summary>The fewest boundaries worth searching past; a plan holds a handful of windows per pair.</summary>
        private const int MaxBoundaries = 4096;

        /// <summary>How far past a boundary the state is read, seconds: the boundary itself is the instant a window closes.</summary>
        private const double JustAfterSeconds = 1e-3;

        /// <param name="plan">The centre's own plan, or null when it has none.</param>
        /// <param name="craft">The active craft's id in the roster vocabulary, or null.</param>
        /// <param name="centre">The receiving centre's id.</param>
        /// <param name="home">The home centre, or null.</param>
        /// <param name="antennas">Every ground station, each of which is home's own antenna.</param>
        /// <param name="ut">Now.</param>
        /// <param name="unsettled">The nodes reckoned on an orbit that was still changing.</param>
        /// <param name="liveLink">
        /// Whether the craft's link is up as the centre last heard it: false is out of
        /// contact whatever the plan holds, since a loss is predicted of a link that is
        /// there. Null is no reading yet, which is not a disconnection, and the plan answers.
        /// </param>
        public static CommsNextLoss Next(
            ContactPlan? plan,
            string? craft,
            string centre,
            string? home,
            IReadOnlyCollection<string>? antennas,
            double ut,
            IReadOnlyCollection<string>? unsettled = null,
            bool? liveLink = null)
        {
            if (craft == null)
            {
                return new CommsNextLoss { Basis = NextLossBasis.NoCraft };
            }
            if (liveLink == false)
            {
                return new CommsNextLoss { Basis = NextLossBasis.OutOfContact, CoveredToUt = plan?.HorizonUt ?? ut };
            }
            if (plan == null || ut < plan.FromUt || !Includes(plan, craft))
            {
                return new CommsNextLoss { Basis = NextLossBasis.NotPlanned, CoveredToUt = plan?.HorizonUt ?? ut };
            }
            var sources = GroundNetwork.EndsOf(craft, home, antennas);
            var destinations = GroundNetwork.EndsOf(centre, home, antennas);
            var horizon = HorizonFor(plan, ut);
            var result = new CommsNextLoss { CoveredToUt = horizon };
            var rough = unsettled == null ? null : new HashSet<string>(unsettled, StringComparer.Ordinal);

            if (!Connected(plan, sources, destinations, ut))
            {
                result.Basis = NextLossBasis.OutOfContact;
                return result;
            }

            var boundaries = new SortedSet<double>();
            foreach (var pair in plan.Pairs)
            {
                foreach (var window in pair.Windows)
                {
                    if (window.CloseUt is double close && close > ut && close < horizon)
                    {
                        boundaries.Add(close);
                    }
                    if (window.OpenUt is double open && open > ut && open < horizon)
                    {
                        boundaries.Add(open);
                    }
                }
            }
            var searched = 0;
            foreach (var boundary in boundaries)
            {
                if (++searched > MaxBoundaries)
                {
                    break;
                }
                if (!Connected(plan, sources, destinations, boundary + JustAfterSeconds))
                {
                    result.Ut = boundary;
                    result.Basis = NextLossBasis.PredictedLoss;
                    result.LowConfidence = rough != null && (rough.Contains(craft) || rough.Contains(centre));
                    return result;
                }
            }
            result.Basis = NextLossBasis.NoLossInWindow;
            result.LowConfidence = rough != null && (rough.Contains(craft) || rough.Contains(centre));
            return result;
        }

        private static bool Includes(ContactPlan plan, string craft)
        {
            foreach (var pair in plan.Pairs)
            {
                if (pair.A == craft || pair.B == craft)
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>The plan's horizon, cut to the earliest of any pair's own horizon that still has windows ahead, because past it that pair is unknown.</summary>
        private static double HorizonFor(ContactPlan plan, double ut)
        {
            var horizon = plan.HorizonUt;
            foreach (var pair in plan.Pairs)
            {
                if (pair.HorizonUt < horizon && pair.HorizonUt > ut)
                {
                    horizon = pair.HorizonUt;
                }
            }
            return horizon;
        }

        private static bool Open(PairPlan pair, double ut)
        {
            foreach (var window in pair.Windows)
            {
                var opened = window.OpenUt == null || window.OpenUt.Value <= ut;
                var notClosed = window.CloseUt == null || window.CloseUt.Value > ut;
                if (opened && notClosed)
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>Whether any chain of open windows at <paramref name="ut"/> joins one of the sources to one of the destinations.</summary>
        private static bool Connected(ContactPlan plan, IReadOnlyCollection<string> sources, IReadOnlyCollection<string> destinations, double ut)
        {
            var reached = new HashSet<string>(sources, StringComparer.Ordinal);
            foreach (var source in sources)
            {
                if (destinations.Contains(source))
                {
                    return true;
                }
            }
            var open = new List<PairPlan>();
            foreach (var pair in plan.Pairs)
            {
                if (Open(pair, ut))
                {
                    open.Add(pair);
                }
            }
            var grew = true;
            while (grew)
            {
                grew = false;
                foreach (var pair in open)
                {
                    var a = reached.Contains(pair.A);
                    var b = reached.Contains(pair.B);
                    if (a == b)
                    {
                        continue;
                    }
                    var added = a ? pair.B : pair.A;
                    reached.Add(added);
                    grew = true;
                    if (destinations.Contains(added))
                    {
                        return true;
                    }
                }
            }
            return false;
        }
    }
}
