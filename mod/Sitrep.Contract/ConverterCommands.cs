#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Switch a converter on a part on or off (<c>vessel.converter.start</c> and
/// <c>vessel.converter.stop</c>). Reaches every converter the game runs as a
/// resource process: an ISRU unit, a fuel cell, a drill.
///
/// <para>The part is named by <see cref="PartId"/>, the part's flight id as a
/// string, the same id <c>isru.converters</c> and <c>isru.drills</c> carry on
/// each entry. An empty or unknown <see cref="PartId"/> fails with
/// <see cref="CommandErrorCode.NotFound"/>.</para>
///
/// <para>Start and stop are idempotent: a converter already in the requested
/// state answers success with <see cref="RunStateChange.Changed"/> false. A start
/// the game would refuse, such as a drill whose head is not deployed, fails with
/// <see cref="CommandErrorCode.WrongState"/>.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.converter.start", Payload = typeof(RunStateChange), Summary = "Switch a converter, drill or fuel cell on.")]
[SitrepCommand("vessel.converter.stop", Payload = typeof(RunStateChange), Summary = "Switch a converter, drill or fuel cell off.")]
public class ConverterSwitchArgs
{
    /// <summary>
    /// The converter's part, as its flight id in a string: the id the
    /// <c>isru.converters</c> and <c>isru.drills</c> entries are keyed by.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>
    /// Which converter on the part is meant, as the <c>converterName</c> of its
    /// <c>isru.converters</c> or <c>isru.drills</c> entry. Optional: an empty
    /// value means the part's only converter. A part can carry several, so an
    /// empty value on such a part is refused with
    /// <see cref="CommandErrorCode.NotFound"/>, as is a name the part does not
    /// carry.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? ConverterName { get; set; }
}
