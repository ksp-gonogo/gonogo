using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// What <see cref="ContactLoss.Next"/> answers, worked out the plain way: at every
    /// instant it reads, every window of every pair is asked whether it is open and the
    /// open pairs are joined up from nothing. Far too slow to run each second, and so
    /// simple that it is what the answer means, which makes it what the fast search is
    /// held to.
    /// </summary>
    internal static class ContactLossBySearch
    {
        private const int MaxBoundaries = 4096;

        private const double JustAfterSeconds = 1e-3;

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
                var down = new CommsNextLoss { Basis = NextLossBasis.OutOfContact, CoveredToUt = plan?.HorizonUt ?? ut };
                if (plan != null && ut >= plan.FromUt && Includes(plan, craft))
                {
                    var from = GroundNetwork.EndsOf(craft, home, antennas);
                    var to = GroundNetwork.EndsOf(centre, home, antennas);
                    down.NextAcquisitionUt = Connected(plan, from, to, ut)
                        ? CurrentConnectionStart(plan, from, to, ut)
                        : NextConnected(plan, from, to, ut, HorizonFor(plan, ut));
                }
                return down;
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
                result.NextAcquisitionUt = NextConnected(plan, sources, destinations, ut, horizon);
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

        private static double? NextConnected(
            ContactPlan plan, IReadOnlyCollection<string> sources, IReadOnlyCollection<string> destinations, double ut, double horizon)
        {
            var opens = new SortedSet<double>();
            foreach (var pair in plan.Pairs)
            {
                foreach (var window in pair.Windows)
                {
                    if (window.OpenUt is double open && open > ut && open < horizon)
                    {
                        opens.Add(open);
                    }
                }
            }
            var searched = 0;
            foreach (var open in opens)
            {
                if (++searched > MaxBoundaries)
                {
                    break;
                }
                if (Connected(plan, sources, destinations, open + JustAfterSeconds))
                {
                    return open;
                }
            }
            return null;
        }
        private static double CurrentConnectionStart(
            ContactPlan plan, IReadOnlyCollection<string> sources, IReadOnlyCollection<string> destinations, double ut)
        {
            var opens = new SortedSet<double>();
            foreach (var pair in plan.Pairs)
            {
                foreach (var window in pair.Windows)
                {
                    if (window.OpenUt is double open && open <= ut)
                    {
                        opens.Add(open);
                    }
                }
            }
            foreach (var open in opens.Reverse())
            {
                if (!Connected(plan, sources, destinations, open - JustAfterSeconds))
                {
                    return open;
                }
            }
            return plan.FromUt;
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
