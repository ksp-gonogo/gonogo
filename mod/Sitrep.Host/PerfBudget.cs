using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// Soft performance budget, the mod-side counterpart to the app's
    /// <c>@ksp-gonogo/core</c> <c>PerfBudget</c>
    /// (<c>packages/core/src/perf/PerfBudget.ts</c>): tracks a volume over a
    /// rolling window and warns (rate-limited to once per window) when a
    /// threshold is exceeded. No throw, no behavioural change: the budget is
    /// purely diagnostic.
    ///
    /// <para>Keyed on whatever time axis the caller already samples on
    /// (typically UT, since a KSP-side capture cadence is driven by UT, not
    /// wall clock - see <c>GonogoAddon.SampleIntervalUt</c>). Nothing here
    /// calls a clock itself, so it stays KSP-free and unit-testable.</para>
    /// </summary>
    public sealed class PerfBudget
    {
        private readonly string _name;
        private readonly double _threshold;
        private readonly double _windowSec;
        private readonly string _unit;
        private readonly Action<string> _warn;

        private readonly List<(double At, double Amount)> _events = new List<(double, double)>();
        private double _currentSum;
        private double _lastWarnAt = double.NegativeInfinity;
        private int _exceedanceCount;

        public PerfBudget(string name, double threshold, double windowSec = 1.0, string unit = "events", Action<string>? warn = null)
        {
            _name = name ?? throw new ArgumentNullException(nameof(name));
            if (!(threshold > 0)) throw new ArgumentOutOfRangeException(nameof(threshold));
            if (!(windowSec > 0)) throw new ArgumentOutOfRangeException(nameof(windowSec));

            _threshold = threshold;
            _windowSec = windowSec;
            _unit = unit ?? "events";
            _warn = warn ?? (message => Console.Error.WriteLine(message));
        }

        public string Name => _name;
        public double Threshold => _threshold;
        public double WindowSec => _windowSec;
        public int ExceedanceCount => _exceedanceCount;

        /// <summary>
        /// Records <paramref name="amount"/> units at <paramref name="at"/>
        /// (the caller's own time axis). Warns, rate-limited to once per
        /// window, when the windowed sum exceeds the threshold.
        /// </summary>
        public void Record(double amount, double at)
        {
            _events.Add((at, amount));
            _currentSum += amount;
            Trim(at);

            if (_currentSum > _threshold)
            {
                _exceedanceCount++;
                if (at - _lastWarnAt >= _windowSec)
                {
                    _lastWarnAt = at;
                    _warn(
                        $"[perf-budget] {_name} exceeded: observed={_currentSum:F1} threshold={_threshold:F1} " +
                        $"unit={_unit} windowSec={_windowSec:F1} exceedanceCount={_exceedanceCount}");
                }
            }
        }

        /// <summary>Current windowed total as of <paramref name="at"/>. Mainly for tests.</summary>
        public double Rate(double at)
        {
            Trim(at);
            return _currentSum;
        }

        private void Trim(double at)
        {
            var cutoff = at - _windowSec;
            var i = 0;
            while (i < _events.Count && _events[i].At < cutoff)
            {
                _currentSum -= _events[i].Amount;
                i++;
            }
            if (i > 0)
            {
                _events.RemoveRange(0, i);
            }
        }
    }
}
