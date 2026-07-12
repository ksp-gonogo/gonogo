#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>ksp.revertAvailability</c> Topic payload — whether the two stock
/// in-flight "revert" actions are currently available, so a widget
/// (LaunchDirector) can gate its Revert-to-Launch / Revert-to-Editor
/// controls exactly like KSP's own pause menu does. Produced by
/// <c>Sitrep.Host.SystemViewProvider.BuildRevertAvailability</c> from the
/// two static <c>FlightDriver</c> bools KSP reads when it draws those very
/// buttons.
///
/// <para>The whole payload is <c>null</c> (no key emitted) outside the
/// flight scene — the two flags are only meaningful in flight, and the
/// backing <c>FlightDriver</c> statics carry stale values from the previous
/// flight otherwise. When present, both bools are concrete (never null): a
/// <c>false</c> means "this revert is genuinely not available right now,"
/// which is exactly what the gate needs.</para>
///
/// <para><b>Mapping (verified against KSP's <c>PauseMenu.drawStockRevertOptions</c>
/// at build time):</b> the pause menu shows the "Revert to Launch" button
/// (which calls <c>FlightDriver.RevertToLaunch()</c>, restoring the
/// <c>PostInitState</c>) when <c>FlightDriver.CanRevertToPostInit</c> is set,
/// and the "Revert to VAB/SPH" buttons (which call
/// <c>FlightDriver.RevertToPrelaunch(...)</c>, returning to the editor) when
/// <c>FlightDriver.CanRevertToPrelaunch</c> is set. So
/// <see cref="CanRevertToLaunch"/> maps to <c>CanRevertToPostInit</c> and
/// <see cref="CanRevertToEditor"/> maps to <c>CanRevertToPrelaunch</c> — the
/// KSP field names read backwards to their button labels, so the mapping is
/// deliberately the inverse of a naive name-match.</para>
///
/// <para>Same <c>system</c>-uplink convention as <c>SystemBodies</c>: a
/// scene-side fact carried on its own Topic with no per-payload <c>Meta</c>
/// (it rides the envelope), classified <c>DelayRole.TrueNow</c> — a
/// ground-side game-state fact, not comms-derived vessel telemetry.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("ksp.revertAvailability")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class RevertAvailability
{
    /// <summary>Can the active flight be reverted back to the editor (VAB/SPH)? Mirrors <c>FlightDriver.CanRevertToPrelaunch</c>.</summary>
    public bool CanRevertToEditor { get; set; }

    /// <summary>Can the active flight be reverted to its launch (on-the-pad) state? Mirrors <c>FlightDriver.CanRevertToPostInit</c>.</summary>
    public bool CanRevertToLaunch { get; set; }
}
