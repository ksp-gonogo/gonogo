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
    /// publishes. Optional, and what happens when it is omitted is the whole
    /// reason it is a field.
    ///
    /// <para>RP-1's own rollout asks with a popup whenever more than one pad is
    /// free, and there is nobody to answer a popup on a command dispatched from
    /// another machine. So: named, and that pad is used; omitted with exactly
    /// one pad free, and that one is used; omitted with SEVERAL free, and the
    /// command REFUSES and names them. A complex with one pad, which is most of
    /// them for most of a career, stays a single press, and the mod never picks
    /// a destination on the operator's behalf.</para>
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
