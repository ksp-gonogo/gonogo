using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// Pure, KSP-free landing maths for the <c>vessel.landing</c> channel: the
    /// source-side relevance gate and the atmosphere-aware terminal-velocity
    /// model. Isolated here (no KSP types) so it is unit-testable; the KSP
    /// capture (<c>Gonogo.KSP.KspHost.BuildLanding</c>) feeds it values read off
    /// the live <c>Vessel</c> / <c>CelestialBody</c> and stores the scalar
    /// results on the snapshot.
    ///
    /// <para>The model treats the descent as a force balance: at terminal
    /// velocity aerodynamic drag equals weight. From the CURRENT measured drag
    /// force <c>D</c> at the current speed (an instantaneous read, no
    /// simulation) it derives the effective drag area and projects the terminal
    /// velocity to any air density. It assumes the current configuration holds
    /// (attitude, no pending parachute): accurate near terminal on final
    /// descent (where it matters), least accurate through high-mach transients
    /// (where there is time). It is NOT a drag simulation.</para>
    /// </summary>
    public static class LandingModel
    {
        /// <summary>
        /// Source-side relevance gate: emit the channel only when descending
        /// toward a solid, PQS-backed surface within the closure horizon. When
        /// false the whole channel is absent ("not descending"), so the
        /// expensive terrain sampling never runs from orbit.
        /// </summary>
        /// <param name="verticalSpeed">m/s, KSP sign (negative while descending).</param>
        /// <param name="heightFromTerrain">m, lowest-point AGL.</param>
        /// <param name="horizonSeconds">Seconds-to-terrain cut above which the descent is not yet relevant.</param>
        public static bool IsRelevant(
            bool hasSolidSurface,
            bool hasPqs,
            double verticalSpeed,
            double heightFromTerrain,
            double horizonSeconds)
        {
            if (!hasSolidSurface || !hasPqs)
                return false;
            double descentRate = -verticalSpeed; // down-positive
            if (!(descentRate > 0) || !(heightFromTerrain > 0))
                return false;
            return heightFromTerrain / descentRate < horizonSeconds;
        }

        /// <summary>
        /// Terminal velocity at air density <paramref name="rhoAt"/>, from the
        /// current measured drag <paramref name="dragForce"/> and weight
        /// <paramref name="weight"/> (same force unit, e.g. kN) at the current
        /// speed <paramref name="vNow"/> and current density
        /// <paramref name="rhoNow"/>:
        /// v_t = vNow * sqrt( (W * rhoNow) / (rhoAt * D) ).
        /// Null on non-positive / non-finite inputs.
        /// </summary>
        public static double? TerminalVelocityAt(
            double dragForce,
            double weight,
            double vNow,
            double rhoNow,
            double rhoAt)
        {
            if (!(dragForce > 0) || !(weight > 0) || !(vNow > 0) ||
                !(rhoNow > 0) || !(rhoAt > 0))
                return null;
            double v2 = vNow * vNow * (weight * rhoNow) / (rhoAt * dragForce);
            if (!(v2 > 0) || double.IsNaN(v2) || double.IsInfinity(v2))
                return null;
            return Math.Sqrt(v2);
        }

        /// <summary>
        /// The instantaneous descent regime from the drag/weight balance:
        /// within <paramref name="tolerance"/> of unity is at-terminal, drag
        /// beyond weight is decelerating, below is accelerating.
        /// </summary>
        public static string ClassifyRegime(
            double dragForce,
            double weight,
            double tolerance = 0.05)
        {
            if (!(weight > 0))
                return "accelerating";
            double ratio = dragForce / weight;
            if (Math.Abs(ratio - 1.0) <= tolerance)
                return "at-terminal";
            return ratio > 1.0 ? "decelerating" : "accelerating";
        }

        /// <summary>
        /// Atmosphere-aware time to impact: integrate dt = dh / v_t(alt) down
        /// the density column from the current altitude to the ground, assuming
        /// a quasi-terminal descent. <paramref name="altitudes"/> descend
        /// (current first, ground last) with <paramref name="densities"/>
        /// aligned. Null when the profile is too short or any step's terminal
        /// velocity is invalid.
        /// </summary>
        public static double? AtmosphericTimeToImpact(
            double dragForce,
            double weight,
            double vNow,
            double rhoNow,
            double[] altitudes,
            double[] densities)
        {
            if (altitudes == null || densities == null ||
                altitudes.Length < 2 || altitudes.Length != densities.Length)
                return null;
            double total = 0;
            for (int i = 0; i < altitudes.Length - 1; i++)
            {
                double dh = altitudes[i] - altitudes[i + 1]; // positive descending
                if (dh <= 0)
                    continue;
                double rhoMid = 0.5 * (densities[i] + densities[i + 1]);
                double? vt = TerminalVelocityAt(dragForce, weight, vNow, rhoNow, rhoMid);
                if (vt == null || !(vt.Value > 0))
                    return null;
                total += dh / vt.Value;
            }
            return total > 0 ? total : (double?)null;
        }

        /// <summary>
        /// The whole atmospheric field set for <c>vessel.landing</c>, or NULL
        /// when it cannot be answered at all.
        ///
        /// <para>Every field here derives from the vessel's parts (the measured
        /// drag force, and the parachute state read off the same walk), so a
        /// <paramref name="dragForce"/> of null, meaning the parts could not be
        /// read, makes ALL of them unknowable together. Publishing any of them
        /// from a zero produces a plausible terminal velocity, a plausible time
        /// to impact, a descent regime classified from a zero drag-to-weight
        /// ratio, and "no parachutes", in the one place a reader is deciding
        /// whether a landing survives. Null drag is not a craft that cannot slow
        /// down, it is a craft we could not look at.</para>
        ///
        /// <para>This lives HERE, on the pure side, rather than as a guard in the
        /// KSP capture, because it is a decision rather than a read: the capture
        /// had every number crossing this seam already and kept only the
        /// question of whether to publish them, which is the one that was wrong
        /// (see the commit that added this). "How do I fake a Vessel" is
        /// unanswerable; "what plain value is this decision about" is
        /// <c>double? dragForce</c>.</para>
        /// </summary>
        public static Dictionary<string, object?>? AtmosphericFields(
            double? dragForce,
            string? parachuteState,
            double weight,
            double vNow,
            double rhoNow,
            double rhoGround,
            double[] altitudes,
            double[] densities)
        {
            if (!dragForce.HasValue)
            {
                return null;
            }
            var drag = dragForce.Value;
            return new Dictionary<string, object?>
            {
                ["terminalVelocity"] = TerminalVelocityAt(drag, weight, vNow, rhoNow, rhoNow),
                ["projectedTouchdownSpeed"] = TerminalVelocityAt(drag, weight, vNow, rhoNow, rhoGround),
                ["atmosphericTimeToImpact"] =
                    AtmosphericTimeToImpact(drag, weight, vNow, rhoNow, altitudes, densities),
                ["descentRegime"] = ClassifyRegime(drag, weight),
                // The numeric drag/weight balance behind descentRegime, from the
                // same two forces. Null rather than zero for a weightless craft:
                // the ratio is undefined there, not balanced.
                ["dragToWeightRatio"] = weight > 0 ? drag / weight : (double?)null,
                ["parachuteState"] = parachuteState,
            };
        }
    }
}
