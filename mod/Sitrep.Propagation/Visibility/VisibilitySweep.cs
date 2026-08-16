using System;
using System.Collections.Generic;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>One moment at which the path changed state, refined off the sweep grid.</summary>
    public sealed class VisibilityChange
    {
        public VisibilityChange(bool becameClear, double ut, double bracketLowUt, double bracketHighUt)
        {
            BecameClear = becameClear;
            Ut = ut;
            BracketLowUt = bracketLowUt;
            BracketHighUt = bracketHighUt;
        }

        /// <summary>True for an acquisition (blocked to clear), false for a loss.</summary>
        public bool BecameClear { get; }

        /// <summary>The refined crossing UT.</summary>
        public double Ut { get; }

        /// <summary>The sweep-grid interval the crossing was found in. Kept so a caller can see the coarse evidence behind a refined number.</summary>
        public double BracketLowUt { get; }

        public double BracketHighUt { get; }
    }

    /// <summary>A finished sweep: the state it started in, and every change from there.</summary>
    public sealed class VisibilitySweepResult
    {
        public VisibilitySweepResult(
            bool clearAtStart,
            IReadOnlyList<VisibilityChange> changes,
            double startUt,
            double endUt,
            double stepSeconds,
            double refinementToleranceSeconds,
            int samplesTaken)
        {
            ClearAtStart = clearAtStart;
            Changes = changes;
            StartUt = startUt;
            EndUt = endUt;
            StepSeconds = stepSeconds;
            RefinementToleranceSeconds = refinementToleranceSeconds;
            SamplesTaken = samplesTaken;
        }

        public bool ClearAtStart { get; }

        public IReadOnlyList<VisibilityChange> Changes { get; }

        public double StartUt { get; }

        public double EndUt { get; }

        public double StepSeconds { get; }

        public double RefinementToleranceSeconds { get; }

        public int SamplesTaken { get; }

        /// <summary>
        /// The published detection guarantee, seconds: any run of constant state
        /// LONGER than this is certain to have been found. See
        /// <see cref="VisibilitySweep.Run"/> for what that does and does not
        /// promise.
        /// </summary>
        public double GuaranteedDetectableRunSeconds
        {
            get { return 2.0 * StepSeconds; }
        }

        /// <summary>Whether the path was clear at <paramref name="ut"/>, per the changes found. Cheap replay of the result, no re-evaluation.</summary>
        public bool ClearAt(double ut)
        {
            bool clear = ClearAtStart;
            for (int i = 0; i < Changes.Count; i++)
            {
                if (Changes[i].Ut > ut)
                {
                    break;
                }

                clear = Changes[i].BecameClear;
            }

            return clear;
        }
    }

    /// <summary>
    /// Finds when a radio path opens and closes over a UT window.
    ///
    /// <para><b>The boolean is never bisected.</b> Visibility is not monotone in
    /// UT: over a single orbit it flips at least twice, and endpoint-driven
    /// bisection on a non-monotone predicate is not a slow method, it is a wrong
    /// one. It silently reports "no change" whenever the window contains an even
    /// number of crossings (a whole orbit, most obviously), and when the count is
    /// odd it converges to whichever crossing the midpoint sequence happens to
    /// walk into, which need not be the first. Three separate analyses of this
    /// question have already reached wrong conclusions; this is one of the shapes
    /// that error takes.</para>
    ///
    /// <para>What IS legal is root-finding on the continuous margin behind that
    /// boolean, and only inside a bracket a dense sweep has already shown to
    /// straddle a sign change. So: step the whole window at a fixed cadence,
    /// compare each sample against the last, and bisect within any interval where
    /// the two disagree. The sweep decides WHERE the crossings are; the root-find
    /// only sharpens WHEN.</para>
    /// </summary>
    public static class VisibilitySweep
    {
        /// <summary>
        /// Bisection is used rather than Brent even though Brent converges faster.
        /// Brent's speed comes from interpolation steps that can leave the
        /// bracket, guarded by a fallback; bisection cannot leave it at all, and
        /// the bracket is the entire reason this search is sound. The cost of the
        /// choice is about a dozen extra margin evaluations per crossing.
        /// </summary>
        private const int MaxBisectionIterations = 200;

        /// <summary>
        /// A dense sweep of a badly-chosen window at a badly-chosen step is an
        /// unbounded loop, not an error message. This cap turns that into one.
        /// </summary>
        private const int MaxSamples = 5_000_000;

        /// <summary>
        /// Sweep <paramref name="geometry"/> from <paramref name="startUt"/> to
        /// <paramref name="endUt"/> at <paramref name="stepSeconds"/>, refining
        /// every crossing to <paramref name="refinementToleranceSeconds"/>.
        ///
        /// <para><b>Detection guarantee.</b> Samples sit <paramref name="stepSeconds"/>
        /// apart, with the final sample pinned to <paramref name="endUt"/> exactly
        /// so the tail of the window is never dropped. Any run of constant state
        /// longer than one step must therefore contain at least one sample, which
        /// makes both of its edges show up as sign changes between adjacent
        /// samples, and both get refined. The guarantee PUBLISHED is two steps
        /// (<see cref="VisibilitySweepResult.GuaranteedDetectableRunSeconds"/>),
        /// which keeps a margin over that bound and matches the predictor spec.
        /// A run shorter than one step can fall entirely between two samples and
        /// is then missed in silence: a brief occultation simply does not appear.
        /// Choose the step against the shortest event worth seeing, not against
        /// the window length. Half a degree of relative arc (period/720) puts
        /// every low orbit at 3-6 s.</para>
        ///
        /// <para>Odd crossing counts inside a single bracket are refined to one of
        /// the roots, not all of them; that is the same short-run limit seen from
        /// the other side, and the fix is the same smaller step.</para>
        /// </summary>
        public static VisibilitySweepResult Run(
            IVisibilityGeometry geometry,
            double startUt,
            double endUt,
            double stepSeconds,
            double refinementToleranceSeconds = 0.05)
        {
            if (geometry == null)
            {
                throw new ArgumentNullException(nameof(geometry));
            }

            if (!(stepSeconds > 0.0) || double.IsInfinity(stepSeconds))
            {
                throw new ArgumentOutOfRangeException(
                    nameof(stepSeconds),
                    "The sweep step must be finite and strictly positive; got " + stepSeconds);
            }

            if (!(refinementToleranceSeconds > 0.0) || double.IsInfinity(refinementToleranceSeconds))
            {
                throw new ArgumentOutOfRangeException(
                    nameof(refinementToleranceSeconds),
                    "The refinement tolerance must be finite and strictly positive; got " + refinementToleranceSeconds);
            }

            if (double.IsNaN(startUt) || double.IsNaN(endUt))
            {
                throw new ArgumentOutOfRangeException(nameof(startUt), "The sweep window bounds must not be NaN.");
            }

            var changes = new List<VisibilityChange>();

            double previousUt = startUt;
            double previousMargin = geometry.MarginAt(startUt);
            bool previousClear = ChordOcclusion.Unobstructed(previousMargin);
            bool clearAtStart = previousClear;
            int samples = 1;

            if (endUt <= startUt)
            {
                return new VisibilitySweepResult(
                    clearAtStart, changes, startUt, endUt, stepSeconds, refinementToleranceSeconds, samples);
            }

            double span = endUt - startUt;
            double stepCount = Math.Ceiling(span / stepSeconds);
            if (stepCount > MaxSamples)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(stepSeconds),
                    "A " + span + " s window at a " + stepSeconds + " s step needs " + stepCount
                        + " samples, past the " + MaxSamples + " cap. Widen the step or narrow the window.");
            }

            int totalSteps = (int)stepCount;
            for (int i = 1; i <= totalSteps; i++)
            {
                // Recomputed from the start rather than accumulated, so a long
                // sweep does not drift, and pinned to endUt on the last step so
                // the requested window is covered exactly.
                double ut = i == totalSteps ? endUt : Math.Min(startUt + (i * stepSeconds), endUt);
                double margin = geometry.MarginAt(ut);
                bool clear = ChordOcclusion.Unobstructed(margin);
                samples++;

                if (clear != previousClear)
                {
                    double crossingUt = RefineCrossing(
                        geometry, previousUt, previousMargin, ut, refinementToleranceSeconds);
                    changes.Add(new VisibilityChange(clear, crossingUt, previousUt, ut));
                }

                previousUt = ut;
                previousMargin = margin;
                previousClear = clear;
            }

            return new VisibilitySweepResult(
                clearAtStart, changes, startUt, endUt, stepSeconds, refinementToleranceSeconds, samples);
        }

        /// <summary>
        /// Bisect the CLEARANCE inside a bracket whose ends are already known to
        /// disagree in sign. Every iteration keeps that disagreement, so the
        /// bracket always still contains a root and the midpoint is always a valid
        /// answer to within its width; the loop can be cut short by the cap
        /// without returning nonsense.
        /// </summary>
        private static double RefineCrossing(
            IVisibilityGeometry geometry,
            double lowUt,
            double lowMargin,
            double highUt,
            double toleranceSeconds)
        {
            bool lowClear = ChordOcclusion.Unobstructed(lowMargin);

            for (int i = 0; i < MaxBisectionIterations && (highUt - lowUt) > toleranceSeconds; i++)
            {
                double midUt = lowUt + ((highUt - lowUt) * 0.5);
                if (midUt <= lowUt || midUt >= highUt)
                {
                    // The bracket has shrunk below what doubles can subdivide.
                    break;
                }

                bool midClear = ChordOcclusion.Unobstructed(geometry.MarginAt(midUt));
                if (midClear == lowClear)
                {
                    lowUt = midUt;
                }
                else
                {
                    highUt = midUt;
                }
            }

            return lowUt + ((highUt - lowUt) * 0.5);
        }
    }
}
