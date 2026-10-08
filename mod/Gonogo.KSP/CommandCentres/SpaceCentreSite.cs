using Sitrep.Host.CommandCentres;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// Where the space centre stands, which is the game's own answer to where the
    /// career is run from. Stock's <see cref="SpaceCenter"/> exists only while a
    /// scene that has one is loaded, so the last position read is kept for the
    /// scenes that do not: it does not move within a save.
    /// </summary>
    internal static class SpaceCentreSite
    {
        private static SurfaceSite? _last;

        /// <summary>Main thread only.</summary>
        public static SurfaceSite? Current()
        {
            var centre = SpaceCenter.Instance;
            if (centre != null)
            {
                _last = new SurfaceSite(centre.Latitude, centre.Longitude);
            }

            return _last;
        }
    }
}
