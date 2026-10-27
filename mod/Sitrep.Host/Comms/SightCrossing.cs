using System;
using System.Collections.Generic;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The instant a craft's line to ground stations closed or opened between
    /// two looks at the game, solved from the craft's orbit and the bodies over
    /// the span the looks left unobserved.
    /// </summary>
    public static class SightCrossing
    {
        private const double MinimumSpanSeconds = 0.01;

        /// <summary>
        /// Every instant the line from <paramref name="craft"/> to the centre
        /// closed or opened, strictly after <paramref name="fromUt"/> and before
        /// <paramref name="toUt"/>, oldest first, each with the one-way light
        /// time at that instant. Null when the craft cannot be reckoned across
        /// the span, so what happened inside it is not known.
        ///
        /// <para>A centre that is itself a station is judged by its own line.
        /// The home centre sees through every ground station, so its line is in
        /// view while any of them is: it closes when the last of them closes
        /// and opens when the first does.</para>
        /// </summary>
        /// <param name="craft">The craft as last read; one still changing its orbit is not reckoned.</param>
        /// <param name="ground">The stations and bodies.</param>
        /// <param name="stations">The stations that stand for the centre.</param>
        public static IReadOnlyList<LineChange>? Between(CraftState craft, PlanGround ground, IReadOnlyList<PlanNode> stations, double fromUt, double toUt)
        {
            var span = toUt - fromUt;
            var node = craft.ToPlanNode();
            if (node == null || !craft.Settled || craft.Surface != null || stations.Count == 0 || !(span > MinimumSpanSeconds))
            {
                return null;
            }
            var request = ReckonedPlan.OpenSkyRequest(craft, ground, stations, fromUt, span);
            if (request == null)
            {
                return null;
            }
            var plan = request.Run();

            var stretches = new List<Stretch>();
            foreach (var pair in plan.Pairs)
            {
                foreach (var window in pair.Windows)
                {
                    stretches.Add(new Stretch(window.OpenUt ?? fromUt, window.CloseUt ?? toUt, pair, window.OpenUt != null, window.CloseUt != null));
                }
            }
            stretches.Sort((a, b) => a.Open.CompareTo(b.Open));

            var changes = new List<LineChange>();
            var index = 0;
            while (index < stretches.Count)
            {
                var first = stretches[index];
                var open = first;
                var close = first;
                index++;
                while (index < stretches.Count && stretches[index].Open <= close.Close)
                {
                    if (stretches[index].Open < open.Open)
                    {
                        open = stretches[index];
                    }
                    if (stretches[index].Close > close.Close)
                    {
                        close = stretches[index];
                    }
                    index++;
                }
                if (open.OpensInside && open.Open > fromUt && open.Open < toUt)
                {
                    changes.Add(new LineChange(open.Open, true, open.Pair.SeparationAt(open.Open) / PairPlan.SpeedOfLight));
                }
                if (close.ClosesInside && close.Close > fromUt && close.Close < toUt)
                {
                    changes.Add(new LineChange(close.Close, false, close.Pair.SeparationAt(close.Close) / PairPlan.SpeedOfLight));
                }
            }
            changes.Sort((a, b) => a.Ut.CompareTo(b.Ut));
            return changes;
        }

        private readonly struct Stretch
        {
            public Stretch(double open, double close, PairPlan pair, bool opensInside, bool closesInside)
            {
                Open = open;
                Close = close;
                Pair = pair;
                OpensInside = opensInside;
                ClosesInside = closesInside;
            }

            public double Open { get; }

            public double Close { get; }

            public PairPlan Pair { get; }

            public bool OpensInside { get; }

            public bool ClosesInside { get; }
        }
    }

    /// <summary>
    /// The line from a craft to a centre opening or closing at <see cref="Ut"/>,
    /// and the one-way light time between them at that instant, or null when it
    /// could not be worked out.
    /// </summary>
    public readonly struct LineChange
    {
        public LineChange(double ut, bool opened, double? delaySeconds)
        {
            Ut = ut;
            Opened = opened;
            DelaySeconds = delaySeconds;
        }

        public double Ut { get; }

        public bool Opened { get; }

        public double? DelaySeconds { get; }
    }
}
