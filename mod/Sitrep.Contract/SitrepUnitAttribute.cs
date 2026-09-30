using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// The canonical unit tokens a <see cref="SitrepUnitAttribute"/> may carry.
    /// Every token is a <c>const string</c>, so it can be used as an attribute
    /// argument, and the TypeScript SDK carries the same set as the
    /// <c>KnownSitrepUnit</c> union, so a typo is rejected at compile time on
    /// both sides of the wire.
    ///
    /// <para>This catalog is closed and the TypeScript <c>SitrepUnit</c> type is
    /// open. An Uplink cannot add a <c>const</c> to this class, so it declares
    /// its own unit as a plain string and teaches the client what the symbol
    /// means with <c>registerUnit</c>.</para>
    ///
    /// <para>Spellings are the symbols an operator reads (<c>kg/m³</c>,
    /// <c>°</c>, <c>g</c>) rather than abstract identifiers, so a formatter
    /// with no special rule for a unit can append the token verbatim and still
    /// be correct.</para>
    ///
    /// <para>A token names the unit the wire value is already in. It is not a
    /// conversion request: the contract never converts (see
    /// <see cref="VesselOrbit"/>, which carries both degrees and radians), it
    /// only states what it is carrying.</para>
    /// <internal>
    /// The catalog check in RtConfig applies to first-party payloads only,
    /// which is exactly the set it can see.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    public static class Units
    {
        /// <summary>Metres, the unit of every distance and altitude on this wire.</summary>
        public const string Metres = "m";

        /// <summary>
        /// Kilometres. Only for a field genuinely authored in km.
        ///
        /// <para>Every other distance on this wire is <see cref="Metres"/>. The
        /// client's presentation ladder already promotes a metres value to km
        /// above 1000 m, so a field needs this token only when its value is
        /// authored in km, not merely displayed that way.</para>
        /// <internal>
        /// Exists for MechJebAscentArgs.TargetAltitudeKm: the MechJeb widget
        /// builds that wire key in km. Do not reach for it on anything new.
        /// </internal>
        /// </summary>
        public const string Kilometres = "km";

        /// <summary>Square metres, KSP's own habitat surface unit.</summary>
        public const string SquareMetres = "m²";

        /// <summary>Cubic metres, KSP's own habitat volume unit.</summary>
        public const string CubicMetres = "m³";

        /// <summary>Metres per second, the unit of every speed on this wire.</summary>
        public const string MetresPerSecond = "m/s";

        /// <summary>Degrees of angle. A field carries degrees or radians, never both under one name.</summary>
        public const string Degrees = "°";

        /// <summary>Radians of angle. A field carries degrees or radians, never both under one name.</summary>
        public const string Radians = "rad";

        /// <summary>
        /// A DURATION in seconds: how long something takes, how long is left.
        /// See <see cref="UniversalTime"/> for the other thing seconds measure.
        /// </summary>
        public const string Seconds = "s";

        /// <summary>
        /// An INSTANT on the universal-time clock, past or future: seconds since
        /// the game's epoch, never an interval.
        /// </summary>
        ///
        /// <remarks>
        /// <para>Same dimension as <see cref="Seconds"/>, so a UT plus a duration
        /// is a UT and unit arithmetic keeps working. What differs is the kind,
        /// which never gates arithmetic and only drives display: a consumer
        /// renders a UT as a date, or subtracts the frame's view time from it to
        /// get a countdown, and never renders it as a duration.</para>
        ///
        /// <para>An instant fed to a countdown as if it were a duration renders a
        /// Mun encounter twenty minutes away as "46d 2h", and a <c>&gt; 0</c>
        /// gate in front of it passes for every UT there has ever been. The
        /// separate <c>"ut"</c> token is what lets the boundary tell the two
        /// apart.</para>
        /// </remarks>
        public const string UniversalTime = "ut";

        /// <summary>
        /// An engine's specific impulse, in seconds at standard gravity.
        /// </summary>
        ///
        /// <remarks>
        /// <para>Seconds by dimension, and a separate token for the same reason
        /// as <see cref="UniversalTime"/>: the dimension is shared so arithmetic
        /// keeps working, and the kind decides how it renders. A specific
        /// impulse is a performance figure, not a length of time: a 320 s engine
        /// should never render as "5min 20s".</para>
        /// </remarks>
        public const string SpecificImpulse = "isp";

        /// <summary>
        /// Revolutions per minute, KSP's own rotor unit
        /// (<c>ModuleRoboticServoRotor.rpmLimit</c> and the live rotor speed
        /// beside it). The contract states the unit KSP reports rather than
        /// converting to rad/s.
        /// </summary>
        public const string Rpm = "rpm";

        /// <summary>
        /// Kelvin, the only temperature the wire carries. There is no Celsius
        /// token: Celsius is a presentation unit, and the client asks for it by
        /// name (<c>formatQuantity(v, "K", { as: "°C" })</c>). Leaving the token
        /// out means a kelvin reading cannot be declared with a °C suffix.
        /// </summary>
        public const string Kelvin = "K";

        /// <summary>
        /// Tonnes, the unit KSP reports a vessel's mass in
        /// (<c>DeltaVStageInfo.startMass</c> and similar). The client's ladder
        /// normalises to kilograms before scaling, so a tonne value still climbs
        /// and falls correctly.
        /// </summary>
        public const string Tonnes = "t";

        /// <summary>
        /// Kilograms, the unit KSP reports a BODY's mass in
        /// (<c>CelestialBody.Mass</c>), as distinct from a vessel's, which it
        /// reports in tonnes. Both are mass and the unit system converts between
        /// them; the attribute states which one the wire carries.
        /// </summary>
        public const string Kilograms = "kg";

        /// <summary>
        /// Kilograms per second: propellant leaving a vessel while an engine
        /// runs. An n-body flight plan integrates the burn rather than applying
        /// an impulse, so the mass the vessel is shedding is part of the planned
        /// profile and a stage change moves the trajectory.
        /// </summary>
        public const string KilogramsPerSecond = "kg/s";

        /// <summary>Kilonewtons, KSP's own thrust unit (<c>DeltaVStageInfo.thrustVac</c>).</summary>
        public const string Kilonewtons = "kN";

        /// <summary>Kilopascals, the unit KSP reports static and dynamic pressure in.</summary>
        public const string Kilopascals = "kPa";

        /// <summary>Kilowatts of power.</summary>
        public const string Kilowatts = "kW";

        /// <summary>
        /// Bits, the base of the data dimension and the only data unit the
        /// catalog owns. Larger rungs and families belong to whoever models them:
        /// an antenna mod deals in bits, a life-support mod in bytes, and each
        /// declares its own units against this axis. Declaring the axis here
        /// means two mods cannot disagree on it by accident, since one spelling
        /// it <c>bits</c> would get a separate dimension.
        /// </summary>
        public const string Bits = "bit";

        /// <summary>
        /// Bits per second. Rates compose from a data unit and a second rather
        /// than being declared one token per rung, so any declared data unit
        /// gets its per-second form for free.
        /// </summary>
        public const string BitsPerSecond = "bit/s";

        /// <summary>
        /// Absorbed dose rate, rad per second. Per second on the wire even
        /// though rad/h is what an operator reads: the wire carries the rate as
        /// sampled and the client multiplies by 3600 for display.
        /// </summary>
        public const string RadPerSecond = "rad/s";

        /// <summary>Radiant flux per unit area, watts per square metre.</summary>
        public const string WattsPerSquareMetre = "W/m²";

        /// <summary>
        /// Mits, KSP's own unit of science data volume
        /// (<c>ScienceData.dataAmount</c>). Not an SI quantity and not
        /// convertible to one, but a named unit with a fixed meaning in game,
        /// unlike the per-resource <see cref="ResourceUnits"/>.
        /// </summary>
        public const string Mits = "Mit";

        /// <summary>
        /// Decibels. Logarithmic, so it must never be prefix-scaled: "3.2 kdB"
        /// is not a value.
        /// </summary>
        public const string Decibels = "dB";

        /// <summary>Kilograms per cubic metre, the unit of atmospheric density.</summary>
        public const string KilogramsPerCubicMetre = "kg/m³";

        /// <summary>Multiples of standard gravity, the g-force convention KSP's own <c>Vessel.geeForce</c> reports in.</summary>
        public const string GForce = "g";

        /// <summary>Standard gravitational parameter (GM), the unit KSP's <c>CelestialBody.gravParameter</c> is in.</summary>
        public const string CubicMetresPerSecondSquared = "m³/s²";

        /// <summary>
        /// A 0..1 fraction of some maximum, conventionally presented as a
        /// percentage. Distinct from <see cref="Dimensionless"/> because the
        /// presentation rule differs: a ratio wants "×100 and append %", a
        /// dimensionless number is shown bare.
        /// </summary>
        public const string Ratio = "ratio";

        /// <summary>A pure number carrying no unit and no implied scaling (e.g. Mach).</summary>
        public const string Dimensionless = "1";

        /// <summary>
        /// A value that is already 0..100. Distinct from <see cref="Ratio"/>: a
        /// ratio is multiplied by 100 for display and a percentage never is, and
        /// confusing the two yields either 0.62% or 6250%, both plausible enough
        /// on screen to go unnoticed.
        ///
        /// <para>Prefer <see cref="Ratio"/> for anything the mod computes
        /// itself; this is for values KSP or a third-party mod already hands
        /// over pre-multiplied.</para>
        /// </summary>
        public const string Percent = "%";

        // KSP's three currencies are not physical quantities and are not interchangeable, so each has its own token; how they are presented is the client's decision.

        /// <summary>
        /// Career funds. Whole-currency, thousands-separated, and never scaled
        /// onto a k/M ladder: an operator reading a launch cost needs the exact
        /// figure, and "0.3 Mf" is not a number anyone can act on.
        /// </summary>
        public const string Funds = "funds";

        /// <summary>Science points, the currency, not <see cref="Mits"/> of data volume.</summary>
        public const string Science = "science";

        /// <summary>
        /// Science currency generated per GAME-DAY (Kerbin's 21600 s day on a
        /// stock save, longer under RSS), not per second. KSP's own
        /// <c>ModuleScienceConverter.CalculateScienceRate</c> computes the rate
        /// this way: the per-tick rate scaled up by one game day
        /// (<c>KSPUtil.dateTimeFormatter.Day</c>).
        /// </summary>
        public const string SciencePerDay = "science/day";

        /// <summary>
        /// Career funds per GAME-DAY, the same denominator
        /// <see cref="SciencePerDay"/> carries. Used for subsidy and upkeep
        /// figures: under a career overhaul money arrives and leaves
        /// continuously, so an income or a standing cost is a rate, and a rate
        /// with no declared period cannot be compared against the balance
        /// beside it.
        ///
        /// <para>Spelled with the funds symbol <c>f</c> rather than the
        /// dimension name, matching <see cref="ReputationPerDay"/>, so a balance
        /// and a rate render with the same symbol ("289,848f" and
        /// "980.0 f/day").</para>
        /// </summary>
        public const string FundsPerDay = "f/day";

        /// <summary>Reputation points.</summary>
        public const string Reputation = "rep";

        /// <summary>
        /// Reputation lost or gained per GAME-DAY. A career overhaul can make
        /// reputation decay, and then a bare reputation reading is a snapshot of
        /// something actively falling: the rate is what makes it actionable.
        /// </summary>
        public const string ReputationPerDay = "rep/day";

        /*
         * Every token below declares that a property has no physical dimension, which is a different
         * statement from silence: it lets the coverage gate treat a bare property as a defect.
         * These break the append-verbatim rule, so the client maps them to an empty display symbol
         * (packages/ui-kit/src/units.ts).
         */

        /// <summary>
        /// An integral tally: crew counts, part counts, stage numbers, retry
        /// attempts. Not a dimensional quantity; the client shows it with no
        /// suffix.
        ///
        /// <para>Distinct from <see cref="Dimensionless"/>. A dimensionless
        /// number is a real measurement that happens to have no unit (Mach, TWR,
        /// eccentricity) and is read to two decimals; a count is integral, and
        /// "3.00 crew" is wrong.</para>
        /// </summary>
        public const string Count = "count";

        /// <summary>
        /// A label that happens to be stored as a number or a string: a
        /// flightID, a body index, a part id, a subscription topic.
        ///
        /// <para>Distinct from <see cref="Count"/> because arithmetic on it is
        /// meaningless: summing two ids is nothing. A client that knows this
        /// will not offer an id as a graph series or a statistic.</para>
        ///
        /// <para>Ids are never thousands-separated: "1,234" reads back as a
        /// different identifier from 1234.</para>
        /// </summary>
        public const string Id = "id";

        /// <summary>
        /// KSP's per-resource "units", which mean something different for every
        /// resource: a unit of LiquidFuel and a unit of Ore share a name and
        /// nothing else, with different densities and different costs.
        ///
        /// <para>The declaration says "this is in resource units, whose meaning
        /// depends on the resource named beside it". It is not an SI quantity
        /// and never converts.</para>
        /// </summary>
        public const string ResourceUnits = "units";

        /// <summary>
        /// A flow of <see cref="ResourceUnits"/> per second: solar-panel charge
        /// rates, fuel-cell output, converter throughput, life-support
        /// consumption.
        ///
        /// <para>Per second on the wire even where an operator reads per minute
        /// or per hour, like <see cref="RadPerSecond"/>: the wire carries the
        /// rate as sampled and the client scales for display.</para>
        /// </summary>
        public const string ResourceUnitsPerSecond = "units/s";

        /// <summary>
        /// Free text meant for a human: a vessel name, a biome, a status
        /// message, a formatted timestamp.
        /// </summary>
        public const string Text = "text";

        /// <summary>A two-state flag.</summary>
        public const string Flag = "flag";

        /// <summary>
        /// One of a fixed set of named states. The set itself is the property's
        /// enum type, which the generated TypeScript carries; this token only
        /// says the value is a member of a closed set, so a generic renderer
        /// looks for a label rather than printing the raw value.
        /// </summary>
        public const string Enumeration = "enum";

        /// <summary>
        /// Nothing useful to say. The last resort.
        ///
        /// <para>Use it only when none of the tokens above fit: an opaque
        /// numeric whose meaning is the producer's business, a serialized blob,
        /// a field kept for wire compatibility. If the value is a quantity, a
        /// count, an id, text, a flag or an enum, declare that instead.</para>
        /// </summary>
        public const string NotApplicable = "n/a";
    }

    /// <summary>
    /// Declares the unit a wire-payload property's value is expressed in, so
    /// the unit is machine-readable. The TypeScript SDK exposes the resulting
    /// map, so a consumer can ask <c>unitOf("vessel.flight",
    /// "surfaceSpeed")</c> instead of hard-coding a literal.
    ///
    /// <para>Metadata only: it does not touch the wire, and annotating a field
    /// costs nothing per tick.</para>
    ///
    /// <para><b>Every scalar property declares something.</b> The
    /// non-quantities have tokens of their own (<see cref="Units.Count"/>,
    /// <see cref="Units.Id"/>, <see cref="Units.Text"/>,
    /// <see cref="Units.Flag"/>, <see cref="Units.Enumeration"/>, and
    /// <see cref="Units.NotApplicable"/> as a last resort), so declaring is
    /// always possible and silence always means someone forgot.</para>
    ///
    /// <para><b>A wrong annotation is worse than none</b>, because a formatter
    /// will confidently mislabel the value. Where a field's unit is genuinely
    /// ambiguous, declare <see cref="Units.NotApplicable"/> rather than guess
    /// at a dimension.</para>
    ///
    /// <para>Structural properties are exempt: a nested payload object, or a
    /// collection of them, is described entirely by the units on its
    /// leaves.</para>
    /// <internal>
    /// RtConfig.EmitUnitMap reflects over these and emits
    /// mod/sitrep-sdk/src/__generated__/units.ts. It is an attribute rather
    /// than a sidecar table because rtcli runs against the compiled
    /// Sitrep.Contract.dll, and an attribute moves with a rename. It is compiled
    /// into both target frameworks, like SitrepTopicAttribute, so reflecting
    /// over it never resolves an external assembly. JsonWriter never reads it.
    /// UnitCoverageTests in Sitrep.Core.Tests enforces coverage against a
    /// shrink-only baseline; the exemption for structural properties is derived
    /// from the property type, not from a list of names.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepUnitAttribute : Attribute
    {
        /// <summary>One of the <see cref="Units"/> tokens, or a unit an Uplink registered on the client.</summary>
        public string Unit { get; }

        /// <summary>Declares the property's unit.</summary>
        /// <param name="unit">The unit token, normally a <see cref="Units"/> constant.</param>
        public SitrepUnitAttribute(string unit)
        {
            Unit = unit;
        }
    }
}
