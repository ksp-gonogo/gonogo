using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Watches one launch to its end, through the scene change a launch makes,
    /// and writes to KSP.log what <see cref="LaunchArrival"/> says: each scene
    /// the game is in, then either the arrival in flight or the scene it is
    /// stuck in. Removes itself when it has said one of the two.
    /// </summary>
    internal sealed class LaunchWatchdog : MonoBehaviour
    {
        private const string LogTag = "launch";

        /// <summary>Longer than a flight scene load takes with a full set of mods.</summary>
        public const double TimeoutSeconds = 60.0;

        private LaunchArrival? _arrival;
        private float _startedAt;

        public static void Begin()
        {
            var host = new GameObject("Gonogo.LaunchWatchdog");
            DontDestroyOnLoad(host);
            var watchdog = host.AddComponent<LaunchWatchdog>();
            watchdog._arrival = new LaunchArrival(TimeoutSeconds);
            watchdog._startedAt = Time.realtimeSinceStartup;
        }

        private void Update()
        {
            var arrival = _arrival;
            if (arrival == null)
            {
                Destroy(gameObject);
                return;
            }

            var scene = HighLogic.LoadedScene;
            var flightReady = scene == GameScenes.FLIGHT && FlightGlobals.ready && ActiveVesselScope.Current != null;
            var state = arrival.Observe(Time.realtimeSinceStartup - _startedAt, scene.ToString(), flightReady, out var line);
            if (line != null)
            {
                if (state == LaunchArrivalState.TimedOut)
                {
                    GonogoLog.Error(LogTag, line);
                }
                else
                {
                    GonogoLog.Info(LogTag, line);
                }
            }

            if (state != LaunchArrivalState.Waiting)
            {
                Destroy(gameObject);
            }
        }
    }
}
