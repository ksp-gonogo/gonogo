#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Switch the headlamp of one kerbal outside a craft on or off, the remote-control
/// equivalent of the player pressing the lamp key while flying that kerbal.
///
/// <para>It acts on a kerbal in the group of the craft being reported, so it waits
/// on that craft's signal delay, like <c>vessel.control.*</c>. It sets an absolute
/// state, never a toggle, so a repeated command is safe. Read the result back from
/// <see cref="EvaKerbal.LampOn"/> on the kerbal's own Topic, one signal delay later.</para>
///
/// <para>KSP switches a lamp only for the kerbal it is flying, so a command for any
/// other kerbal is refused with <see cref="CommandErrorCode.WrongState"/> and says
/// why. An id that is not a kerbal outside is <see cref="CommandErrorCode.NotFound"/>.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("eva.kerbal.setLamp", Summary = "Turn a kerbal's headlamp on or off.")]
public class SetEvaLampArgs
{
    /// <summary>The kerbal's own vessel id, the same id <c>eva.crew</c> lists
    /// as <see cref="EvaCrewMember.KerbalVesselId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string KerbalVesselId { get; set; } = "";

    /// <summary><c>true</c> to switch the lamp on, <c>false</c> to switch it off.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Enabled { get; set; }
}
