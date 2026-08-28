namespace GonogoPrincipiaUplink.Contract
{
    /// <summary>
    /// The units this Uplink models, declared the same way core declares its own
    /// and judged by the same codegen check.
    /// </summary>
    /// <remarks>
    /// <para>Named here rather than written as a literal at the one field that
    /// carries it. Core composes the token itself, from its own <c>°</c> and
    /// <c>h</c>, so this adds no dimension and no client registration: it is a
    /// name for a decision, and the decision is in the two paragraphs
    /// below.</para>
    /// <para>A secular precession rate is an angular rate, and core's own
    /// angular-rate token cannot carry it: <c>rad/s</c> is modelled as a
    /// radiation dose rate, because that is the quantity which reached the
    /// contract first, so a precession published under it would render in rad/h
    /// beside a crew dosimeter. The magnitudes are wrong for reading too: nodal
    /// precession in low orbit is around 1e-6 rad/s.</para>
    /// <para><b>Per HOUR, where the producer's own window says per day.</b> A day
    /// is not a fixed quantity in this game: stock runs a six-hour Kerbin day,
    /// stock's own setting turns that off, and a planet pack replaces the
    /// calendar outright. An hour is an hour under all three. The cost is that
    /// comparing this against the producer's window takes a factor, and the
    /// alternative is a number that silently means one of two things.</para>
    /// </remarks>
    public static class Units
    {
        /// <summary>Degrees per hour: a secular precession at a scale a reader can
        /// hold, with no calendar in it.</summary>
        public const string DegreesPerHour = "°/h";
    }
}
