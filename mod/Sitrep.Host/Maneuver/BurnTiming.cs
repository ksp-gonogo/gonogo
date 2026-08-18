using System;
using System.Collections.Generic;

namespace Sitrep.Host.Maneuver
{
    /// <summary>
    /// Turns a plan's delta-v figures into the two instants a finite burn
    /// actually has. Pure and KSP-free, so the decision is testable: only the
    /// EXTRACTION of the stage numbers belongs in <c>Gonogo.KSP</c>.
    ///
    /// <para><b>Why not simply halve the burn time.</b> Every KSP tool splits a
    /// burn evenly about its node, which asserts constant mass. A craft gets
    /// lighter as it burns, so the second half of a burn is quicker than the
    /// first, and the error grows with exactly the burn length that made anyone
    /// want a duration in the first place. Within a stage this uses the rocket
    /// equation instead, which costs one exponential and makes
    /// <c>ManeuverNode.CutoffUt</c>'s doc comment true rather than
    /// aspirational.</para>
    ///
    /// <para><b>Burns are a sequence, not a set.</b> Each one spends what the
    /// last left behind, so the same delta-v flown later takes less time. A
    /// per-burn calculation that ignored the burns before it would overstate
    /// every duration after the first.</para>
    /// </summary>
    public static class BurnTiming
    {
        /// <summary>One stage's vacuum capability, as stock reports it.</summary>
        public sealed class StageBudget
        {
            /// <summary>Vacuum delta-v the stage can deliver, m/s.</summary>
            public double DeltaV { get; set; }

            /// <summary>Full-throttle burn time for the WHOLE stage, seconds.</summary>
            public double BurnTime { get; set; }

            /// <summary>Mass at stage ignition, tonnes.</summary>
            public double StartMass { get; set; }

            /// <summary>Mass at stage burnout, tonnes.</summary>
            public double EndMass { get; set; }
        }

        /// <summary>When to light and how long to burn, relative to ignition.</summary>
        public sealed class BurnWindow
        {
            /// <summary>
            /// Seconds from ignition to the half-delta-v point, which is the
            /// instant a plan's impulsive equivalent is keyed to. Strictly more
            /// than half of <see cref="TotalSeconds"/> whenever the craft loses
            /// mass, which is the whole reason this is not a halving.
            /// </summary>
            public double LeadToHalfSeconds { get; set; }

            /// <summary>Seconds from ignition to cutoff.</summary>
            public double TotalSeconds { get; set; }
        }

        /// <summary>
        /// One window per burn in <paramref name="burnDeltaVs"/>, in the order
        /// they will be flown, or null for a burn the craft cannot afford by the
        /// time it reaches it.
        ///
        /// <para>Null is a real answer: no stage data at all (an unloaded craft,
        /// which stock does not compute delta-v for) and a burn beyond the
        /// remaining budget both produce it, and substituting the time to burn
        /// what the craft DOES have would report an unflyable burn as flyable.
        /// An unaffordable burn does not invalidate the ones before it.</para>
        /// </summary>
        public static IReadOnlyList<BurnWindow?> WindowsFor(
            IReadOnlyList<StageBudget> stages,
            IReadOnlyList<double> burnDeltaVs)
        {
            if (stages == null) throw new ArgumentNullException(nameof(stages));
            if (burnDeltaVs == null) throw new ArgumentNullException(nameof(burnDeltaVs));

            var cursor = new Cursor(stages);
            var windows = new List<BurnWindow?>(burnDeltaVs.Count);

            foreach (var dv in burnDeltaVs)
            {
                if (!(dv > 0))
                {
                    // A zero or negative delta-v is not a burn. No window rather
                    // than a zero-length one, so it reads as "nothing to fly"
                    // instead of "instantaneous".
                    windows.Add(null);
                    continue;
                }

                // Snapshotted so an unaffordable burn leaves the budget as it
                // found it: the burns after it are no more or less affordable
                // for its failure.
                var probe = cursor.Clone();
                var toHalf = probe.Advance(dv / 2.0);
                var rest = toHalf == null ? null : probe.Advance(dv / 2.0);
                if (toHalf == null || rest == null)
                {
                    windows.Add(null);
                    continue;
                }

                cursor = probe;
                windows.Add(new BurnWindow
                {
                    LeadToHalfSeconds = toHalf.Value,
                    TotalSeconds = toHalf.Value + rest.Value,
                });
            }

            return windows;
        }

        /// <summary>
        /// A position part-way through the stage list: which stage, and how much
        /// of its delta-v is already spent.
        /// </summary>
        private sealed class Cursor
        {
            private readonly IReadOnlyList<StageBudget> _stages;
            private int _stage;
            private double _spentInStage;

            internal Cursor(IReadOnlyList<StageBudget> stages)
            {
                _stages = stages;
            }

            internal Cursor Clone() =>
                new Cursor(_stages) { _stage = _stage, _spentInStage = _spentInStage };

            /// <summary>
            /// Seconds to deliver <paramref name="deltaV"/> from here, advancing
            /// this cursor, or null when the remaining stages cannot supply it.
            /// </summary>
            internal double? Advance(double deltaV)
            {
                var elapsed = 0.0;
                var remaining = deltaV;

                while (remaining > 0)
                {
                    if (_stage >= _stages.Count)
                    {
                        return null;
                    }

                    var stage = _stages[_stage];
                    if (!(stage.DeltaV > 0) || !(stage.BurnTime > 0))
                    {
                        // A stage with no capability is skipped rather than
                        // treated as a zero-time infinite one.
                        _stage++;
                        _spentInStage = 0;
                        continue;
                    }

                    var availableHere = stage.DeltaV - _spentInStage;
                    if (availableHere <= 0)
                    {
                        _stage++;
                        _spentInStage = 0;
                        continue;
                    }

                    var takeHere = Math.Min(remaining, availableHere);
                    elapsed += TimeWithinStage(stage, _spentInStage, _spentInStage + takeHere);
                    _spentInStage += takeHere;
                    remaining -= takeHere;

                    if (_spentInStage >= stage.DeltaV)
                    {
                        _stage++;
                        _spentInStage = 0;
                    }
                }

                return elapsed;
            }
        }

        /// <summary>
        /// Seconds to go from <paramref name="fromDv"/> to
        /// <paramref name="toDv"/> of a stage's own delta-v.
        ///
        /// <para>With constant thrust and mass flow, elapsed time as a function
        /// of delivered delta-v is <c>t(v) = (m0/mdot)(1 - e^(-v/ve))</c>, so
        /// scaling by the stage's own totals gives
        /// <c>t(v) = T (1 - e^(-v/ve)) / (1 - m1/m0)</c> with no need for the
        /// mass flow itself. <c>ve</c> comes from the stage's own mass ratio
        /// rather than a reported Isp, because the ratio is what the delta-v
        /// figure was computed from and so cannot disagree with it.</para>
        ///
        /// <para>Falls back to proportional when the stage reports no mass
        /// change, which is inconsistent data rather than a real stage; a
        /// linear answer is wrong by less than a throw would cost.</para>
        /// </summary>
        private static double TimeWithinStage(StageBudget stage, double fromDv, double toDv)
        {
            var ratio = stage.EndMass > 0 ? stage.StartMass / stage.EndMass : 1.0;
            if (!(ratio > 1.0) || double.IsNaN(ratio) || double.IsInfinity(ratio))
            {
                return stage.BurnTime * ((toDv - fromDv) / stage.DeltaV);
            }

            var ve = stage.DeltaV / Math.Log(ratio);
            var span = 1.0 - (1.0 / ratio);
            var at = (double v) => (1.0 - Math.Exp(-v / ve)) / span;
            return stage.BurnTime * (at(toDv) - at(fromDv));
        }
    }
}
