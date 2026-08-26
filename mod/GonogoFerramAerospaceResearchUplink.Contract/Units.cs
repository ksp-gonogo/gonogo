namespace GonogoFerramAerospaceResearchUplink.Contract
{
    /// <summary>
    /// The units this Uplink models, declared the same way core declares its own
    /// and judged by the same codegen check.
    /// </summary>
    /// <remarks>
    /// Both are ordinary SI compounds that core simply has no user for yet, so
    /// neither invents a private axis: the client registers each against the
    /// existing kilogram, metre and second bases, which keeps a ballistic
    /// coefficient convertible with the densities and areas already on the wire.
    /// Neither carries a ladder, because neither has rungs an operator reads:
    /// a ballistic coefficient lives in the hundreds and a specific excess power
    /// in the tens, across the whole range of craft either describes.
    /// </remarks>
    public static class Units
    {
        /// <summary>
        /// Areal density: mass over the area presenting it to the airflow. What
        /// decides how steeply a body decelerates through an atmosphere, and the
        /// unit FAR's own flight-data window reports its ballistic coefficient in.
        /// </summary>
        public const string KilogramsPerSquareMetre = "kg/m²";

        /// <summary>
        /// Specific excess power: the surplus of thrust over drag, per unit mass,
        /// at the current speed. Dimensionally watts per kilogram, and the unit
        /// FAR labels the reading with.
        /// </summary>
        public const string WattsPerKilogram = "W/kg";
    }
}
