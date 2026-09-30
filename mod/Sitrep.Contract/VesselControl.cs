#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The SAS autopilot's hold mode, KSP's <c>VesselAutopilot.AutopilotMode</c>
/// with the same member names. The directional modes follow the navball's
/// current speed mode (orbit, surface or target). <see cref="Unknown"/> stands
/// for a value this contract does not recognise.
/// </summary>
/// <category>Vessel</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum SasMode
{
    /// <summary>Holds the vessel's current attitude.</summary>
    StabilityAssist,

    /// <summary>Points along the velocity vector.</summary>
    Prograde,

    /// <summary>Points against the velocity vector.</summary>
    Retrograde,

    /// <summary>Points along the orbit normal.</summary>
    Normal,

    /// <summary>Points against the orbit normal.</summary>
    Antinormal,

    /// <summary>Points towards the body being orbited.</summary>
    RadialIn,

    /// <summary>Points away from the body being orbited.</summary>
    RadialOut,

    /// <summary>Points towards the current target.</summary>
    Target,

    /// <summary>Points away from the current target.</summary>
    AntiTarget,

    /// <summary>Points along the burn vector of the next maneuver node.</summary>
    Maneuver,

    /// <summary>A mode this contract does not recognise.</summary>
    Unknown,
}

/// <summary>
/// One custom action group: its number, its display name and its live state.
/// Stock KSP has ten anonymous custom groups; Action Groups Extended (AGX)
/// gives the player up to 250 groups they name themselves ("Solar Panels",
/// "Science Bay"), so identify a group by <see cref="Index"/> and label it with
/// <see cref="Name"/>, never by its position in a list.
///
/// <para>Custom groups only. The stock singletons (SAS, RCS, Gear, Brakes,
/// Lights, Abort) have their own <see cref="VesselControl"/> fields and their
/// own commands (<c>vessel.control.setGear</c> and so on).</para>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ActionGroupState
{
    /// <summary>
    /// 1-based group number: the same number
    /// <c>vessel.control.setActionGroup</c> takes. Stock KSP: 1..10
    /// (<c>KSPActionGroup.Custom01..Custom10</c>). An AGX backend may report
    /// indices up to 250. Do not assume 10 groups, nor that the indices are
    /// dense or sorted.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int Index { get; set; }

    /// <summary>
    /// Human display name. Stock KSP has no per-group naming, so stock groups
    /// are named <c>"AG1".."AG10"</c>. With AGX installed, the player's own
    /// names.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>
    /// Whether the group is currently engaged. <c>null</c> means the backend
    /// knows this group exists (it has an index and a name) but could not read
    /// whether it is engaged: it does NOT mean the group is disengaged. Treating
    /// null as off draws an OFF toggle for a group whose state nobody knows, and
    /// toggling from that reading commands the wrong way.
    /// <internal>
    /// Three-valued because a backend can fail per-group. AGX reads each
    /// group's state through reflection into its own scenario module, so one
    /// group can fail while the rest read fine; the whole-tick null on
    /// <see cref="VesselControl.ActionGroups"/> cannot express that, and a
    /// plain bool forced the failure to publish as <c>false</c>. Stock has no
    /// such failure mode and keeps publishing a real bool: see
    /// Gonogo.KSP.StockActionGroupsBackend.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? State { get; set; }
}

/// <summary>
/// The <c>vessel.control</c> channel payload: the active vessel's control
/// state (the stock toggles, SAS mode, throttle, the commanded fly-by-wire
/// axes and the custom action groups). The payload is present whenever there
/// is an active vessel; each field is individually nullable, and <c>null</c>
/// means that input could not be read this tick (for example no flight input
/// state, or no action-group data), never a default.
///
/// <para>Each control field that can be changed is paired with its command
/// through its control channel, so the confirmed state and the command that
/// changes it are one handle. The confirmed value lags a command by the round
/// trip, including any comms delay.</para>
///
/// <para><see cref="Throttle"/> is 0..1 nominally, but KSP does not clamp
/// <c>Vessel.ctrlState.mainThrottle</c>: a throttle driven by kOS or
/// another mod can read above 1. The value is passed through unclamped.</para>
/// <internal>
/// Filled by KspHost.BuildControl, which always returns a group while a vessel
/// exists.
/// </internal>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.control")]
public class VesselControl
{
    /// <summary>Whether SAS is on. Changed with <c>vessel.control.setSas</c>.</summary>
    [SitrepControlChannel("vessel.control.sas", "vessel.control.setSas", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Sas { get; set; }

    /// <summary>The SAS hold mode. Changed with <c>vessel.control.setSasMode</c>.</summary>
    [SitrepControlChannel("vessel.control.sasMode", "vessel.control.setSasMode", typeof(SetSasModeArgs), nameof(SetSasModeArgs.Mode))]
    [SitrepUnit(Units.Enumeration)]
    public SasMode? SasMode { get; set; }

    /// <summary>Whether RCS is on. Changed with <c>vessel.control.setRcs</c>.</summary>
    [SitrepControlChannel("vessel.control.rcs", "vessel.control.setRcs", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Rcs { get; set; }

    /// <summary>Whether the Gear action group is engaged (landing gear deployed). Changed with <c>vessel.control.setGear</c>.</summary>
    [SitrepControlChannel("vessel.control.gear", "vessel.control.setGear", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Gear { get; set; }

    /// <summary>Whether the Brakes action group is engaged. Changed with <c>vessel.control.setBrakes</c>.</summary>
    [SitrepControlChannel("vessel.control.brakes", "vessel.control.setBrakes", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Brakes { get; set; }

    /// <summary>Whether the Lights action group is engaged. Changed with <c>vessel.control.setLights</c>.</summary>
    [SitrepControlChannel("vessel.control.lights", "vessel.control.setLights", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Lights { get; set; }

    /// <summary>Whether the Abort action group is engaged. Changed with <c>vessel.control.setAbort</c>.</summary>
    [SitrepControlChannel("vessel.control.abort", "vessel.control.setAbort", typeof(SetEnabledArgs), nameof(SetEnabledArgs.Enabled))]
    [SitrepUnit(Units.Flag)]
    public bool? Abort { get; set; }

    /// <summary>
    /// Precision-control (fine-control / caps-lock) mode. Mirrors KSP's
    /// <c>FlightInputHandler.fetch.precisionMode</c>. Null when there is no
    /// active flight scene.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? PrecisionControl { get; set; }

    /// <summary>Main throttle, KSP's <c>Vessel.ctrlState.mainThrottle</c>: 0..1 nominally, but not clamped, so a mod-driven throttle can read above 1. Changed with <c>vessel.control.setThrottle</c>.</summary>
    [SitrepControlChannel("vessel.control.throttle", "vessel.control.setThrottle", typeof(SetThrottleArgs), nameof(SetThrottleArgs.Value))]
    [SitrepUnit(Units.Ratio)]
    public double? Throttle { get; set; }

    /// <summary>The applied pitch axis input, -1..1, from KSP's <c>Vessel.ctrlState.pitch</c>. Null when the vessel has no control state. Set with <c>vessel.control.setAxes</c>.</summary>
    [SitrepControlChannel("vessel.control.pitch", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.Pitch))]
    [SitrepUnit(Units.Dimensionless)]
    public double? Pitch { get; set; }

    /// <summary>The applied yaw axis input, -1..1, from KSP's <c>Vessel.ctrlState.yaw</c>. Null when the vessel has no control state. Set with <c>vessel.control.setAxes</c>.</summary>
    [SitrepControlChannel("vessel.control.yaw", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.Yaw))]
    [SitrepUnit(Units.Dimensionless)]
    public double? Yaw { get; set; }

    /// <summary>The applied roll axis input, -1..1, from KSP's <c>Vessel.ctrlState.roll</c>. Null when the vessel has no control state. Set with <c>vessel.control.setAxes</c>.</summary>
    [SitrepControlChannel("vessel.control.roll", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.Roll))]
    [SitrepUnit(Units.Dimensionless)]
    public double? Roll { get; set; }

    /// <summary>The applied translation X input (RCS right/left), -1..1, from KSP's <c>Vessel.ctrlState.X</c>. Null when the vessel has no control state. Set with <c>vessel.control.setAxes</c>.</summary>
    [SitrepControlChannel("vessel.control.translationX", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.X))]
    [SitrepUnit(Units.Dimensionless)]
    public double? TranslationX { get; set; }

    /// <summary>The applied translation Y input (RCS up/down), -1..1, from KSP's <c>Vessel.ctrlState.Y</c>. Null when the vessel has no control state. Set with <c>vessel.control.setAxes</c>.</summary>
    [SitrepControlChannel("vessel.control.translationY", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.Y))]
    [SitrepUnit(Units.Dimensionless)]
    public double? TranslationY { get; set; }

    /// <summary>The applied translation Z input (RCS forward/back), -1..1, from KSP's <c>Vessel.ctrlState.Z</c>. Null when the vessel has no control state. Set with <c>vessel.control.setAxes</c>.</summary>
    [SitrepControlChannel("vessel.control.translationZ", "vessel.control.setAxes", typeof(SetControlAxesArgs), nameof(SetControlAxesArgs.Z))]
    [SitrepUnit(Units.Dimensionless)]
    public double? TranslationZ { get; set; }

    /// <summary>
    /// Every custom action group the vessel has,
    /// each NAMED and carrying its own index (see
    /// <see cref="ActionGroupState"/>). Stock KSP yields ten entries
    /// (<c>AG1..AG10</c>); an AGX backend may yield up to 250 with the
    /// player's own names. Null when action-group data wasn't available this
    /// tick; never a partial list. Order is by <see cref="ActionGroupState.Index"/>
    /// ascending, but read <see cref="ActionGroupState.Index"/> rather than
    /// relying on array position: position does not carry identity here.
    /// </summary>
    public ActionGroupState[]? ActionGroups { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}
