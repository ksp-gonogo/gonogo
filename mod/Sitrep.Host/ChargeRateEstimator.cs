using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// The rate at which a vessel's stored charge is changing, read from the stored amount itself
    /// so it is right whatever draws from or fills the batteries.
    ///
    /// <para>The slope runs from the oldest to the newest sample inside a window of
    /// <see cref="WindowSeconds"/> of game time. At the 1 Hz sample cadence that is about ten
    /// samples: long enough that a load which switches on and off within a few seconds averages out
    /// and one tick's rounding of the stored amount is a small share of the change, short enough
    /// that a load switched on is fully in the figure within ten seconds. The newest two samples
    /// are always kept, so a time-warp step wider than the window still gives a rate.</para>
    ///
    /// <para>A battery at its capacity or at zero does not move whatever the net flow is, so any
    /// window holding such a sample has no rate: the answer is null, never zero. A change of
    /// vessel, of capacity (staging, docking) or of direction of time (a revert) starts the window
    /// again, since the amount then jumps for reasons that are not flow.</para>
    /// </summary>
    public sealed class ChargeRateEstimator
    {
        public const double WindowSeconds = 10.0;

        /// <summary>The share of capacity within which a sample counts as full or empty.</summary>
        private const double EdgeShare = 1e-4;

        private readonly List<double> _ut = new List<double>();
        private readonly List<double> _amount = new List<double>();
        private readonly List<bool> _pegged = new List<bool>();
        private string? _subject;
        private double _max;

        /// <summary>Records one sample and returns the rate in units per second, positive while charging, or null while it cannot be known.</summary>
        public double? Observe(string subject, double ut, double amount, double max)
        {
            var continuous = subject == _subject
                && Math.Abs(max - _max) <= Math.Abs(_max) * 1e-9
                && (_ut.Count == 0 || ut > _ut[_ut.Count - 1]);
            if (!continuous)
            {
                _ut.Clear();
                _amount.Clear();
                _pegged.Clear();
            }

            _subject = subject;
            _max = max;

            if (double.IsNaN(amount) || double.IsInfinity(amount) || double.IsNaN(ut) || max <= 0)
            {
                _ut.Clear();
                _amount.Clear();
                _pegged.Clear();
                return null;
            }

            var edge = max * EdgeShare;
            _ut.Add(ut);
            _amount.Add(amount);
            _pegged.Add(amount <= edge || amount >= max - edge);

            while (_ut.Count > 2 && ut - _ut[0] > WindowSeconds)
            {
                _ut.RemoveAt(0);
                _amount.RemoveAt(0);
                _pegged.RemoveAt(0);
            }

            if (_ut.Count < 2 || _pegged.Contains(true))
            {
                return null;
            }

            return (_amount[_amount.Count - 1] - _amount[0]) / (_ut[_ut.Count - 1] - _ut[0]);
        }
    }
}
