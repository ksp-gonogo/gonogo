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
