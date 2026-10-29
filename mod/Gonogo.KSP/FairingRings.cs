using System;
using System.Collections.Generic;
using System.Globalization;

namespace Gonogo.KSP
{
    /// <summary>
    /// A procedural fairing's shell as the flat ring list a part row carries:
    /// height then radius for each saved section, in height order, and the
    /// nose tip the fairing module adds above a closed shell.
    /// </summary>
    internal static class FairingRings
    {
        /// <summary>
        /// The rings of a shell built from <paramref name="sections"/> (height,
        /// radius), as <c>h0, r0, h1, r1, ...</c>. When there are two sections
        /// or more and the top one's radius is <paramref name="capRadius"/>, a
        /// ring of radius 0 follows it at <c>top.r * tan(slope) * noseTip</c>
        /// above it, the slope being that of the top panel: the nose tip
        /// <c>FairingPanel.SetupPanelArray</c> builds. A top panel that does not
        /// narrow gets no tip. Empty when there are no
        /// sections, so no shell stands.
        /// </summary>
        public static List<double> Of(IEnumerable<KeyValuePair<double, double>> sections, float capRadius, float noseTip)
        {
            var sorted = new List<KeyValuePair<double, double>>(sections);
            /* The module sorts its sections by height when it loads them, and builds panels between neighbours in that order. */
            sorted.Sort((a, b) => a.Key.CompareTo(b.Key));
            var rings = new List<double>(sorted.Count * 2 + 2);
            foreach (var section in sorted)
            {
                rings.Add(Round(section.Key));
                rings.Add(Round(section.Value));
            }

            if (sorted.Count < 2)
            {
                return rings;
            }

            var top = sorted[sorted.Count - 1];
            var below = sorted[sorted.Count - 2];
            /*
             * The module compares the stored floats exactly, so this does too. A top panel
             * that does not narrow has no slope to carry on, and the module's tip there
             * would stand at or past infinity, so it is left out.
             */
            if ((float)top.Value != capRadius || below.Value - top.Value <= 1e-9)
            {
                return rings;
            }

            var slope = Math.Atan((top.Key - below.Key) / (below.Value - top.Value));
            var tip = top.Key + top.Value * Math.Tan(slope) * noseTip;

            rings.Add(Round(tip));
            rings.Add(0.0);
            return rings;
        }

        /// <summary>A saved section's height and radius from its <c>h</c> and <c>r</c> values, or null when either does not parse.</summary>
        public static KeyValuePair<double, double>? Parse(string? h, string? r)
        {
            if (!TryNumber(h, out var height) || !TryNumber(r, out var radius))
            {
                return null;
            }
            return new KeyValuePair<double, double>(height, radius);
        }

        private static bool TryNumber(string? text, out double value) =>
            double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out value)
            && !double.IsNaN(value)
            && !double.IsInfinity(value);

        private static double Round(double v) => Math.Round(v, 4);
    }
}
