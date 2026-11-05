using System;

namespace Sitrep.Host
{
    /// <summary>
    /// The pair of docking ports the active vessel was last approaching, held
    /// so <c>vessel.dock</c> keeps reporting while the game clears the target at
    /// the dock. The pair is recalled only while the own port is in a stage of
    /// the dock itself (capture, join, release); a port back at rest, or one the
    /// caller says no longer belongs to the active vessel, forgets it. With no
    /// pair known, nothing is recalled: there is no default.
    /// </summary>
    public sealed class DockPairMemory<TPort> where TPort : class
    {
        private TPort? _own;
        private TPort? _target;

        /// <summary>Remembers the pair seen while a port was targeted.</summary>
        public void Seen(TPort own, TPort target)
        {
            _own = own;
            _target = target;
        }

        /// <summary>
        /// The remembered pair while the own port reads a stage of the dock,
        /// <paramref name="ownUsable"/> accepts the own port (still the active
        /// vessel's) and <paramref name="targetUsable"/> the target port (still
        /// there), otherwise null with the memory cleared.
        /// </summary>
        public (TPort Own, TPort Target)? Recall(
            Func<TPort, string?> state,
            Func<TPort, bool> ownUsable,
            Func<TPort, bool> targetUsable)
        {
            if (_own == null || _target == null)
            {
                return null;
            }

            if (!ownUsable(_own) || !targetUsable(_target) || !DockingModel.IsDockStage(DockingModel.ParsePortState(state(_own))))
            {
                _own = null;
                _target = null;
                return null;
            }

            return (_own, _target);
        }
    }
}
