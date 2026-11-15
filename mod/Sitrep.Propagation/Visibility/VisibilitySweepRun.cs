using System;
using System.Collections.Generic;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// One <see cref="VisibilitySweep"/> taken a few samples at a time, for a
    /// caller that cannot spend the whole sweep in one call. It takes the same
    /// samples in the same order as <see cref="VisibilitySweep.Run"/>, which is
    /// this run advanced to its end, so the result is the same whatever the
    /// slicing.
    ///
    /// <para>The window and step rules are those of
    /// <see cref="VisibilitySweep.Run"/>, and a window too long for its step
    /// throws from the constructor. The geometry is first asked on the first
    /// <see cref="Advance"/>, never before.</para>
    /// </summary>
    public sealed class VisibilitySweepRun
    {
        private readonly IVisibilityGeometry _geometry;
        private readonly double _startUt;
        private readonly double _endUt;
        private readonly double _stepSeconds;
        private readonly double _toleranceSeconds;
        private readonly int _totalSteps;
        private readonly List<VisibilityChange> _changes = new List<VisibilityChange>();

        private bool _started;
        private bool _clearAtStart;
        private double _previousUt;
        private double _previousMargin;
        private bool _previousClear;
        private int _samples;
        private int _nextStep = 1;

        public VisibilitySweepRun(
            IVisibilityGeometry geometry,
            double startUt,
            double endUt,
            double stepSeconds,
            double refinementToleranceSeconds = 0.05)
        {
            _geometry = geometry ?? throw new ArgumentNullException(nameof(geometry));
            _startUt = startUt;
            _endUt = endUt;
            _stepSeconds = stepSeconds;
            _toleranceSeconds = refinementToleranceSeconds;

            if (endUt <= startUt)
            {
                return;
            }
            double span = endUt - startUt;
            double stepCount = Math.Ceiling(span / stepSeconds);
            if (stepCount > VisibilitySweep.MaxSamples)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(stepSeconds),
                    "A " + span + " s window at a " + stepSeconds + " s step needs " + stepCount
                        + " samples, past the " + VisibilitySweep.MaxSamples + " cap. Widen the step or narrow the window.");
            }
            _totalSteps = (int)stepCount;
        }

        /// <summary>The finished sweep, or null until <see cref="Advance"/> has returned true.</summary>
        public VisibilitySweepResult? Result { get; private set; }

        /// <summary>
        /// Takes up to <paramref name="maxSteps"/> more steps of the sweep, at
        /// least one, and returns true once the window is covered. A step is one
        /// sample plus the refinement of a crossing it finds, so a step that
        /// finds one costs more than one that does not.
        /// </summary>
        public bool Advance(int maxSteps)
        {
            if (Result != null)
            {
                return true;
            }

            if (!_started)
            {
                _started = true;
                _previousUt = _startUt;
                _previousMargin = _geometry.MarginAt(_startUt);
                _previousClear = ChordOcclusion.Unobstructed(_previousMargin);
                _clearAtStart = _previousClear;
                _samples = 1;
            }

            var budget = Math.Max(maxSteps, 1);
            while (_nextStep <= _totalSteps && budget > 0)
            {
                var i = _nextStep;
                // Recomputed from the start rather than accumulated, so a long
                // sweep does not drift, and pinned to endUt on the last step so
                // the requested window is covered exactly.
                double ut = i == _totalSteps ? _endUt : Math.Min(_startUt + (i * _stepSeconds), _endUt);
                double margin = _geometry.MarginAt(ut);
                bool clear = ChordOcclusion.Unobstructed(margin);
                _samples++;

                if (clear != _previousClear)
                {
                    double crossingUt = VisibilitySweep.RefineCrossing(
                        _geometry, _previousUt, _previousMargin, ut, _toleranceSeconds);
                    _changes.Add(new VisibilityChange(clear, crossingUt, _previousUt, ut));
                }

                _previousUt = ut;
                _previousMargin = margin;
                _previousClear = clear;
                _nextStep++;
                budget--;
            }

            if (_nextStep <= _totalSteps)
            {
                return false;
            }
            Result = new VisibilitySweepResult(
                _clearAtStart, _changes, _startUt, _endUt, _stepSeconds, _toleranceSeconds, _samples);
            return true;
        }
    }
}
