namespace Sitrep.Host
{
    /// <summary>
    /// Decides, in wall-clock seconds, when a whole-aggregate topic may be sent again.
    /// A sampled source runs on game time, and above 10x warp the sampler fires about ten times
    /// per real second, so an aggregate that republishes per sample puts its whole payload on the
    /// wire at that rate however little changed. Unchanged content goes out once per
    /// <see cref="KeyframeRealSec"/>, changed content at most once per <see cref="ChangeFloorRealSec"/>.
    /// </summary>
    public sealed class RealTimeRepublishGate
    {
        public const double ChangeFloorRealSec = 1.0;

        public const double KeyframeRealSec = 30.0;

        private double? _lastSentRealSec;

        /// <summary>True when a send is due; records the send when it is.</summary>
        public bool Admit(bool changed, double realSec)
        {
            if (_lastSentRealSec is not double last)
            {
                _lastSentRealSec = realSec;
                return true;
            }
            var since = realSec - last;
            // A clock that went backwards must not hold the topic silent until it catches up.
            var due = since < 0 || since >= (changed ? ChangeFloorRealSec : KeyframeRealSec);
            if (due)
            {
                _lastSentRealSec = realSec;
            }
            return due;
        }
    }
}
