namespace Gonogo.KSP
{
    /// <summary>What <see cref="LaunchArrival"/> says to do with one observation.</summary>
    internal enum LaunchArrivalState
    {
        Waiting,
        Arrived,
        TimedOut,
    }

    /// <summary>
    /// Follows a launch from the moment the game was asked to load the flight
    /// scene until a vessel is active in it, or until the allowed time runs out.
    /// <c>ksp.launch</c> answers as soon as the load has been started, so this
    /// is the only thing that can say whether the launch ended in flight, and
    /// which scene it was left in when it did not.
    /// </summary>
    internal sealed class LaunchArrival
    {
        private readonly double _timeoutSeconds;
        private string? _lastScene;

        public LaunchArrival(double timeoutSeconds)
        {
            _timeoutSeconds = timeoutSeconds;
        }

        /// <summary>
        /// One look at the game. <paramref name="line"/> is a log line when the
        /// scene differs from the last observation, when the vessel arrives, or
        /// when time runs out, and null otherwise.
        /// </summary>
        /// <param name="elapsedSeconds">Real seconds since the load was started.</param>
        /// <param name="scene">The loaded scene's name.</param>
        /// <param name="flightReady">Whether the flight scene is loaded, ready, and has an active vessel.</param>
        public LaunchArrivalState Observe(double elapsedSeconds, string scene, bool flightReady, out string? line)
        {
            line = null;
            if (flightReady)
            {
                line = "launch reached " + scene + " with the vessel active after " + Seconds(elapsedSeconds);
                return LaunchArrivalState.Arrived;
            }

            if (elapsedSeconds >= _timeoutSeconds)
            {
                line = "launch did not reach flight within " + Seconds(_timeoutSeconds)
                    + ": the game is in " + scene + " with no active vessel";
                return LaunchArrivalState.TimedOut;
            }

            if (scene != _lastScene)
            {
                _lastScene = scene;
                line = "launch at " + Seconds(elapsedSeconds) + ": scene " + scene + ", no active vessel yet";
            }
            return LaunchArrivalState.Waiting;
        }

        private static string Seconds(double value)
        {
            return value.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + " s";
        }
    }
}
