using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// The canonical unit tokens a <see cref="SitrepUnitAttribute"/> may carry.
    /// Every token is a <c>const string</c> so it can be used as an attribute
    /// argument, and so codegen can emit the set as a TypeScript union
    /// (<c>KnownSitrepUnit</c> in the generated <c>units.ts</c>): both sides of
    /// the wire then reject a typo at COMPILE time rather than shipping a
    /// second spelling of an existing unit.
    ///
    /// <para>This catalog is closed and the TypeScript <c>SitrepUnit</c> type
    /// is NOT, and the asymmetry is deliberate. A third-party Uplink cannot add
    /// a <c>const</c> to a class compiled into this assembly, so a closed wire
    /// type would have meant an Uplink could never declare a unit at all. It
    /// declares a plain string instead and teaches the client what the symbol
    /// means with <c>registerUnit</c>. The catalog check in
    /// <see cref="RtConfig"/> therefore applies to first-party payloads only,
    /// which is exactly the set it can see.</para>
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

        /// <summary>
        /// Kilometres. Exists for <c>MechJebAscentArgs.TargetAltitudeKm</c>: the
        /// pre-existing MechJeb widget (predating the Uplink) already builds this
        /// wire key in km, and the attribute states what the wire ALREADY carries
        /// rather than requesting a conversion.
        ///
        /// <para>Do not reach for this on anything new. Every other distance on
        /// this wire is <see cref="Metres"/>; the client's own presentation ladder
        /// already promotes a metres value to km above 1000m, so a wire field only
        /// needs this token when it is genuinely authored in km, not merely
        /// displayed that way.</para>
        /// </summary>
        public const string Kilometres = "km";

        // --- Area / volume ---
        /// <summary>Square metres, KSP's own habitat surface unit.</summary>
        public const string SquareMetres = "m²";

        /// <summary>Cubic metres, KSP's own habitat volume unit.</summary>
        public const string CubicMetres = "m³";

        // --- Speed ---
        public const string MetresPerSecond = "m/s";

        // --- Angle ---
        public const string Degrees = "°";
        public const string Radians = "rad";

        // --- Time ---
        /// <summary>
        /// A DURATION in seconds. How long something takes, how long is left.
        /// See <see cref="UniversalTime"/> for the other thing seconds measure.
        /// </summary>
        public const string Seconds = "s";

        /// <summary>
        /// An INSTANT on the universal-time clock, past or future. Seconds
        /// since the game's epoch, never an interval.
        /// </summary>
        ///
        /// <remarks>
        /// <para>Same dimension as <see cref="Seconds"/> and deliberately so: a
        /// UT plus a duration is a UT, and the unit system's arithmetic should
        /// keep working. What differs is the KIND, which never gates arithmetic
        /// and only drives display, and that is exactly the distinction wanted.
        /// A consumer renders a UT as a date, or subtracts the frame's view
        /// time from it to get a countdown; it never renders it as one.</para>
        ///
        /// <para>This exists because the repo already shipped the bug it
        /// prevents. <c>OrbitEncounter.TransitionUt</c> reached
        /// <c>&lt;Countdown&gt;</c> through <c>vessel.state</c> in two widgets,
        /// so a Mun encounter twenty minutes away rendered as "46d 2h", and the
        /// gate in front of it (<c>&gt; 0</c>) passes for every UT there has
        /// ever been. A third widget reading the same field subtracted the view
        /// time correctly, with a comment explaining why: one author knew and
        /// the others could not, because <c>"s"</c> is the same token on both
        /// meanings and the boundary that exists to catch this had nothing to
        /// say. Telemachus, for what it is worth, carried two separate keys for
        /// this one event and the migration collapsed them.</para>
        /// </remarks>
        public const string UniversalTime = "ut";

        /// <summary>
        /// Hours. The ONE non-second duration on this wire, and it exists only
        /// because <c>ReliabilityPartEntry.MtbfHours</c> genuinely carries hours:
        /// TestFlight reports MTBF that way and the contract states what it is
        /// carrying rather than converting.
        ///
        /// <para>Do not reach for this on anything new. Every other duration is
        /// <see cref="Seconds"/>, and the field this exists for is itself a
        /// rename candidate: once it is <c>Mtbf</c> in seconds, this token has no
        /// remaining user and should go with it.</para>
        /// </summary>
        public const string Hours = "h";

        // --- Rotation ---
        /// <summary>
        /// Revolutions per minute, KSP's own rotor unit
        /// (<c>ModuleRoboticServoRotor.rpmLimit</c> and the live rotor speed
        /// beside it). Angular velocity in rad/s everywhere else would be more
        /// consistent and would also be a conversion, which this attribute does
        /// not do.
        /// </summary>
        public const string Rpm = "rpm";

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

        // --- Mass ---
        /// <summary>
        /// Tonnes, because that is the unit KSP reports mass in
        /// (<c>DeltaVStageInfo.startMass</c> and friends) and this attribute
        /// states what the wire ALREADY carries rather than requesting a
        /// conversion. The client's ladder normalises to kilograms before
        /// scaling, so a tonne value still climbs and falls correctly.
        /// </summary>
        public const string Tonnes = "t";

        /// <summary>
        /// Kilograms, the unit KSP reports a BODY's mass in
        /// (<c>CelestialBody.Mass</c>), as distinct from a VESSEL's, which it
        /// reports in tonnes. Both are mass and the unit system converts
        /// between them; the attribute states which one the wire carries.
        /// </summary>
        public const string Kilograms = "kg";

        /// <summary>
        /// Kilograms per second: propellant leaving a vessel while an engine
        /// runs. An n-body flight plan integrates the burn rather than applying
        /// an impulse, so the mass the vessel is shedding is part of the planned
        /// profile and a stage change moves the trajectory.
        /// </summary>
        public const string KilogramsPerSecond = "kg/s";

        // --- Force ---
        /// <summary>Kilonewtons, KSP's own thrust unit (<c>DeltaVStageInfo.thrustVac</c>).</summary>
        public const string Kilonewtons = "kN";

        // --- Pressure ---
        public const string Kilopascals = "kPa";

        // --- Power ---
        public const string Kilowatts = "kW";

        // --- Data ---
        /// <summary>
        /// The BASE of the data dimension, and the only data unit core owns.
        /// Rungs and families belong to whoever models them: an antenna mod
        /// deals in bits, a life-support mod in bytes, and each declares its
        /// own units against this axis. Core declares the axis so the two
        /// cannot agree on it by accident, since a mod spelling it `bits`
        /// would get a silently separate dimension.
        /// </summary>
        public const string Bits = "bit";

        /// <summary>
        /// Rates COMPOSE from a data unit and a second rather than being
        /// declared one atom per rung, so any declared data unit gets its
        /// per-second form for free.
        /// </summary>
        public const string BitsPerSecond = "bit/s";

        // --- Radiation ---
        /// <summary>
        /// Absorbed dose rate, rad per second. Per SECOND on the wire even
        /// though rad/h is what an operator reads: the wire carries the rate
        /// as sampled and the client multiplies by 3600 for display, which is
        /// the same direction of travel as kelvin-not-Celsius.
        /// </summary>
        public const string RadPerSecond = "rad/s";

        // --- Irradiance ---
        /// <summary>Radiant flux per unit area, watts per square metre.</summary>
        public const string WattsPerSquareMetre = "W/m²";

        // --- Science data ---
        /// <summary>
        /// Mits, KSP's own unit of science data volume
        /// (<c>ScienceData.dataAmount</c>). Not an SI quantity and not
        /// convertible to one, but a real named unit with a fixed meaning in
        /// game, which is what separates it from the unitless "resource units"
        /// this vocabulary deliberately refuses to name.
        /// </summary>
        public const string Mits = "Mit";

        // --- Level ---
        /// <summary>
        /// Decibels. Logarithmic, so it is the one quantity here that must
        /// never be prefix-scaled: "3.2 kdB" is not a thing, and a ladder
        /// applied to a log scale is wrong rather than merely ugly.
        /// </summary>
        public const string Decibels = "dB";

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

        /// <summary>
        /// A value that is ALREADY 0..100. Distinct from <see cref="Ratio"/>
        /// and the distinction is load-bearing: a ratio is multiplied by 100
        /// for display, a percentage must never be, and confusing the two
        /// yields either 0.62% or 6250%. Both are plausible enough on screen
        /// to go unnoticed, which is why they are separate tokens rather than
        /// one with a convention.
        ///
        /// <para>Prefer <see cref="Ratio"/> for anything the mod computes
        /// itself; this exists for values KSP or a third-party mod already
        /// hands over pre-multiplied.</para>
        /// </summary>
        public const string Percent = "%";

        // --- Career currencies ------------------------------------------------
        //
        // KSP's three currencies. They are not physical quantities and they are
        // not interchangeable with each other or with anything else, which is
        // exactly why they are three separate tokens rather than one "amount":
        // a formatter that treats reputation like funds will thousands-separate
        // a number that never exceeds a few hundred, and one that treats funds
        // like reputation will print 289848 where the operator needs 289,848.
        //
        // Their PRESENTATION is a client decision and is deliberately not stated
        // here: see the units design's rule that the contract says what a value
        // IS and each presentation site chooses how to show it.

        /// <summary>
        /// Career funds. Whole-currency, thousands-separated, and never scaled
        /// onto a k/M ladder: an operator reading a launch cost needs the exact
        /// figure, and "0.3 Mf" is not a number anyone can act on.
        /// </summary>
        public const string Funds = "funds";

        /// <summary>Science points, the currency, not <see cref="Mits"/> of data volume.</summary>
        public const string Science = "science";

        /// <summary>
        /// Science currency generated per GAME-DAY (Kerbin's 21600s day on a
        /// stock save, longer under RSS), not per second. Exists for
        /// <c>LabEntry.ScienceRate</c>: the host reads it off
        /// <c>ModuleScienceConverter.CalculateScienceRate</c>, which
        /// decompiles to <c>Day * scientists * dataAmount *
        /// dataProcessingMultiplier * scienceMultiplier /
        /// 10^researchTime</c>, where <c>Day = KSPUtil.dateTimeFormatter.Day</c>:
        /// the per-tick rate scaled up by a full day.
        /// </summary>
        public const string SciencePerDay = "science/day";

        /// <summary>Reputation points.</summary>
        public const string Reputation = "rep";

        // --- Non-dimensional declarations -------------------------------------
        //
        // Every token below declares that a property has no PHYSICAL dimension,
        // which is a different statement from every token above and a very
        // different statement from silence.
        //
        // They exist because the old doctrine ("only annotate what is KNOWN",
        // absence means not-yet-stated) made the absent case unfalsifiable: a
        // new numeric field with no unit is indistinguishable from a boolean
        // that never needed one, so nothing could ever be enforced. Giving the
        // non-quantities a way to SAY SO is what lets the coverage gate treat a
        // bare property as a defect.
        //
        // These break the append-verbatim rule the catalog otherwise follows:
        // "12 count" and "3 id" are not readable, so the client maps them to an
        // EMPTY display symbol (packages/ui-kit/src/units.ts). That is the cost
        // of the tokens naming a category rather than a symbol, and it is paid
        // in one place.

        /// <summary>
        /// An integral tally. Crew counts, part counts, stage numbers, retry
        /// attempts.
        ///
        /// <para>Deliberately NOT <see cref="Dimensionless"/>. A dimensionless
        /// number is a real measurement that happens to have no unit (Mach,
        /// TWR, eccentricity) and is read to two decimals; a count is integral
        /// and "3.00 crew" is wrong. Collapsing them loses precisely the
        /// distinction this vocabulary exists to preserve.</para>
        /// </summary>
        public const string Count = "count";

        /// <summary>
        /// A label that happens to be stored as a number or a string: a
        /// flightID, a body index, a part id, a subscription topic.
        ///
        /// <para>Distinct from <see cref="Count"/> because ARITHMETIC ON IT IS
        /// MEANINGLESS. Summing two counts is a count; summing two ids is
        /// nothing. A client that knows this will not offer an id as a graph
        /// series or a statistic, which is the practical payoff.</para>
        ///
        /// <para>Also the reason ids must never be thousands-separated:
        /// "1,234" is a different identifier from 1234 to a human reading it
        /// back.</para>
        /// </summary>
        public const string Id = "id";

        /// <summary>
        /// KSP's per-resource "units", which mean something different for every
        /// resource: a unit of LiquidFuel and a unit of Ore share a name and
        /// nothing else, with different densities and different costs.
        ///
        /// <para>This vocabulary previously refused to name them at all (see
        /// <see cref="Mits"/>, which contrasts itself against exactly this).
        /// Refusing was right while absence meant "not stated"; under the new
        /// rule the honest declaration is "this is in resource units, whose
        /// meaning depends on the resource named beside it", and that is what
        /// this token says. It is not an SI quantity and never converts.</para>
        /// </summary>
        public const string ResourceUnits = "units";

        /// <summary>
        /// A flow of <see cref="ResourceUnits"/>, per second. Solar-panel
        /// charge rates, fuel-cell output, converter throughput, life-support
        /// consumption.
        ///
        /// <para>Per SECOND on the wire even where an operator reads per
        /// minute or per hour, the same direction of travel as
        /// <see cref="RadPerSecond"/> and kelvin-not-Celsius: the wire carries
        /// the rate as sampled and the client scales for display.</para>
        ///
        /// <para>Its existence is also what lets the unit-suffixed field names
        /// (<c>FoodRatePerSec</c>, <c>DegenPerSec</c>) be renamed: a name only
        /// has to encode a unit while there is no way to declare one.</para>
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
        /// enum type, which the generated TypeScript already carries; this only
        /// says "the value is a member of a closed set", so a generic renderer
        /// knows to look for a label rather than print the raw name.
        /// </summary>
        public const string Enumeration = "enum";

        /// <summary>
        /// Nothing useful to say. The LAST RESORT, and it should stay rare.
        ///
        /// <para>Reach for it only when none of the tokens above fit: an opaque
        /// numeric whose meaning is the producer's business, a serialized blob,
        /// a field kept for wire compatibility. If it is a quantity, a count, an
        /// id, text, a flag or an enum, say so; every one of those tells a
        /// consumer something, and this one tells it nothing.</para>
        /// </summary>
        public const string NotApplicable = "n/a";
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
    /// <para><b>Every scalar property declares something.</b> This inverts the
    /// rule this attribute shipped with ("only annotate what is KNOWN", absence
    /// reads as not-yet-stated). Absence was not a safe default, it was an
    /// unfalsifiable one: a new numeric field that nobody annotated looked
    /// exactly like a boolean that never needed annotating, so no gate could
    /// tell the defect from the non-case and the coverage stalled at a fifth of
    /// the surface.
    ///
    /// <para>The non-quantities now have tokens of their own
    /// (<see cref="Units.Count"/>, <see cref="Units.Id"/>,
    /// <see cref="Units.Text"/>, <see cref="Units.Flag"/>,
    /// <see cref="Units.Enumeration"/>, and
    /// <see cref="Units.NotApplicable"/> as a last resort), so declaring is
    /// always possible and silence always means someone forgot.
    /// <c>UnitCoverageTests</c> in <c>Sitrep.Core.Tests</c> enforces it against
    /// a baseline that may only shrink.</para>
    ///
    /// <para>What has NOT changed: <b>a WRONG annotation is worse than
    /// none</b>, because a formatter will confidently mislabel it. Where a
    /// field's unit is genuinely ambiguous, that is what
    /// <see cref="Units.NotApplicable"/> is for. Guessing at a dimension to
    /// clear the gate is the one failure mode this whole mechanism was built to
    /// prevent, and it is worse than the bare readout it replaces.</para></para>
    ///
    /// <para>Structural properties are exempt because a container has no
    /// dimension of its own: a nested contract POCO, or a collection of them,
    /// is described entirely by the units on its leaves. The gate derives that
    /// from the property TYPE rather than from a list of names, so it needs no
    /// maintenance when a payload gains a sub-object.</para>
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
