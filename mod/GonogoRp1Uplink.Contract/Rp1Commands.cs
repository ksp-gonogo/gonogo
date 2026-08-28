#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace GonogoRp1Uplink;

/// <summary>
/// Args for <c>rp1.build.repeat</c>: build another copy of a design RP-1 already
/// holds, at the launch complex that holds it.
///
/// <para>ONE field, and it is an id rather than a name. Under RP-1 a design is
/// built repeatedly on purpose (that is the career loop: design once, fly the
/// same vehicle many times), so several vehicles of the same name sit in the
/// same complex and a name addresses none of them. The id is RP-1's own
/// <c>KCTPersistentID</c>, published on <see cref="Rp1BuildItemEntry.Id"/> and
/// <see cref="Rp1WarehouseItemEntry.Id"/>.</para>
///
/// <para>The complex is NOT an argument. RP-1 stores the launch complex on the
/// vehicle, and a copy is built where its original was: a client that could
/// name a destination could name one whose limits the vehicle does not meet,
/// and the operator's question is "another one of these", not "another one of
/// these somewhere else". Moving a design between complexes is a different
/// action and would be a different command.</para>
///
/// <para>Declared in this Uplink's own contract slice, never in
/// <c>Sitrep.Contract</c>: no Uplink-specific wire type may live in core, even
/// for an Uplink that ships bundled.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1BuildRepeatArgs
{
    /// <summary>The vehicle to copy, by RP-1's <c>KCTPersistentID</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }
}

/// <summary>
/// Args for <c>rp1.vehicle.rollout</c>: move a finished vehicle out of its
/// complex's warehouse and onto a launch pad.
///
/// <para>The vehicle is addressed the same way and for the same reason
/// <see cref="Rp1BuildRepeatArgs.Id"/> is.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1RolloutArgs
{
    /// <summary>The finished vehicle to roll out, by RP-1's <c>KCTPersistentID</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>
    /// Which pad, by the name RP-1 gives it and <c>rp1.pads[].name</c>
    /// publishes. <b>REQUIRED</b>: the command refuses when it is absent, even
    /// when only one pad could possibly have been meant.
    ///
    /// <para>Nullable in the type only because every field on this wire is, so
    /// that a client sending an older shape fails as a refusal rather than a
    /// deserialisation error. An absent pad is never a default.</para>
    ///
    /// <para><b>Operator ruling, 2026-08-27.</b> An earlier draft let this be
    /// omitted and used the single free pad when there was exactly one. That was
    /// rejected, and the reason is worth keeping: choosing a launch site is a
    /// decision an operator makes, and a mod that silently picks when the choice
    /// looks obvious has taken the decision anyway. Requiring it also means the
    /// wire RECORDS what was chosen, so a dispatch log says which pad an operator
    /// sent a vehicle to rather than leaving it to be inferred from whichever pad
    /// happened to be free at the time.</para>
    ///
    /// <para>The client is where the convenience belongs: it may PRESELECT the
    /// only eligible pad so a one-pad complex is still a single press, but the
    /// command it sends carries the name explicitly. Eligibility is on the wire
    /// for it to do that with, as <c>rp1.pads[].state</c> plus
    /// <c>rp1.pads[].hasVesselWaiting</c> for the pad half and
    /// <c>rp1.warehouse[].rolloutRefusals</c> for the vehicle half.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Pad { get; set; }
}

/// <summary>
/// Args for <c>rp1.vehicle.rollback</c> and <c>rp1.vehicle.scrap</c>: the two
/// commands that need nothing but a vehicle.
///
/// <para>One type for both, because they take the same single argument and a
/// second identical class would only invite the two to drift. What they do with
/// it is entirely different and lives in the handlers.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1VehicleArgs
{
    /// <summary>The vehicle, by RP-1's <c>KCTPersistentID</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }
}

/// <summary>
/// Args for <c>rp1.complex.rush</c>: put a launch complex into rush mode, or
/// take it out.
///
/// <para><b>Why this is not a per-vehicle command.</b> RP-1 keeps
/// <c>IsRushing</c> as a bool on the LAUNCH COMPLEX, not on a vehicle: rushing
/// is a mode the whole complex is in, every project inside it is rushed
/// together, and the cost is a standing multiplier on engineer salaries rather
/// than a purchase. A command shaped like "rush this build" would be a lie
/// about what the game does, so the complex is the subject and the vehicle is
/// not addressable here at all.</para>
///
/// <para>A SET rather than a toggle. An operator commanding from a remote
/// vantage is reading a complex's state as it was, and a toggle applied to a
/// state that has since changed does the opposite of what was asked; a set
/// lands on the state that was asked for whenever it arrives.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1ComplexRushArgs
{
    /// <summary>The complex, by the GUID <c>rp1.complexes[].lcId</c> publishes.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>The mode to leave the complex in: rushing, or not.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Rushing { get; set; }
}

/// <summary>
/// Args for <c>rp1.personnel.assign</c>: move engineers between a centre's
/// unassigned pool and one of its launch complexes.
///
/// <para><b>It hires nobody.</b> Under RP-1 hiring and assigning are two
/// different acts with two different costs: hiring spends funds up front and
/// raises the payroll, assigning spends nothing and only decides which complex
/// the crew already on the books works at. This command is the second, so it can
/// never grow the headcount and can never take the career's balance down.</para>
///
/// <para>A SET rather than a delta, for the reason
/// <see cref="Rp1ComplexRushArgs"/> gives: an operator commanding from a remote
/// vantage is reading a crew count as it was, and "+5" applied to a count that
/// has since moved lands somewhere nobody chose. A target lands where it was
/// aimed however stale the view was, and re-sending it changes nothing.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1PersonnelAssignArgs
{
    /// <summary>The complex, by the GUID <c>rp1.complexes[].lcId</c> publishes.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>
    /// How many engineers this complex should end up with.
    ///
    /// <para>REQUIRED, and refused when absent: there is no sensible default for
    /// a crew size. Refused rather than clamped when it is above the complex's
    /// own maximum or above what the centre's pool can supply, because a clamp
    /// would report success for a number the operator did not ask for.</para>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? Engineers { get; set; }
}
