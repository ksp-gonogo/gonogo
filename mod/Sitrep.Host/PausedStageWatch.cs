namespace Sitrep.Host
{
    /// <summary>
    /// Decides when the stock stage delta-v simulation must be asked to recalculate while the
    /// game is paused. The simulation's own refresh timers run on scaled game time, which
    /// stands still at pause, so a staging made just before the pause would otherwise leave
    /// its figures on the dropped stage until time runs again. Remembers the last stage seen
    /// per vessel so one change asks once.
    /// </summary>
    public sealed class PausedStageWatch
    {
        private string? _vesselId;
        private int _stage;

        /// <summary>
        /// True when the game is paused and <paramref name="stage"/> differs from the stage last
        /// seen on <paramref name="vesselId"/>. The first sight of a vessel never asks, since the
        /// simulation has just been built for it.
        /// </summary>
        public bool ShouldRecalculate(string vesselId, int stage, bool paused)
        {
            var known = _vesselId == vesselId;
            var changed = known && stage != _stage;
            _vesselId = vesselId;
            _stage = stage;
            return paused && changed;
        }
    }
}
