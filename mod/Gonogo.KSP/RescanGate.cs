using System;

namespace Gonogo.KSP
{
    /// <summary>
    /// When a cached read of something on disk is due again: on the first read, when the
    /// save changes, when the game clock goes back (a revert or a load), and otherwise
    /// once per <c>intervalSeconds</c> of real time.
    ///
    /// <para>Real time rather than game time, because the game clock stands still in the
    /// editor, which is where the files change, and runs thousands of times faster under
    /// warp, where a game-time interval would read the disk every tick.</para>
    /// </summary>
    internal sealed class RescanGate
    {
        private readonly double _intervalSeconds;
        private bool _scanned;
        private string? _save;
        private double _ut;
        private double _wallSeconds;

        public RescanGate(double intervalSeconds)
        {
            _intervalSeconds = intervalSeconds;
        }

        /// <summary>Whether the cache must be read again.</summary>
        public bool Due(string save, double ut, double wallSeconds) =>
            !_scanned
            || !string.Equals(save, _save, StringComparison.Ordinal)
            || ut < _ut
            || wallSeconds - _wallSeconds >= _intervalSeconds;

        /// <summary>Records a read made now.</summary>
        public void Scanned(string save, double ut, double wallSeconds)
        {
            _scanned = true;
            _save = save;
            _ut = ut;
            _wallSeconds = wallSeconds;
        }

        /// <summary>Forgets the last read, so the next is due whatever the clocks say.</summary>
        public void Forget() => _scanned = false;
    }
}
