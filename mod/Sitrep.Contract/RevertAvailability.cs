#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>ksp.revertAvailability</c> Topic payload: whether the two stock
/// in-flight revert actions are available right now, so a widget can enable
/// its Revert to Launch and Revert to Editor controls exactly when KSP's own
/// pause menu shows them.
///
/// <para>The whole payload is <c>null</c> (no key emitted) outside the flight
/// scene, where the flags mean nothing. In flight both bools are always
/// present: <c>false</c> means that revert is not available right now.</para>
///
/// <para>Not delayed by light time: it is a fact about the game, not vessel
/// telemetry, and carries no per-payload <c>Meta</c> of its own (the
/// envelope's applies). Its delay role is <see cref="DelayRole.TrueNow"/>.</para>
/// <internal>
/// Read from the two static FlightDriver flags KSP reads when
/// PauseMenu.drawStockRevertOptions draws those buttons. "Revert to Launch"
/// (FlightDriver.RevertToLaunch, restoring the PostInitState) shows when
/// CanRevertToPostInit is set; "Revert to VAB/SPH" (RevertToPrelaunch) shows
/// when CanRevertToPrelaunch is set. So CanRevertToLaunch maps to
/// CanRevertToPostInit and CanRevertToEditor to CanRevertToPrelaunch: KSP's
/// names read backwards to their button labels. Outside flight the statics
/// carry leftover values from the previous flight, which is why the payload is
/// null there. Produced by Sitrep.Host.SystemViewProvider.BuildRevertAvailability,
/// on the same convention as SystemBodies.
/// </internal>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
[SitrepTopic("ksp.revertAvailability")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RevertAvailability
{
    /// <summary>Whether the active flight can be reverted to the editor (VAB or
    /// SPH), KSP's <c>FlightDriver.CanRevertToPrelaunch</c>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool CanRevertToEditor { get; set; }

    /// <summary>Whether the active flight can be reverted to its launch
    /// (on-the-pad) state, KSP's <c>FlightDriver.CanRevertToPostInit</c>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool CanRevertToLaunch { get; set; }
}
