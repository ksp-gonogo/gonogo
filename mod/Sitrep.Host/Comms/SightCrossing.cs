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
        /// When the line from <paramref name="craft"/> to the centre closed
        /// (<paramref name="closing"/>) or opened, strictly after
        /// <paramref name="fromUt"/> and before <paramref name="toUt"/>, or null
        /// when the craft cannot be reckoned across the span or the span holds
        /// no single crossing.
        ///
        /// <para>A centre that is itself a station is judged by its own line.
        /// The home centre sees through every ground station, so its line
        /// closes when the last of them closes and opens when the first
        /// does.</para>
        /// </summary>
        /// <param name="craft">The craft as last read; one still changing its orbit is not reckoned.</param>
        /// <param name="ground">The stations and bodies.</param>
        /// <param name="stations">The stations that stand for the centre.</param>
        public static double? Between(CraftState craft, PlanGround ground, IReadOnlyList<PlanNode> stations, double fromUt, double toUt, bool closing)
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

            double? crossing = null;
            foreach (var pair in plan.Pairs)
            {
                double? own = null;
                foreach (var window in pair.Windows)
                {
                    double? edge = closing ? (window.OpenUt == null ? window.CloseUt : null) : window.OpenUt;
                    if (edge != null && edge > fromUt && edge < toUt)
                    {
                        own = edge;
                    }
                }
                if (own == null)
                {
                    continue;
                }
                crossing = crossing == null ? own : closing ? Math.Max(crossing.Value, own.Value) : Math.Min(crossing.Value, own.Value);
            }
            return crossing;
        }
    }
}
