using System;
using System.IO;
using Gonogo.MechJebUplink;
using Xunit;

namespace GonogoMechJebUplink.Tests
{
    /// <summary>
    /// The ascent engage has to reach the autopilot the operator SELECTED, and
    /// there are two ways to ask MechJeb for one that differ in which module
    /// comes back.
    ///
    /// <para><c>MechJebCore.GetComputerModule&lt;T&gt;()</c> returns the first
    /// entry of <c>_unorderedComputerModules</c> that <c>is T</c> (verified in
    /// the installed 2.15.3.0 dll). Asked for the abstract
    /// <c>MechJebModuleAscentBaseAutopilot</c> it therefore answers with
    /// whichever of the concrete ascent autopilots happens to sit earliest in a
    /// list MechJeb itself calls unordered, which has nothing to do with the
    /// ascent path the operator picked. Worse, <c>MechJebModuleAscentSettings</c>
    /// calls <c>DisableAscentModules()</c> on every ascent-type change, so the
    /// modules that are not selected are ones MechJeb is deliberately holding
    /// disabled: engaging one is engaging a module against its own mod's
    /// intent.</para>
    ///
    /// <para><c>MechJebCore.Ascent</c> is
    /// <c>AscentSettings.AscentAutopilot</c>, which is
    /// <c>GetAscentModule(AscentType)</c>, a switch on the selected type. That
    /// is the operator's ascent path, and it is the only correct answer to
    /// "engage the ascent autopilot".</para>
    ///
    /// <para><b>Why this is asserted over source text.</b>
    /// <c>MechJebController.cs</c> binds MuMech and UnityEngine types, so the
    /// headless test project cannot compile it (see
    /// <c>GonogoMechJebUplink.Tests.csproj</c>'s Compile list and its
    /// reasoning). The choice between the two lookups is not observable from
    /// anything this project CAN link, and it is a choice that silently flies
    /// the wrong ascent profile rather than failing, so the guard is over the
    /// text. Another Uplink's guard suite already reads its own KSP-linked
    /// source this way, for the same reason: text is the only assertion left
    /// when the sources a claim lives in cannot be compiled here.</para>
    /// </summary>
    public class MechJebAscentModuleSelectionTests
    {
        [Fact]
        public void AscentEngageResolvesTheSelectedAscentPathNotAnUnorderedFirstMatch()
        {
            var source = File.ReadAllText(ControllerSourcePath());

            Assert.DoesNotContain("GetComputerModule<MechJebModuleAscentBaseAutopilot>", source);
            Assert.Contains("core.Ascent", source);
        }

        /// <summary>
        /// The three concrete-module lookups have exactly one right answer too,
        /// and it is the cached public field rather than a scan.
        /// <c>MechJebCore.LoadComputerModules</c> assigns <c>Node</c>,
        /// <c>Landing</c>, <c>Target</c> and <c>AscentSettings</c> from the very
        /// same <c>GetComputerModule&lt;T&gt;()</c> calls, so the field is the
        /// identical instance with none of the per-command list walk, and one
        /// form throughout is what stops the ascent case above being
        /// reintroduced by symmetry with a neighbour.
        /// </summary>
        [Fact]
        public void ModuleLookupsGoThroughTheCachedCoreMembers()
        {
            var source = File.ReadAllText(ControllerSourcePath());

            Assert.DoesNotContain("GetComputerModule", source);
            Assert.Contains("core.Node", source);
            Assert.Contains("core.Landing", source);
            Assert.Contains("core.Target", source);
            Assert.Contains("core.AscentSettings", source);
        }

        /// <summary>
        /// The version guard has to probe what the controller BINDS, or a
        /// MechJeb release that renames one of these degrades to a null
        /// dereference at engage time instead of the Uplink going honestly
        /// inert. <c>Ascent</c> is the one that matters most: it is a property
        /// over a switch, so it is the member most likely to move.
        /// </summary>
        [Fact]
        public void GuardProbesTheCoreMembersTheControllerBinds()
        {
            var result = MechJebVersionGuard.ProbeTypes(new[]
            {
                typeof(Fakes.CoreMissingAscent.VesselExtensions),
                typeof(Fakes.CoreMissingAscent.ComputerModule),
                typeof(Fakes.CoreMissingAscent.MechJebCore),
                typeof(Fakes.CoreMissingAscent.MechJebModuleTargetController),
                typeof(Fakes.CoreMissingAscent.MechJebModuleAscentSettings),
                typeof(Fakes.CoreMissingAscent.EditableDoubleMult),
                typeof(Fakes.CoreMissingAscent.MechJebModuleAscentBaseAutopilot),
                typeof(Fakes.CoreMissingAscent.UserPool),
                typeof(Fakes.CoreMissingAscent.MechJebModuleNodeExecutor),
                typeof(Fakes.CoreMissingAscent.MechJebModuleLandingAutopilot),
            });

            Assert.False(result.IsAvailable);
            Assert.Contains("MechJebCore.Ascent", result.Reason);
        }

        private static string ControllerSourcePath()
        {
            var dir = AppContext.BaseDirectory;
            while (dir != null && !Directory.Exists(Path.Combine(dir, "mod", "GonogoMechJebUplink")))
            {
                dir = Directory.GetParent(dir)?.FullName;
            }
            Assert.NotNull(dir);
            return Path.Combine(dir!, "mod", "GonogoMechJebUplink", "MechJebController.cs");
        }
    }
}
