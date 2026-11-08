#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Move a kerbal to another part of the active vessel
/// (<c>vessel.crew.transfer</c>). Docked craft are one vessel, so this also moves
/// a kerbal between them. Parts are named by flight id, the id
/// <c>vessel.parts</c> carries.
///
/// <para>A kerbal no longer in <see cref="FromPartId"/> is refused with
/// <see cref="CommandErrorCode.WrongState"/>. A full destination is refused with
/// <see cref="CommandErrorCode.LimitReached"/>. A part crew cannot use is refused
/// with <see cref="CommandErrorCode.CapabilityMismatch"/>, and a move a mod keeps
/// out with <see cref="CommandErrorCode.NotClearToProceed"/>.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.crew.transfer", Summary = "Move a kerbal to another part of the vessel.")]
public class CrewTransferArgs
{
    /// <summary>The kerbal's name, as <c>vessel.crew</c> gives it.</summary>
    [SitrepUnit(Units.Text)]
    public string KerbalName { get; set; } = "";

    /// <summary>The part the kerbal was last seen in.</summary>
    [SitrepUnit(Units.Id)]
    public string FromPartId { get; set; } = "";

    /// <summary>The part to move the kerbal into.</summary>
    [SitrepUnit(Units.Id)]
    public string ToPartId { get; set; } = "";
}

/// <summary>A part's seats, on <c>vessel.parts</c>.</summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartSeats
{
    /// <summary>How many kerbals the part can hold now. Some habitats change this in flight.</summary>
    [SitrepUnit(Units.Count)]
    public int Capacity { get; set; }

    /// <summary>False for a part the game keeps crew from moving into or out of.</summary>
    [SitrepUnit(Units.Flag)]
    public bool TransferAvailable { get; set; }

    /// <summary>True for an external command seat, which is never a source or destination.</summary>
    [SitrepUnit(Units.Flag)]
    public bool IsExternalSeat { get; set; }
}
