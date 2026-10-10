using System;

namespace Sitrep.Host
{
    /// <summary>
    /// Pure, KSP-free geometry for the terrain grid on <c>vessel.landing</c>: a
    /// square of heights around the predicted touchdown site, for the top-down view
    /// of the site. The capture reads <see cref="Size"/> by <see cref="Size"/>
    /// points on a regular grid, north-up, so the view has a real two-dimensional
    /// picture of the ground rather than a line of it.
    ///
    /// <para>A grid is many more terrain reads than the track strip, so it is taken
    /// less often (see <see cref="NeedsRefresh"/>), and the last one is sent again in
    /// between.</para>
    /// </summary>
    public static class LandingSiteGrid
    {
        /// <summary>Points along each side of the grid.</summary>
        public const int Size = 24;

        /// <summary>The least half width of the grid, metres, so a vessel about to touch down still has ground to show.</summary>
        public const double MinHalfExtentMeters = 60.0;

        /// <summary>How much more than the window's reach from the site the grid covers, as a multiple, so its edge is clear of what it must show.</summary>
        public const double ReachMargin = 1.1;

        /// <summary>The longest a grid is kept, seconds, however little has changed.</summary>
        public const double RefreshSeconds = 1.0;

        /// <summary>The shortest time between two grids, seconds, however far the site has moved.</summary>
        public const double MinRefreshSeconds = 0.25;

        /// <summary>How far the grid's extent may change before it is retaken early, as a fraction.</summary>
        public const double ExtentChangeFraction = 0.25;

        /// <summary>The touchdown plot's half width at touchdown, metres, as it draws its window (50 m with its padding of 40%).</summary>
        public const double WindowMinHalfMeters = 70.0;

        /// <summary>How much the window's half width grows per metre of the vessel's height.</summary>
        public const double WindowHalfPerHeight = 0.9;

        /// <summary>The window's room around the vessel and the site, as a multiple of half their distance.</summary>
        public const double WindowSitePadding = 1.4;

        /// <summary>
        /// Half the grid's width, metres: enough to hold the whole window the
        /// touchdown plot draws, so the plot never shows a stretch of ground the grid
        /// does not carry and the cells stay narrow enough to read at every zoom. The
        /// plot's window is centred between the vessel and the site, so it reaches
        /// half their distance, plus its own half width, from the site; its own half
        /// width is the larger of <see cref="WindowMinHalfMeters"/> plus
        /// <see cref="WindowHalfPerHeight"/> times the vessel's height, and
        /// <see cref="WindowSitePadding"/> times half the distance. Never less than
        /// <see cref="MinHalfExtentMeters"/>.
        /// </summary>
        public static double HalfExtentMeters(double siteAheadMeters, double heightMeters)
        {
            var site = Math.Abs(Finite(siteAheadMeters));
            var half = Math.Max(
                WindowMinHalfMeters + Math.Max(0.0, Finite(heightMeters)) * WindowHalfPerHeight,
                site / 2 * WindowSitePadding);
            return Math.Max(MinHalfExtentMeters, (site / 2 + half) * ReachMargin);
        }

        private static double Finite(double value) =>
            double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;

        /// <summary>The ground between one point and the next, metres.</summary>
        public static double CellMeters(double halfExtentMeters) => 2 * halfExtentMeters / Size;

        /// <summary>
        /// The offset of a point's centre from the middle of the grid, metres east and
        /// north. Row 0 is the northern row and column 0 the western column, so a
        /// reader that lays the values out row by row has north at the top.
        /// </summary>
        public static (double east, double north) Offset(int row, int column, double halfExtentMeters)
        {
            var cell = CellMeters(halfExtentMeters);
            return (
                -halfExtentMeters + (column + 0.5) * cell,
                halfExtentMeters - (row + 0.5) * cell);
        }

        /// <summary>
        /// Whether the grid should be taken again. Never faster than
        /// <see cref="MinRefreshSeconds"/>; at once after that when the site has moved
        /// a point's width or the extent has changed by <see cref="ExtentChangeFraction"/>;
        /// and always after <see cref="RefreshSeconds"/>.
        /// </summary>
        public static bool NeedsRefresh(
            bool haveGrid,
            double secondsSinceLast,
            double siteMovedMeters,
            double halfExtentMeters,
            double lastHalfExtentMeters)
        {
            if (!haveGrid) return true;
            if (secondsSinceLast < MinRefreshSeconds) return false;
            if (secondsSinceLast >= RefreshSeconds) return true;
            if (siteMovedMeters > CellMeters(lastHalfExtentMeters)) return true;
            return Math.Abs(halfExtentMeters - lastHalfExtentMeters)
                > ExtentChangeFraction * lastHalfExtentMeters;
        }
    }
}
