using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What one command centre can work out about the strength of the hops it
    /// believes in: the comms backend's strength model for each pair, as the
    /// centre last heard either end's antennas, and the backend's rule for a
    /// whole path.
    ///
    /// <para>Nothing here reads the game. A model travels with the state of
    /// the craft it was made for, so a centre has it only once that craft's
    /// word has reached it, and evaluates it at the separation its own plan
    /// gives the hop.</para>
    /// </summary>
    public sealed class PathStrengths
    {
        private readonly Dictionary<string, CraftState> _heard = new Dictionary<string, CraftState>(StringComparer.Ordinal);
        private readonly Func<IReadOnlyList<double>, double> _combine;

        /// <param name="heard">Every craft the centre knows of, as it last heard it.</param>
        /// <param name="combine">The backend's rule for a whole path, or null for the least of its hops.</param>
        public PathStrengths(IEnumerable<CraftState> heard, Func<IReadOnlyList<double>, double>? combine)
        {
            foreach (var state in heard)
            {
                _heard[state.Id] = state;
            }
            _combine = combine ?? Weakest;
        }

        /// <summary>The least of the hops: what a path is worth when the backend states no rule, which never overstates it.</summary>
        public static double Weakest(IReadOnlyList<double> hopStrengths)
        {
            var least = double.PositiveInfinity;
            foreach (var strength in hopStrengths)
            {
                least = Math.Min(least, strength);
            }
            return double.IsPositiveInfinity(least) ? 0.0 : least;
        }

        /// <summary>
        /// The backend's facts for the hop between two nodes at a separation,
        /// from the model either end's craft was last heard with, or null when
        /// the centre has heard of no model for the pair.
        /// </summary>
        public ContactHopFacts? FactsOf(string fromId, string toId, double ut, double separationMeters)
        {
            var model = ModelOf(fromId, toId) ?? ModelOf(toId, fromId);
            if (model == null || double.IsNaN(separationMeters))
            {
                return null;
            }
            var facts = model.FactsAt(ut, separationMeters);
            return double.IsNaN(facts.Strength) ? (ContactHopFacts?)null : facts;
        }

        /// <summary>The strength of a path from its hops' strengths, or null when it has no hops or any hop has none.</summary>
        public double? Of(IReadOnlyList<double?> hopStrengths)
        {
            if (hopStrengths.Count == 0)
            {
                return null;
            }
            var known = new List<double>(hopStrengths.Count);
            foreach (var strength in hopStrengths)
            {
                if (strength == null)
                {
                    return null;
                }
                known.Add(strength.Value);
            }
            var whole = _combine(known);
            return double.IsNaN(whole) ? (double?)null : Math.Max(0.0, Math.Min(1.0, whole));
        }

        private IContactLinkStrength? ModelOf(string craftId, string otherId) =>
            _heard.TryGetValue(craftId, out var state) && state.Links.TryGetValue(otherId, out var link) ? link.Strength : null;
    }

    /// <summary>
    /// Stock CommNet's strength for one pair: how far inside its longest range
    /// the pair is, through the curve stock's antennas carry.
    ///
    /// <para>Stock takes one less the separation over the pair's longest range
    /// and puts it through each antenna's range curve, which on every stock
    /// antenna is the smooth step from nothing at the edge of range to full
    /// at no distance. A mod that gives an antenna another curve is not
    /// followed here.</para>
    /// </summary>
    public sealed class RangeCurveStrength : IContactLinkStrength
    {
        private readonly double _maxRangeMeters;

        /// <param name="maxRangeMeters">The pair's longest range, in metres.</param>
        public RangeCurveStrength(double maxRangeMeters) => _maxRangeMeters = maxRangeMeters;

        public ContactHopFacts FactsAt(double ut, double separationMeters)
        {
            if (!(_maxRangeMeters > 0.0) || !(separationMeters >= 0.0))
            {
                return new ContactHopFacts(0.0);
            }
            var inside = 1.0 - (separationMeters / _maxRangeMeters);
            return new ContactHopFacts(inside > 0.0 ? inside * inside * (3.0 - (2.0 * inside)) : 0.0);
        }
    }

    /// <summary>
    /// What a command centre is told of the strength of the active craft's
    /// link: measured where the craft's radio last reported on the very path
    /// the centre believes in, worked out for that path otherwise.
    /// </summary>
    public static class CentreSignal
    {
        /// <summary>One centre's signal and grading, and whether they are worked out.</summary>
        public readonly struct Told
        {
            public Told(double strength, bool modelled, CommsDegrade? degrade)
            {
                Strength = strength;
                Modelled = modelled;
                Degrade = degrade;
            }

            public double Strength { get; }

            public bool Modelled { get; }

            /// <summary>The grading, or null when the centre has heard no grading rule to apply.</summary>
            public CommsDegrade? Degrade { get; }
        }

        /// <param name="believed">The centre's believed path, with each hop's strength where one could be worked out.</param>
        /// <param name="believedStrength">The strength worked out for that whole path, or null when it could not be.</param>
        /// <param name="heard">The newest reading of the craft's radio to have reached the centre, or null.</param>
        /// <returns>What to tell the centre, or null when there is nothing to tell.</returns>
        public static Told? For(CommsPath believed, double? believedStrength, ContactRadio? heard)
        {
            if (heard != null && (!heard.Connected || SamePath(believed, heard)))
            {
                // The craft's own word: of the path the centre believes in, or that there is no link at all.
                return new Told(heard.Strength, false, heard.Degrade);
            }
            if (believedStrength != null)
            {
                return new Told(believedStrength.Value, true, heard == null ? null : GradedAt(heard.Degrade, believedStrength.Value));
            }
            return heard == null ? (Told?)null : new Told(heard.Strength, false, heard.Degrade);
        }

        private static bool SamePath(CommsPath believed, ContactRadio heard)
        {
            if (believed.Hops.Count == 0 || believed.Hops.Count != heard.Hops.Count)
            {
                return false;
            }
            for (var i = 0; i < heard.Hops.Count; i++)
            {
                if (believed.Hops[i].From != heard.Hops[i].From || believed.Hops[i].To != heard.Hops[i].To)
                {
                    return false;
                }
            }
            return true;
        }

        /// <summary>
        /// The grading rule the centre heard the radio graded by, applied to
        /// another strength. Every backend's rule grades a link by how far
        /// short of full strength it is, so only the level moves. A reading
        /// that was not graded stays ungraded.
        /// </summary>
        private static CommsDegrade GradedAt(CommsDegrade heard, double strength) => new CommsDegrade
        {
            ModelId = heard.ModelId,
            ModelName = heard.ModelName,
            Level = heard.Level == null ? (double?)null : Math.Max(0.0, Math.Min(1.0, 1.0 - strength)),
        };
    }
}
