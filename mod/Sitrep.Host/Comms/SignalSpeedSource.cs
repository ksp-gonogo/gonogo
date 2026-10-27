using System;
using System.Threading;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The <c>signalSpeed</c> capability's provider: the speed signals travel
    /// at under the delay config in force, and a notice when it changes.
    /// </summary>
    public sealed class SignalSpeedSource : ISignalSpeed
    {
        private readonly Func<SignalDelayConfig> _config;
        private SignalSpeedReading _current;

        /// <param name="config">The effective delay config, every modifier and the comms-model rule folded in.</param>
        public SignalSpeedSource(Func<SignalDelayConfig> config)
        {
            _config = config ?? throw new ArgumentNullException(nameof(config));
            _current = Compute(_config());
        }

        public string ProviderId => "gonogo-signal-speed";

        public SignalSpeedReading Current => Volatile.Read(ref _current);

        public event Action<SignalSpeedReading>? Changed;

        /// <summary>
        /// Main thread: read the config again and, if the speed differs from
        /// the one held, take it and raise <see cref="Changed"/>.
        /// </summary>
        public void Refresh()
        {
            var next = Compute(_config());
            if (next.Same(_current))
            {
                return;
            }
            Volatile.Write(ref _current, next);
            Changed?.Invoke(next);
        }

        /*
         * A config that switches delay off, or whose scale is not a positive
         * number (which DelayFactor treats as off too), is a signal that is not
         * delayed, stated as null rather than as a speed.
         */
        private static SignalSpeedReading Compute(SignalDelayConfig config)
        {
            return new SignalSpeedReading(config.Enabled ? SignalDelay.EffectiveC(config) : null);
        }
    }
}
