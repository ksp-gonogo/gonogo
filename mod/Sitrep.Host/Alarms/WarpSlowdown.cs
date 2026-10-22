using System;
using System.Collections.Generic;

namespace Sitrep.Host.Alarms
{
    /// <summary>Picking a rung of the warp ladder from a rate the alarms allow.</summary>
    public static class WarpSlowdown
    {
        /// <summary>
        /// The highest rung whose rate is at or below <paramref name="maxRate"/>, or
        /// null when the current rung is already within it, so the caller sends
        /// nothing. Rung 0 is the floor: a rate below every rung still answers 0.
        /// </summary>
        public static int? SlowTo(IReadOnlyList<double> rates, int currentIndex, double maxRate)
        {
            if (rates.Count == 0 || currentIndex <= 0 || currentIndex >= rates.Count)
            {
                return null;
            }
            if (double.IsNaN(maxRate) || rates[currentIndex] <= maxRate)
            {
                return null;
            }
            var target = 0;
            for (var i = 1; i < rates.Count && i < currentIndex; i++)
            {
                if (rates[i] <= maxRate)
                {
                    target = i;
                }
            }
            return target;
        }
    }
}
