using System.Collections.Generic;

namespace GonogoFerramAerospaceResearchUplink
{
    /// <summary>
    /// Pure mapper: turns one <see cref="AeroRaw"/> reading into the
    /// <c>aero.state</c> dict, and decides field by field whether the number FAR
    /// stored is a measurement or a placeholder. KSP-free and side-effect-free,
    /// so every rule below is exercised headless.
    /// </summary>
    /// <remarks>
    /// <para><b>Why this class is where the work is.</b> Every scalar getter on
    /// FAR's own <c>FARAPI</c> is written <c>VesselFlightInfo(v)?.X ?? 0.0</c>, so
    /// "FAR has no reading for this vessel" and "the reading is zero" come back as
    /// the same double. This Uplink never calls those helpers: it reads the
    /// underlying struct and re-derives absence here. That covers the null case,
    /// and it is only half the problem. FAR ALSO writes placeholder values into
    /// the struct itself, in three distinct ways, and each needs a different
    /// test:</para>
    ///
    /// <list type="bullet">
    /// <item><description><b>A hard zero it substitutes on purpose.</b> Below a
    /// fixed dynamic-pressure floor the forces and the coefficients are set to
    /// zero rather than left undefined, and a ballistic coefficient and terminal
    /// velocity it declines to compute are both set to exactly zero. A coefficient
    /// of zero and a ballistic coefficient of zero are not readings any vehicle
    /// can produce.</description></item>
    /// <item><description><b>A NaN it never clears.</b> Stall fraction is the
    /// weighted stalled area divided by total wing area, and a craft with no
    /// aerodynamic wing surfaces divides zero by zero. Every rocket therefore
    /// carries a NaN stall fraction for its whole flight, which is the single most
    /// important guard here: a launch vehicle must not be able to report itself
    /// unstalled.</description></item>
    /// <item><description><b>An infinity from a real division.</b> Lift over drag
    /// with no drag, terminal velocity with no atmosphere, specific excess power
    /// before the vessel's parts have physical mass.</description></item>
    /// </list>
    ///
    /// <para>A NaN or an infinity is not merely unrenderable, it is
    /// unserialisable: JSON has no spelling for either. So the finite test below
    /// is doing two jobs at once, and dropping it would not degrade the readout,
    /// it would corrupt the frame.</para>
    /// </remarks>
    public static class AeroCapture
    {
        /// <summary>
        /// The dynamic pressure below which FAR stops computing an aerodynamic
        /// state and substitutes zeros, in kilopascals. Its own constant, matched
        /// here so this mapper's idea of "there is airflow" is the same as the
        /// producer's rather than a second opinion about it.
        /// </summary>
        internal const double DynamicPressureFloorKpa = 1e-5;

        /// <summary>
        /// Builds the wire dict, or <c>null</c> when FAR holds no reading for the
        /// vessel at all. Null is published as a tombstone rather than swallowed
        /// (the channel declares <c>AbsenceIsData</c>), so a client shows "no
        /// data" instead of waiting for a first value that is not coming.
        /// </summary>
        public static Dictionary<string, object?>? Build(AeroRaw? raw)
        {
            if (raw == null)
            {
                return null;
            }

            // Attitude to the airflow, and what that attitude costs, are only
            // facts while there IS airflow. Below the floor FAR substitutes
            // zeros, and a zero angle of attack on the pad reads exactly like a
            // vehicle holding prograde.
            var hasAirflow = raw.DynamicPressureKpa > DynamicPressureFloorKpa;

            return new Dictionary<string, object?>
            {
                ["angleOfAttack"] = hasAirflow ? Finite(raw.AngleOfAttackDeg) : null,
                ["sideslip"] = hasAirflow ? Finite(raw.SideslipDeg) : null,
                ["stallFraction"] = hasAirflow ? Finite(raw.StallFraction) : null,
                ["liftCoefficient"] = hasAirflow ? Finite(raw.LiftCoefficient) : null,
                ["dragCoefficient"] = hasAirflow ? Finite(raw.DragCoefficient) : null,
                ["liftToDragRatio"] = hasAirflow ? Finite(raw.LiftToDragRatio) : null,

                // Geometry, not aerodynamics: the reference area the coefficients
                // above are divided by exists whether or not the vessel is moving,
                // so it is not gated on airflow. A non-positive one is a vessel
                // with no shape yet rather than a vessel with no area.
                ["referenceArea"] = Positive(raw.ReferenceAreaSqM),

                // Forces stay ungated. Zero lift and zero drag in vacuum or at
                // rest is a measurement rather than a substitution: the airflow
                // that would produce them genuinely is not there.
                ["liftForce"] = Finite(raw.LiftForceKn),
                ["dragForce"] = Finite(raw.DragForceKn),

                // Airspeeds are speeds. Zero on the pad is true, so neither is
                // gated on airflow; equivalent airspeed still needs the finite
                // test, because FAR derives the density it scales by from a
                // per-part dynamic pressure over speed squared and a stationary
                // vessel divides zero by zero.
                ["indicatedAirspeed"] = Finite(raw.IndicatedAirspeed),
                ["equivalentAirspeed"] = Finite(raw.EquivalentAirspeed),

                // Both come out of the same branch in FAR, which writes exactly
                // zero into each when it declines to compute them. Neither
                // quantity can legitimately BE zero: a ballistic coefficient is a
                // positive mass over a positive drag area, and a terminal velocity
                // is the square root of a positive quantity. So the zero is the
                // decline, and it is reported as one.
                ["terminalVelocity"] = Positive(raw.TerminalVelocity),
                ["ballisticCoefficient"] = Positive(raw.BallisticCoefficient),

                // Genuinely signed, and the sign is the whole point: an X-plane
                // that can no longer climb is at negative specific excess power.
                // So the zero test above would be wrong here, and only the finite
                // one applies.
                ["specificExcessPower"] = Finite(raw.SpecificExcessPower),

                // The qualifier on everything above, so it stays present when the
                // readings do not: "the model has not caught up with the vehicle's
                // new shape" is precisely what an operator needs during the tick
                // after a separation.
                ["aeroModelValid"] = raw.AeroModelValid,
            };
        }

        /// <summary>The value, or absence where FAR left a NaN or an infinity.</summary>
        private static object? Finite(double value) =>
            double.IsNaN(value) || double.IsInfinity(value) ? null : (object)value;

        /// <summary>
        /// The value, or absence where it is not a positive finite number. For the
        /// three quantities that cannot legitimately be zero or below, so FAR's
        /// substituted zero is caught by the same test as its infinities.
        /// </summary>
        private static object? Positive(double value) =>
            double.IsNaN(value) || double.IsInfinity(value) || value <= 0.0 ? null : (object)value;
    }
}
