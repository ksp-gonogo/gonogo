namespace GonogoFerramAerospaceResearchUplink
{
    /// <summary>
    /// One vessel's aerodynamic reading exactly as Ferram Aerospace Research
    /// holds it, before any judgement about which of the numbers mean anything.
    /// KSP-free and reflection-free so the pure mapper beside it, and the mapper's
    /// tests, never pull in the game or the reflection surface.
    /// </summary>
    /// <remarks>
    /// <para><see cref="DynamicPressureKpa"/> is on this DTO and deliberately NOT
    /// on the wire: <c>vessel.flight</c> already carries dynamic pressure and
    /// carries it correctly under FAR (FAR's own flight-data window reads the
    /// same stock value). It is here because it is the DISCRIMINATOR the mapper
    /// needs. FAR zeroes the whole force-and-coefficient group below a fixed
    /// dynamic-pressure floor rather than leaving it undefined, so without this
    /// field the mapper cannot tell a measured zero from a placeholder one.</para>
    ///
    /// <para>Every field is the raw double FAR stored, non-finite values
    /// included. Cleaning them here would put the judgement in the layer that
    /// cannot be tested headless, which is the wrong way round: the mapper owns
    /// the judgement and the tests exercise it.</para>
    /// </remarks>
    public sealed class AeroRaw
    {
        /// <summary>UT the reading was taken at.</summary>
        public double Ut;

        /// <summary>Degrees. FAR clamps its own NaN to zero before storing.</summary>
        public double AngleOfAttackDeg;

        /// <summary>Degrees. Same NaN clamp as the angle of attack.</summary>
        public double SideslipDeg;

        /// <summary>
        /// Wing-area-weighted stall fraction. NaN on a craft with no aerodynamic
        /// wing surfaces, because FAR divides the (zero) weighted sum by the
        /// (zero) total wing area.
        /// </summary>
        public double StallFraction;

        public double LiftCoefficient;
        public double DragCoefficient;

        /// <summary>Lift over drag. Non-finite whenever drag is zero.</summary>
        public double LiftToDragRatio;

        /// <summary>
        /// Square metres: wing area if the craft has wings, otherwise the
        /// voxelised maximum cross-section, otherwise a substituted 1.
        /// </summary>
        public double ReferenceAreaSqM;

        public double LiftForceKn;
        public double DragForceKn;

        /// <summary>Kilopascals, the floor test the mapper reads. Never published.</summary>
        public double DynamicPressureKpa;

        /// <summary>Metres per second, derived from stagnation pressure at the current Mach.</summary>
        public double IndicatedAirspeed;

        /// <summary>
        /// Metres per second. NaN when the vessel is stationary: FAR derives the
        /// density it scales by from per-part dynamic pressure over speed squared.
        /// </summary>
        public double EquivalentAirspeed;

        /// <summary>Metres per second. Zero when FAR could not compute it, infinite in vacuum.</summary>
        public double TerminalVelocity;

        /// <summary>Kilograms per square metre. Zero when FAR could not compute it.</summary>
        public double BallisticCoefficient;

        /// <summary>Watts per kilogram.</summary>
        public double SpecificExcessPower;

        /// <summary>Whether the vessel's voxelisation is current rather than queued for a rebuild.</summary>
        public bool AeroModelValid;
    }
}
