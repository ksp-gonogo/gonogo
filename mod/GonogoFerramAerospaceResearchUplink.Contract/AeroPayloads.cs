#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace GonogoFerramAerospaceResearchUplink;

/// <summary>
/// The <c>aero.state</c> channel: the aerodynamic state of the active vessel, as
/// computed by the full-fidelity aerodynamics model the player has installed.
/// Produced by <c>FerramAerospaceResearchUplink</c>, which reads Ferram
/// Aerospace Research's per-vessel <c>VesselFlightInfo</c> by reflection.
///
/// <para><b>This is aerodynamic state, not atmospheric state.</b> Mach number,
/// dynamic pressure, density and the temperatures stay on <c>vessel.flight</c>
/// and are correct there even with FAR installed: FAR's own flight-data window
/// reads the stock dynamic pressure, and its integrator registration overrides
/// forces and exposed areas rather than the atmosphere. What no channel carried
/// before this one is the vessel's ATTITUDE TO THE AIRFLOW and what that
/// attitude is costing it: angle of attack, sideslip, how much of the wing is
/// stalled, the lift and drag it is producing, and the two figures a descent is
/// judged by.</para>
///
/// <para><b>Every field is nullable, and absence is load-bearing.</b> An
/// aircraft with no aerodynamic reading is not an aircraft at zero angle of
/// attack, and a rocket with no wings has no stall fraction rather than a stall
/// fraction of zero. The mod half computes several of these as division results
/// that are undefined in exactly the states an operator most wants a straight
/// answer in (a wingless craft, a vacuum coast, a vehicle sitting on the pad),
/// so each is published only where it is defined; see <c>AeroCapture</c>, which
/// names the condition per field.</para>
///
/// <para>A TS-shape-only typing/codegen marker: the uplink hand-builds the dict
/// and <c>JsonWriter</c> walks that live tree, so this POCO never serializes.
/// Classified <c>DelayRole.Delayed</c> (a per-vessel telemetry fact, subject to
/// the reveal-gate); the bare <c>aero.available</c> presence primitive is
/// <c>DelayRole.TrueNow</c> and declared client-side.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("aero.state")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class AeroState
{
    /// <summary>
    /// Angle between the airflow and the vessel's own longitudinal axis, in the
    /// pitch plane. The number an ascent is flown to and a re-entry is held on,
    /// and the one no channel carried before.
    /// </summary>
    [SitrepUnit(Units.Degrees)]
    public double? AngleOfAttack { get; set; }

    /// <summary>Angle between the airflow and the vessel's plane of symmetry, in yaw.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Sideslip { get; set; }

    /// <summary>
    /// How much of the vessel's wing area is stalled, weighted by area: 0 is
    /// fully attached flow, 1 is every wing stalled. Absent on a craft with no
    /// aerodynamic wing surfaces at all, which is most rockets, because the
    /// quantity is a fraction OF wing area and there is none.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? StallFraction { get; set; }

    /// <summary>Whole-vessel lift coefficient, referenced to <see cref="ReferenceArea"/>.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? LiftCoefficient { get; set; }

    /// <summary>Whole-vessel drag coefficient, referenced to <see cref="ReferenceArea"/>.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? DragCoefficient { get; set; }

    /// <summary>
    /// Lift over drag: how far the vessel travels per unit of height it gives
    /// up, and the figure a glide or a lifting entry is flown by.
    /// </summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? LiftToDragRatio { get; set; }

    /// <summary>
    /// The area the two coefficients above are referenced to: total wing area on
    /// a winged craft, otherwise the maximum cross-section the aerodynamics model
    /// voxelised. Published because a coefficient without its reference area is
    /// not comparable to anything, including the same vessel after staging.
    /// Read it against <see cref="AeroModelValid"/>: with neither wings nor a
    /// current voxelisation the model substitutes one square metre, and the
    /// coefficients beside it are then referenced to a placeholder.
    /// </summary>
    [SitrepUnit(Units.SquareMetres)]
    public double? ReferenceArea { get; set; }

    /// <summary>Total aerodynamic lift, perpendicular to the airflow.</summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double? LiftForce { get; set; }

    /// <summary>Total aerodynamic drag, along the airflow.</summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double? DragForce { get; set; }

    /// <summary>
    /// Indicated airspeed: what a pitot tube on this vehicle would read, from the
    /// stagnation pressure at the current Mach and ambient pressure. The speed an
    /// airframe's limits are written against, unlike the surface speed on
    /// <c>vessel.flight</c>.
    /// </summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? IndicatedAirspeed { get; set; }

    /// <summary>
    /// Equivalent airspeed: surface speed scaled by the square root of density
    /// ratio to sea level, so a given value means the same dynamic pressure at
    /// any altitude.
    /// </summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? EquivalentAirspeed { get; set; }

    /// <summary>
    /// Terminal velocity at the current attitude, altitude and mass: the speed at
    /// which drag balances weight. Absent while the vessel produces no drag to
    /// balance against, which includes every vacuum coast.
    /// </summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? TerminalVelocity { get; set; }

    /// <summary>
    /// Ballistic coefficient: mass over drag area. Low decelerates high and
    /// early, high drives the deceleration deeper into the atmosphere, which is
    /// what makes it the number an entry corridor is judged on.
    /// </summary>
    [SitrepUnit(Contract.Units.KilogramsPerSquareMetre)]
    public double? BallisticCoefficient { get; set; }

    /// <summary>
    /// Specific excess power: thrust less drag, per unit mass, at the current
    /// speed. Positive means the vehicle can still climb or accelerate on the
    /// power it has; crossing to negative is where an X-plane's climb stops.
    /// </summary>
    [SitrepUnit(Contract.Units.WattsPerKilogram)]
    public double? SpecificExcessPower { get; set; }

    /// <summary>
    /// Whether the aerodynamics model's voxelisation of this vessel is current.
    /// False after a stage separation, a deployment or a docking until the model
    /// has re-run, during which every coefficient above still describes the
    /// PREVIOUS shape. It is a qualifier on the readings beside it rather than a
    /// reading of its own, which is why it stays present when they go absent.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? AeroModelValid { get; set; }
}
