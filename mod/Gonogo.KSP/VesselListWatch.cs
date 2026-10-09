namespace Gonogo.KSP
{
    /// <summary>
    /// <see cref="VesselListStanding"/> with the memory a scene change needs.
    ///
    /// <para>Entering the editor by reverting a flight replaces the game with
    /// the save from before launch, and for a while after the scene loads the
    /// live list and the game's own state can both be empty, which agree with
    /// each other and with a game that has no vessels. So from the change of
    /// scene out of flight, an empty list is unknown until it holds a vessel or
    /// has stayed empty for <see cref="GraceSeconds"/>.</para>
    ///
    /// <para>Main thread only.</para>
    /// </summary>
    public sealed class VesselListWatch
    {
        /// <summary>How long a list that stays empty after a change of scene is unknown before it is taken as empty.</summary>
        public const double GraceSeconds = 5.0;

        private string? _scene;
        private bool _hadFlight;
        private double _changedAt;
        private bool _settling;

        /// <summary>The one watch the capture paths share, so a scene change is seen once.</summary>
        public static readonly VesselListWatch Shared = new VesselListWatch();

        /// <summary>True from a change of scene out of flight until the list is filled or the grace has passed.</summary>
        public bool Settling => _settling;

        /// <summary>Real time in seconds from a monotonic clock, for the <c>now</c> of <see cref="Stands"/>.</summary>
        public static double RealNow() => System.Diagnostics.Stopwatch.GetTimestamp() / (double)System.Diagnostics.Stopwatch.Frequency;

        /// <param name="scene">The loaded scene's name.</param>
        /// <param name="now">A monotonic clock in seconds, real time rather than game time.</param>
        public bool Stands(string scene, bool inFlight, bool flightReady, int listed, int? inGameState, double now)
        {
            if (scene != _scene)
            {
                _settling = _scene != null && _hadFlight && !inFlight;
                _changedAt = now;
                _hadFlight = inFlight;
                _scene = scene;
            }
            else if (inFlight)
            {
                _hadFlight = true;
            }

            if (_settling && (listed > 0 || now - _changedAt >= GraceSeconds))
            {
                _settling = false;
            }

            return !_settling && VesselListStanding.Stands(inFlight, flightReady, listed, inGameState);
        }
    }
}
