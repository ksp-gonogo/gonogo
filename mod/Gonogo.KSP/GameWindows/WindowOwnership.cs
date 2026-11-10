namespace Gonogo.KSP.GameWindows
{
    /// <summary>
    /// Whether the session a hidden window was opened for is still there to see
    /// it. A window with no such session is shown again in the game, so a player
    /// there can close it. Kept apart from the capture so it can be tested without
    /// the game.
    /// </summary>
    internal sealed class WindowOwnership
    {
        /// <summary>
        /// How long a session has to be seen not reading the windows topic before
        /// it is taken to have stopped. Its reader unsubscribes and subscribes
        /// again whenever the screen redraws around it, so a gap shorter than this
        /// is not the session leaving. It is also how long after the press a
        /// session has to make its first subscription, which the panel that the
        /// same click opens makes a moment later.
        /// </summary>
        internal const double SubscribeGraceSeconds = 5.0;

        private double _since;
        private double? _absentSince;

        internal WindowOwnership(double now)
        {
            _since = now;
        }

        /// <summary>A new press has taken the window over: the wait for its session starts again.</summary>
        internal void Rebind(double now)
        {
            _since = now;
            _absentSince = null;
        }

        /// <summary>
        /// Whether the window should go back to the game's own screen: its session
        /// has disconnected, or has not been reading the windows topic for the
        /// grace period, counted from the press or from the last time it was
        /// reading.
        /// </summary>
        internal bool ShouldRelease(double now, bool connected, bool subscribed)
        {
            if (!connected) return true;
            if (subscribed)
            {
                _absentSince = null;
                _since = now;
                return false;
            }

            _absentSince ??= _since;
            return now - _absentSince.Value >= SubscribeGraceSeconds;
        }
    }
}
