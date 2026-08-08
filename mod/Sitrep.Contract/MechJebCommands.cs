#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Args for the <c>mechjeb.engageAscentAutopilot</c> command: the target
/// orbit altitude MechJeb's ascent autopilot flies to
/// (<c>MechJebModuleAscentSettings.DesiredOrbitAltitude</c>, see
/// <c>local_docs/design/mechjeb-decompile-lock.md</c>). Client-authored, in
/// kilometres: the pre-existing MechJeb widget (predating this Uplink)
/// already builds this wire key from its <c>altitudeKm</c> input, so the
/// field name and unit are carried forward rather than invented fresh. The
/// mod converts to metres (<c>EditableDoubleMult.Val = TargetAltitudeKm *
/// 1000.0</c>) before writing it.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class MechJebAscentArgs
{
    /// <summary>Target orbit altitude, in kilometres.</summary>
    [SitrepUnit(Units.Kilometres)]
    public double TargetAltitudeKm { get; set; }
}

/// <summary>
/// Args for <c>mechjeb.executeNextNode</c> / <c>mechjeb.landAtTarget</c>:
/// both commands fire with no parameters. This is the trivial no-payload
/// marker DTO the engine's generic <c>AddCommandHandler&lt;TArgs,
/// TResult&gt;</c> binds to, so the two commands still have a real typed arg
/// shape rather than a bare <c>object?</c>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class MechJebNoArgs
{
}
