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
    /// core, fetch the relevant computer module, engage. Every member here
    /// is LOCKED against the installed MechJeb2 2.15.3.0 dll, see
    /// <c>local_docs/design/mechjeb-decompile-lock.md</c>:
    ///
    /// <list type="bullet">
    /// <item><c>Vessel.GetMasterMechJeb()</c> (<c>MuMech.VesselExtensions</c>,
    /// static extension) -&gt; <see cref="MechJebCore"/>.</item>
    /// <item><c>MechJebCore.GetComputerModule&lt;T&gt;()</c> to fetch a module;
    /// <c>MechJebCore.Target</c> (public field) for the target controller.</item>
    /// <item>Ascent engage: write <c>MechJebModuleAscentSettings.DesiredOrbitAltitude.Val</c>
    /// (metres; the arg DTO carries kilometres, see
    /// <see cref="MechJebAscentArgs"/>), then
    /// <c>MechJebModuleAscentBaseAutopilot.Users.Add(controller)</c> --
    /// <c>Users</c> is the public <c>UserPool</c> every <c>ComputerModule</c>
    /// carries, NOT a bare <c>enabled = true</c>.</item>
    /// <item>Node executor: <c>MechJebModuleNodeExecutor.ExecuteOneNode(controller)</c>.</item>
    /// <item>Landing: <c>MechJebModuleTargetController.PositionTargetExists</c>
    /// gates <c>MechJebModuleLandingAutopilot.LandAtPositionTarget(controller)</c>
    /// -- this ONE member was flagged unresolved by the decompile-lock ("exact
    /// target-exists member to lock when writing the handler") and has been
    /// locked here by decompiling <c>MechJebModuleTargetController</c> directly:
    /// <c>public bool PositionTargetExists =&gt; Target != null &amp;&amp;
    /// (Target is PositionTarget || Target is Vessel) &amp;&amp; !(Target is DirectionTarget)</c>.</item>
    /// </list>
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

            var settings = core.GetComputerModule<MechJebModuleAscentSettings>();
            var ascent = core.GetComputerModule<MechJebModuleAscentBaseAutopilot>();
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

            var nodeExecutor = core.GetComputerModule<MechJebModuleNodeExecutor>();
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

            var landing = core.GetComputerModule<MechJebModuleLandingAutopilot>();
            if (landing == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            landing.LandAtPositionTarget(this);
            return CommandResult.Ok();
        }
    }
}
