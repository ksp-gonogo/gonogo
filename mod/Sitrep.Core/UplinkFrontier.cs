using System;
using System.Collections.Generic;

namespace Sitrep.Core
{
    /// <summary>
    /// The newest instant of a command centre's knowledge that has reached one
    /// lens: the running maximum of <c>now - oneWaySeconds</c> over every tick
    /// the path from the centre to the lens existed.
    ///
    /// <para>Two rules follow from it being a running maximum. A path that
    /// lengthens never takes back what already arrived, because the instant stays
    /// where it was until the longer path catches up. A path that is lost freezes
    /// it, and nothing is read from the last finite delay: no path means nothing
    /// new has been delivered, not that the delay stayed the same.</para>
    ///
    /// <para>Only an instant sent while the path stood counts, and the path is
    /// known to have stood only from the first tick that saw it. So the instant
    /// holds from the first tick until one delay has passed, then reads the
    /// centre's state as of that tick; and after a loss it holds until the path
    /// returns and one delay has passed, then reads the state as of the return,
    /// never anything sent during the outage.</para>
    /// </summary>
    public sealed class UplinkFrontier
    {
        private double _deliveredUt = double.NegativeInfinity;

        // The first tick of the path that stands now, or null while there is none.
        private double? _pathSinceUt;

        /// <summary>Whether any of the centre's knowledge has reached the lens yet.</summary>
        public bool HasDelivered => !double.IsNegativeInfinity(_deliveredUt);

        /// <summary>The newest instant that has reached the lens; meaningful only when <see cref="HasDelivered"/>.</summary>
        public double DeliveredUt => _deliveredUt;

        /// <summary>
        /// Takes one tick's view of the path. <paramref name="oneWaySeconds"/> is
        /// the centre-to-lens delay while a path exists, and null while none does.
        /// </summary>
        public void Advance(double nowUt, double? oneWaySeconds)
        {
            if (oneWaySeconds == null
                || double.IsNaN(oneWaySeconds.Value)
                || double.IsInfinity(oneWaySeconds.Value)
                || oneWaySeconds.Value < 0)
            {
                _pathSinceUt = null;
                return;
            }
            _pathSinceUt ??= nowUt;
            var sentUt = nowUt - oneWaySeconds.Value;
            if (sentUt >= _pathSinceUt.Value)
            {
                _deliveredUt = Math.Max(_deliveredUt, sentUt);
            }
        }
    }

    /// <summary>
    /// The knowledge delivered to a set of lens sites that share one scope: the
    /// centre's state as of the instant the slowest site has received, so no site
    /// in the scope is shown anything another site's path has not yet carried to it.
    ///
    /// <para>Its own instant is also a running maximum, so a site joining the scope
    /// before anything has reached it does not take back what the scope already
    /// holds.</para>
    /// </summary>
    public sealed class UplinkScopeFrontier
    {
        private readonly Dictionary<string, UplinkFrontier> _sites = new Dictionary<string, UplinkFrontier>(StringComparer.Ordinal);
        private double _deliveredUt = double.NegativeInfinity;

        /// <summary>Whether the scope holds any delivered knowledge.</summary>
        public bool HasDelivered => !double.IsNegativeInfinity(_deliveredUt);

        /// <summary>The instant of the centre's knowledge the scope holds; meaningful only when <see cref="HasDelivered"/>.</summary>
        public double DeliveredUt => _deliveredUt;

        /// <summary>
        /// Counts <paramref name="site"/> toward the scope. Until it has been delivered
        /// something, the scope gains nothing, so a site is joined before the first tick
        /// that could carry knowledge to the others.
        /// </summary>
        public void Join(string site)
        {
            if (!_sites.ContainsKey(site))
            {
                _sites[site] = new UplinkFrontier();
            }
        }

        /// <summary>Takes one site's view of its path for this tick, then re-derives the scope's instant from every site.</summary>
        public void Advance(string site, double nowUt, double? oneWaySeconds)
        {
            Join(site);
            _sites[site].Advance(nowUt, oneWaySeconds);

            var slowest = double.PositiveInfinity;
            foreach (var member in _sites.Values)
            {
                if (!member.HasDelivered)
                {
                    return;
                }
                slowest = Math.Min(slowest, member.DeliveredUt);
            }
            _deliveredUt = Math.Max(_deliveredUt, slowest);
        }

        /// <summary>Stops counting <paramref name="site"/> toward the scope's slowest member.</summary>
        public void Remove(string site) => _sites.Remove(site);
    }
}
