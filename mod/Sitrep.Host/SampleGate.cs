namespace Sitrep.Host
{
    /// <summary>
    /// The per-physics-tick question <c>GonogoAddon.FixedUpdate</c> asks before
    /// sampling the game: <see cref="SampleCadence"/>'s UT gate, or its
    /// stopped-clock rule when the game clock has not moved since the previous
    /// tick. Holds the state both read, so a headless driver asks it exactly as
    /// the addon does.
    ///
    /// <para>A scene that is still loading is a stopped clock too: KSP names the
    /// scene it is going to at the load request and destroys the old scene's
    /// Planetarium during the load, so UT stands still under the new scene's
    /// name while half of that scene exists. The stopped-clock rule is held off
    /// from <see cref="SceneLoadRequested"/> until <see cref="SceneReady"/>; the
    /// UT gate is not, so a backward jump is still sampled at once.</para>
    /// </summary>
    public sealed class SampleGate
    {
        private double? _lastSampledUt;
        private double? _previousTickUt;
        private double _lastSampledRealSec;
        private bool _sceneLoading;

        /// <summary>A scene change was requested; the scene it names is not built yet.</summary>
        public void SceneLoadRequested() => _sceneLoading = true;

        /// <summary>The requested scene has finished loading.</summary>
        public void SceneReady() => _sceneLoading = false;

        /// <summary>
        /// Called once per physics tick with the game's UT, the warp rate and
        /// monotonic real time in seconds; true when this tick should sample,
        /// in which case it becomes the last sample.
        /// </summary>
        public bool Admit(double ut, double warpRate, double realSec)
        {
            var previousTickUt = _previousTickUt;
            _previousTickUt = ut;
            if (!SampleCadence.ShouldSample(ut, _lastSampledUt, SampleCadence.IntervalUtAt(warpRate))
                && (_sceneLoading || !SampleCadence.ShouldSampleStoppedClock(ut, previousTickUt, realSec - _lastSampledRealSec)))
            {
                return false;
            }
            _lastSampledUt = ut;
            _lastSampledRealSec = realSec;
            return true;
        }
    }
}
