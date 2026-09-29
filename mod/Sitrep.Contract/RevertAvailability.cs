#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>ksp.revertAvailability</c> Topic payload: whether the two stock
/// in-flight "revert" actions are currently available, so a widget can gate
/// its Revert-to-Launch and Revert-to-Editor controls exactly as KSP's own
/// pause menu does. Read from the two static <c>FlightDriver</c> flags KSP
/// reads when it draws those buttons.
///
/// <para>The whole payload is <c>null</c> (no key emitted) outside the flight
/// scene: the two flags are only meaningful in flight, and the backing
/// <c>FlightDriver</c> statics carry leftover values from the previous flight
/// otherwise. When present, both bools are concrete (never null): a
/// <c>false</c> means "this revert is not available right now".</para>
///
/// <para><b>Mapping (as KSP's <c>PauseMenu.drawStockRevertOptions</c> draws
/// it):</b> the pause menu
/// shows the "Revert to Launch" button (which calls
/// <c>FlightDriver.RevertToLaunch()</c>, restoring the <c>PostInitState</c>)
/// when <c>FlightDriver.CanRevertToPostInit</c> is set, and the "Revert to
/// VAB/SPH" buttons (which call <c>FlightDriver.RevertToPrelaunch(...)</c>,
/// returning to the editor) when <c>FlightDriver.CanRevertToPrelaunch</c> is
/// set. So <see cref="CanRevertToLaunch"/> maps to <c>CanRevertToPostInit</c>
/// and <see cref="CanRevertToEditor"/> maps to <c>CanRevertToPrelaunch</c>: the
/// KSP field names read backwards to their button labels, so the mapping is
/// the inverse of a naive name match.</para>
///
/// <para>A scene-side fact with no per-payload <c>Meta</c> (the envelope's
/// applies), classified <see cref="DelayRole.TrueNow"/>: a ground-side
/// game-state fact, not comms-delayed vessel telemetry.</para>
/// <internal>
/// Produced by <c>Sitrep.Host.SystemViewProvider.BuildRevertAvailability</c>,
/// on the same convention as <c>SystemBodies</c>.
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
    /// <summary>Can the active flight be reverted back to the editor (VAB/SPH)?
    /// Mirrors <c>FlightDriver.CanRevertToPrelaunch</c>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool CanRevertToEditor { get; set; }

    /// <summary>Can the active flight be reverted to its launch (on-the-pad)
    /// state? Mirrors <c>FlightDriver.CanRevertToPostInit</c>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool CanRevertToLaunch { get; set; }
}
