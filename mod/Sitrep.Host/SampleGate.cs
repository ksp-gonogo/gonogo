namespace Sitrep.Host
{
    /// <summary>
    /// The per-physics-tick (or, while paused, per-frame) question <c>GonogoAddon.FixedUpdate</c> asks before
    /// sampling the game: <see cref="SampleCadence"/>'s UT gate, or its
    /// stopped-clock rule when the game clock has not moved since the previous
    /// tick. Holds the state both read, so a headless driver asks it exactly as
    /// the addon does.
    ///
    /// <para>A scene that is still loading is a stopped clock too: KSP names the
    /// scene it is going to at the load request and destroys the old scene's
    /// Planetarium during the load, so UT stands still under the new scene's
    /// name while half of that scene exists. The stopped-clock rule is held off
    /// while <see cref="LoadState"/> says a scene is loading, which for a flight
    /// runs until the vessels are built and not only until the scene stands; the
    /// UT gate is not held, so a backward jump is still sampled at once.</para>
    /// </summary>
    public sealed class SampleGate
    {
        private double? _lastSampledUt;
        private double? _previousTickUt;
        private double _lastSampledRealSec;
        private double? _slotBeforeLastUt;
        private double _slotBeforeLastRealSec;
        private readonly LoadState _load;
        private readonly TopicCadence? _cadence;

        /// <param name="cadence">
        /// The per-topic cadence whose fastest interval the gate admits ticks at;
        /// null gates at <see cref="SampleCadence.IntervalUt"/>.
        /// </param>
        public SampleGate(LoadState load, TopicCadence? cadence = null)
        {
            _load = load;
            _cadence = cadence;
        }

        /// <summary>
        /// Called once per physics tick with the game's UT, the warp rate and
        /// monotonic real time in seconds; true when this tick should sample,
        /// in which case it becomes the last sample.
        /// </summary>
        public bool Admit(double ut, double warpRate, double realSec)
        {
            var previousTickUt = _previousTickUt;
            _previousTickUt = ut;
            if (!SampleCadence.ShouldSample(ut, _lastSampledUt, SampleCadence.IntervalUtAt(warpRate, _cadence?.FastestIntervalUt ?? SampleCadence.IntervalUt))
                && (_load.Phase == GamePhase.Loading || !SampleCadence.ShouldSampleStoppedClock(ut, previousTickUt, realSec - _lastSampledRealSec)))
            {
                return false;
            }
            Take(ut, realSec);
            return true;
        }

        /// <summary>
        /// Gives back the slot of the admission just made, for a tick the engine
        /// declined and so never sampled: the next tick is admitted again where
        /// leaving it taken would wait a whole interval, a sample lost from the
        /// stream. Does nothing unless an admission is held.
        /// </summary>
        public void Decline()
        {
            if (!_holdsSlot)
            {
                return;
            }
            _holdsSlot = false;
            _lastSampledUt = _slotBeforeLastUt;
            _lastSampledRealSec = _slotBeforeLastRealSec;
        }

        private bool _holdsSlot;

        private void Take(double ut, double realSec)
        {
            _slotBeforeLastUt = _lastSampledUt;
            _slotBeforeLastRealSec = _lastSampledRealSec;
            _holdsSlot = true;
            _lastSampledUt = ut;
            _lastSampledRealSec = realSec;
        }

        /// <summary>
        /// Admits a sample outside the cadence, which becomes the last sample. Refused
        /// while a scene is loading, when the game is not safe to read.
        /// </summary>
        public bool TryForce(double ut, double realSec)
        {
            if (_load.Phase == GamePhase.Loading)
            {
                return false;
            }
            _previousTickUt = ut;
            Take(ut, realSec);
            return true;
        }

        /// <summary>
        /// Called once per rendered frame with the engine's time scale. A paused
        /// game (time scale 0) runs no physics tick, so the frame stands in for
        /// it: the clock is stopped, and the stopped-clock rule samples it on
        /// real time. At any other time scale the physics tick is the caller,
        /// and a frame never admits, so one cadence is not sampled twice.
        /// </summary>
        public bool AdmitFrame(double ut, double warpRate, double realSec, double timeScale) =>
            timeScale <= 0 && Admit(ut, warpRate, realSec);
    }
}
