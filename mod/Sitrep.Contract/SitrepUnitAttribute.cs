using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// The canonical unit tokens a <see cref="SitrepUnitAttribute"/> may carry.
    /// Every token is a <c>const string</c> so it can be used as an attribute
    /// argument, and so codegen can emit the closed set as a TypeScript union
    /// (<c>SitrepUnit</c> in the generated <c>units.ts</c>): both sides of the
    /// wire then reject a typo at COMPILE time rather than shipping a second
    /// spelling of an existing unit.
    ///
    /// <para>Spellings are the OPERATOR-FACING symbols already used by the
    /// client's existing presentation code (<c>kg/m³</c> per
    /// <c>packages/components/src/shared/formatDensity.ts</c>, <c>°</c>/<c>g</c>
    /// per <c>packages/data/src/schema/telemachusMeta.ts</c>) rather than a new
    /// abstract identifier, so a formatter that has no special rule for a unit
    /// can fall back to appending the token verbatim and still be correct.</para>
    ///
    /// <para>A token names the unit the wire value is ALREADY in. It is not a
    /// conversion request: the contract never converts (see
    /// <see cref="VesselOrbit"/>'s deliberate degrees/radians split), it only
    /// states what it is carrying so the consumer stops guessing.</para>
    /// </summary>
    public static class Units
    {
        // --- Length ---
        public const string Metres = "m";

        // --- Speed ---
        public const string MetresPerSecond = "m/s";

        // --- Angle ---
        public const string Degrees = "°";
        public const string Radians = "rad";

        // --- Time ---
        public const string Seconds = "s";

        // --- Temperature ---
        /// <summary>
        /// The only temperature the wire carries. There is deliberately no
        /// Celsius token: <c>HeatShieldTemp</c> used to send °C and it made the
        /// channel self-inconsistent (every other temperature beside it was K),
        /// which is how a client came to render a kelvin reading with a °C
        /// suffix. Celsius is a PRESENTATION unit, and the client asks for it by
        /// name (<c>formatQuantity(v, "K", { as: "°C" })</c>). Leaving the token
        /// out means the mistake cannot be spelled.
        /// </summary>
        public const string Kelvin = "K";

        // --- Pressure ---
        public const string Kilopascals = "kPa";

        // --- Power ---
        public const string Kilowatts = "kW";

        // --- Density ---
        public const string KilogramsPerCubicMetre = "kg/m³";

        // --- Acceleration ---
        /// <summary>Multiples of standard gravity, the g-force convention KSP's own <c>Vessel.geeForce</c> reports in.</summary>
        public const string GForce = "g";

        // --- Gravitation ---
        /// <summary>Standard gravitational parameter (GM), the unit KSP's <c>CelestialBody.gravParameter</c> is in.</summary>
        public const string CubicMetresPerSecondSquared = "m³/s²";

        // --- Unitless ---
        /// <summary>
        /// A 0..1 fraction of some maximum, conventionally presented as a
        /// percentage. Distinct from <see cref="Dimensionless"/> because the
        /// presentation rule differs: a ratio wants "×100 and append %", a
        /// dimensionless number wants to be shown bare.
        /// </summary>
        public const string Ratio = "ratio";

        /// <summary>A pure number carrying no unit and no implied scaling (e.g. Mach).</summary>
        public const string Dimensionless = "1";
    }

    /// <summary>
    /// Declares the physical unit a wire-payload property's value is expressed
    /// in, so the unit becomes MACHINE-READABLE instead of prose buried in a
    /// doc comment. <c>mod/codegen.sh</c> (via <c>RtConfig.EmitUnitMap</c>)
    /// reflects over these and emits
    /// <c>mod/sitrep-sdk/src/__generated__/units.ts</c>, a runtime map a
    /// TypeScript consumer can query with <c>unitOf("vessel.flight",
    /// "surfaceSpeed")</c>. Before this, the units existed only as English in
    /// <c>&lt;summary&gt;</c> text (and for most fields, not even that), so
    /// every widget hand-rolled its own literal and its own scaling ladder.
    ///
    /// <para><b>Why an attribute and not a sidecar table.</b> The TS codegen is
    /// <c>rtcli</c> (Reinforced.Typings) run against the COMPILED
    /// <c>Sitrep.Contract.dll</c>, not a source parser, so attribute metadata is
    /// exactly what it can see. A hand-maintained sidecar map keyed by property
    /// name would be a second file to keep in sync with a rename, and nothing
    /// would fail when it drifted; an attribute sits on the property it
    /// describes and moves with it.</para>
    ///
    /// <para>Lives IN <c>Sitrep.Contract</c> and is compiled into BOTH target
    /// frameworks, the same rule <see cref="SitrepTopicAttribute"/> follows and
    /// for the same reason: anything reflecting over it must never have to
    /// resolve an external assembly (<c>Reinforced.Typings</c> is
    /// compile-time-only by explicit design, see
    /// <see cref="SitrepContractAttribute"/>). It is metadata ONLY and does not
    /// touch the wire: <c>Sitrep.Core.Serialization.JsonWriter</c> never reads
    /// it, so annotating a field costs zero bytes per tick.</para>
    ///
    /// <para><b>Only annotate what is KNOWN.</b> An absent annotation reads as
    /// "not yet stated" and a consumer falls back to rendering the number bare,
    /// which is the status quo. A WRONG annotation is worse than none, because
    /// a formatter will confidently mislabel it. Where a field's unit is
    /// genuinely ambiguous, leave it off.</para>
    /// </summary>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepUnitAttribute : Attribute
    {
        /// <summary>One of the <see cref="Units"/> tokens.</summary>
        public string Unit { get; }

        public SitrepUnitAttribute(string unit)
        {
            Unit = unit;
        }
    }
}
