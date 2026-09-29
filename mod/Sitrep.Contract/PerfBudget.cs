using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// Soft performance budget: tracks a volume over a rolling window and warns
    /// (rate-limited to once per window) when a threshold is exceeded. No throw,
    /// no behavioural change: the budget is purely diagnostic.
    ///
    /// <para>Keyed on whatever time axis the caller already samples on
    /// (typically UT, since a KSP-side capture cadence is driven by UT, not
    /// wall clock). Nothing here calls a clock itself, so it stays KSP-free and
    /// unit-testable.</para>
    /// <internal>
    /// The mod-side counterpart to the app's <c>PerfBudget</c>
    /// (<c>packages/core/src/perf/PerfBudget.ts</c>). The UT cadence it usually
    /// runs on is <c>SampleCadence.IntervalUtAt</c>.
    /// </internal>
    /// </summary>
    /// <category>Uplink API</category>
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

        /// <summary>Builds a budget. It does nothing until <see cref="Record"/> is called.</summary>
        /// <param name="name">What is being budgeted, named in every warning. Must not be null.</param>
        /// <param name="threshold">The windowed total above which a warning is raised. Must be greater than zero.</param>
        /// <param name="windowSec">The rolling window's length, on the caller's own time axis. Must be greater than zero.</param>
        /// <param name="unit">The unit of a recorded amount, named in every warning; <c>"events"</c> when null.</param>
        /// <param name="warn">Where a warning goes; standard error when null.</param>
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

        /// <summary>The name given at construction, as it appears in warnings.</summary>
        public string Name => _name;

        /// <summary>The windowed total above which a warning is raised, in the budget's unit.</summary>
        public double Threshold => _threshold;

        /// <summary>The rolling window's length, on the caller's own time axis.</summary>
        public double WindowSec => _windowSec;

        /// <summary>
        /// How many calls to <see cref="Record"/> have left the windowed total
        /// above the threshold, counting every one, including those whose
        /// warning was rate-limited away.
        /// </summary>
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
