// GonogoMechJebUplink: GPLv3. See GonogoMechJebUplink.csproj's header comment
// for the licence/linkage rationale.
//
// The KSP/Unity/MechJeb2-touching half of this Uplink. See MechJebUplink.cs's
// class doc comment for the full rationale: this file exists so
// GonogoMechJebUplink.Tests can Compile-Include MechJebUplink.cs's
// MechJeb2-free half without ever needing MechJeb2.dll/UnityEngine.dll
// reference assemblies (which don't exist in a headless/CI build) -- the
// GonogoMechJebUplink.Tests.csproj simply does not list this file. The
// production GonogoMechJebUplink.csproj compiles both halves together as
// usual (SDK-style wildcard globbing), so nothing here changes for a
// live-game build.

using MuMech;
using Sitrep.Contract;
using UnityEngine;

namespace Gonogo.MechJebUplink
{
    /// <summary>
    /// The direct-call bridge to MechJeb2: get the active vessel's master
    /// core, read the module off the core, engage. Every member here is LOCKED
    /// against the installed MechJeb2 2.15.3.0 dll, see
    /// <c>local_docs/design/mechjeb-provider-and-vendoring.md</c> §1a and
    /// <c>local_docs/design/mechjeb-decompile-lock.md</c>:
    ///
    /// <list type="bullet">
    /// <item><c>Vessel.GetMasterMechJeb()</c> (<c>MuMech.VesselExtensions</c>,
    /// static extension) -&gt; <see cref="MechJebCore"/>.</item>
    /// <item>Modules come off <see cref="MechJebCore"/>'s own public members:
    /// <c>Ascent</c>, <c>AscentSettings</c>, <c>Node</c>, <c>Landing</c>,
    /// <c>Target</c>. <c>MechJebCore.LoadComputerModules</c> assigns four of
    /// those from its own module registry at load, so the member is that
    /// registry's answer with no per-command list walk, and <c>Ascent</c> is
    /// something the registry cannot answer at all (below).</item>
    /// <item>Ascent engage: write
    /// <c>MechJebModuleAscentSettings.DesiredOrbitAltitude.Val</c> (metres; the
    /// arg DTO carries kilometres, see <see cref="MechJebAscentArgs"/>), then
    /// <c>MechJebModuleAscentBaseAutopilot.Users.Add(controller)</c> --
    /// <c>Users</c> is the public <c>UserPool</c> every <c>ComputerModule</c>
    /// carries, NOT a bare <c>enabled = true</c>. <c>UserPool.Add</c> sets
    /// <c>Enabled = true</c> on the module it controls, which is what makes the
    /// pool the engage handshake rather than a bookkeeping list.</item>
    /// <item>Node executor: <c>MechJebModuleNodeExecutor.ExecuteOneNode(controller)</c>.</item>
    /// <item>Landing: <c>MechJebModuleTargetController.PositionTargetExists</c>
    /// gates <c>MechJebModuleLandingAutopilot.LandAtPositionTarget(controller)</c>:
    /// <c>public bool PositionTargetExists =&gt; Target != null &amp;&amp;
    /// (Target is PositionTarget || Target is Vessel) &amp;&amp; !(Target is DirectionTarget)</c>.</item>
    /// </list>
    ///
    /// <para><b>The ascent autopilot is the one the operator selected, and
    /// there is exactly one member that says so.</b> <c>MechJebCore.Ascent</c>
    /// is <c>AscentSettings.AscentAutopilot</c>, which is
    /// <c>GetAscentModule(AscentType)</c>: a switch on the ascent path the
    /// operator picked in MechJeb's own GUI (PVG or Classic). MechJeb's module
    /// registry cannot answer this, because it resolves an abstract type to the
    /// first entry of a list it names unordered, and the ascent autopilots that
    /// were not selected are ones <c>MechJebModuleAscentSettings</c> actively
    /// disables on every ascent-type change. So the registry route flies a
    /// profile the operator did not choose and does it silently.
    /// <c>MechJebAscentModuleSelectionTests</c> holds this.</para>
    ///
    /// <para><b>The controller token</b> (the sketch's "a plain object the
    /// uplink owns, one stable instance"): this class instance itself is that
    /// token, passed as the <c>object controller</c> argument every one of
    /// these calls takes, so a future stop command could symmetrically
    /// <c>Users.Remove</c>/<c>Abort</c>/<c>StopLanding</c> against the exact
    /// same identity that engaged.</para>
    ///
    /// <para><b>Unverified against live KSP</b> (see <c>MechJebUplink.cs</c>'s
    /// class doc comment): this file compiles against the linked MechJeb2
    /// assembly but the <c>Users.Add</c> handshake and the settings write have
    /// not been exercised in a real flight scene.</para>
    ///
    /// <para><b>These three still ask KSP which vessel, and every other Uplink
    /// has stopped.</b> Core reports the craft an EVA kerbal stepped out of, and
    /// twenty reads across nine Uplinks moved onto that answer through the
    /// <c>activeVessel</c> capability. These did not. The hold is deliberate
    /// rather than an oversight, so core's cross-Uplink scan carries them as its
    /// only debt entry and points here.</para>
    ///
    /// <para><b>The code says routing would work.</b> Read against the shipped
    /// 2.15.3.0: <see cref="MechJebCore"/> is a <c>PartModule</c> on the SHIP, so
    /// an EVA never changes the vessel it is attached to and its
    /// <c>OnFlyByWire</c> hook stays there; its <c>FixedUpdate</c> returns early
    /// only when it is not that vessel's master core, and the
    /// <c>isActiveVessel</c> test beside it clears a settings-reload flag rather
    /// than the drive; <c>OnFlyByWire</c> to <c>Drive</c> is gated on the master
    /// check and nothing else; and none of
    /// <see cref="MechJebModuleNodeExecutor"/>,
    /// <see cref="MechJebModuleAscentBaseAutopilot"/>,
    /// <see cref="MechJebModuleLandingAutopilot"/> or the attitude controller
    /// beneath them names <c>isActiveVessel</c> or
    /// <c>FlightGlobals.ActiveVessel</c> at all.</para>
    ///
    /// <para><b>What holds them is that the risk is one-way.</b> An EVA kerbal
    /// carries no MechJeb core, so <c>GetMasterMechJeb()</c> is null and all
    /// three refuse with <see cref="CommandErrorCode.NoVessel"/>. Nothing is
    /// lying today, so routing cannot remove a lie, only introduce one. And what
    /// the assembly cannot settle is whether the autopilot's OUTPUT lands:
    /// <c>Drive</c> writes a <c>FlightCtrlState</c>, and
    /// <c>Vessel.FeedInputFeed</c> hands that to the parts only when
    /// <c>loaded &amp;&amp; !packed &amp;&amp; !physicsHoldLock &amp;&amp;
    /// isControllable</c>. The commonest EVA is the last crew member stepping
    /// out, which is exactly how a craft becomes uncontrollable. Separately
    /// <c>StageManager.ActivateStage</c> is active-vessel-only, so a routed
    /// ascent would hold attitude and never stage.</para>
    ///
    /// <para><b>What a rig has to show</b>, one flight and three observations.
    /// (1) Kerbal outside with a probe core still aboard: route the node executor
    /// at the reported craft and watch whether it turns and lights its engines.
    /// (2) Repeat with no probe core and confirm it does nothing, which makes
    /// core's uncontrollable-craft refusal part of any routed command here.
    /// (3) Engage the ascent autopilot and watch whether it STAGES; if it does
    /// not, that command needs a documented partial rather than a plain success.
    /// (1) and (3) answered make routing honest.</para>
    /// </summary>
    internal sealed class MechJebController
    {
        /// <summary>
        /// See <see cref="MechJebModuleAscentSettings.DesiredOrbitAltitude"/> /
        /// <see cref="EditableDoubleMult"/>: the settings module stores the
        /// target altitude in METRES; the arg DTO carries kilometres (matching
        /// the pre-existing widget's own <c>altitudeKm</c> input).
        /// </summary>
        private const double MetresPerKilometre = 1000.0;

        public CommandResult EngageAscent(MechJebAscentArgs args)
        {
            var vessel = FlightGlobals.ActiveVessel;
            var core = vessel == null ? null : vessel.GetMasterMechJeb();
            if (core == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            var settings = core.AscentSettings;
            var ascent = core.Ascent;
            if (settings == null || ascent == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            settings.DesiredOrbitAltitude.Val = args.TargetAltitudeKm * MetresPerKilometre;
            ascent.Users.Add(this);
            return CommandResult.Ok();
        }

        public CommandResult ExecuteNextNode(MechJebNoArgs args)
        {
            _ = args;
            var vessel = FlightGlobals.ActiveVessel;
            var core = vessel == null ? null : vessel.GetMasterMechJeb();
            if (core == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            var nodeExecutor = core.Node;
            if (nodeExecutor == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            nodeExecutor.ExecuteOneNode(this);
            return CommandResult.Ok();
        }

        public CommandResult LandAtTarget(MechJebNoArgs args)
        {
            _ = args;
            var vessel = FlightGlobals.ActiveVessel;
            var core = vessel == null ? null : vessel.GetMasterMechJeb();
            if (core == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            var target = core.Target;
            if (target == null || !target.PositionTargetExists)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var landing = core.Landing;
            if (landing == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            landing.LandAtPositionTarget(this);
            return CommandResult.Ok();
        }
    }
}
