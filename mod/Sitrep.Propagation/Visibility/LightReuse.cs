using System;
using Sitrep.Contract;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// Whether a light prediction made for one set of orbital elements still
    /// answers for another. A craft flown under physics has its elements rebuilt
    /// from its state every frame, so they never repeat exactly while it coasts;
    /// two sets are the same orbit here when, under two-body motion, they put the
    /// craft within the distance it covers in <see cref="LightPrediction.ResolutionSeconds"/>
    /// of itself at every point of the window the prediction covers. Its sunrise
    /// and sunset then move by less than the resolution they are reported to.
    /// </summary>
    public static class LightReuse
    {
        /// <summary>Positions compared across the window, which spans at most two cycles.</summary>
        public const int Checkpoints = 17;

        /// <summary>
        /// The share of the distance covered in <see cref="LightPrediction.ResolutionSeconds"/>
        /// two positions may differ by, leaving room for a peak of the difference between checkpoints.
        /// </summary>
        public const double Allowance = 0.5;

        /// <summary>
        /// True when <paramref name="now"/> is the orbit <paramref name="kept"/> was,
        /// from <paramref name="fromUt"/> to <paramref name="toUt"/>. False for an
        /// orbit either set cannot be solved on, and for a window that is empty.
        /// </summary>
        public static bool SameOrbit(OrbitElements kept, OrbitElements now, double fromUt, double toUt)
        {
            if (!(toUt > fromUt) || double.IsInfinity(toUt - fromUt))
            {
                return false;
            }

            try
            {
                for (var i = 0; i < Checkpoints; i++)
                {
                    var ut = fromUt + ((toUt - fromUt) * i / (Checkpoints - 1));
                    var was = KeplerProvider.StateFrom(kept, ut);
                    var current = KeplerProvider.StateFrom(now, ut);
                    var apart = (was.Position - current.Position).Magnitude();
                    var allowed = Allowance * LightPrediction.ResolutionSeconds * was.Velocity.Magnitude();
                    if (!(apart <= allowed))
                    {
                        return false;
                    }
                }
            }
            catch (ArgumentOutOfRangeException)
            {
                return false;
            }

            return true;
        }
    }
}
