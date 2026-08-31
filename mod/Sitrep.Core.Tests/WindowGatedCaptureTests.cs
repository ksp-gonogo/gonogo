// No channel may be fed from the game's UI.
//
// WHY THIS EXISTS. A channel in this repo once read its fields off a producer
// mod's own planner window, through Harmony postfixes on that window's render
// methods. Those fields refresh only while the window renders, so the channel
// answered only when the player happened to have that panel open. The operator's
// ruling:
//
//   ANY time you're making a claim that some value is only available when a
//   window is open in the game should be an IMMEDIATE red flag. It's not
//   acceptable. We CANNOT support it.
//
// It was removed on 2026-08-31 and every value it carried now comes off that
// producer's own interop query, which needs no window and turned out to be
// strictly richer.
//
// WHY THIS GATE IS STRUCTURAL AND NOT A NAME MATCH, which is the whole design.
// The obvious gate, flagging captures that reach a type called *Window, *GUI or
// *Panel, is wrong in BOTH directions, and the tree held a live example of each:
//
//   FALSE POSITIVE. One Uplink reads an aerodynamics mod's type whose name ends
//   in GUI. That is correct code: the type is a VesselModule and the field is
//   assigned unconditionally in its FixedUpdate, so the value is current every
//   physics tick whether or not that mod's display is up. A name gate flags it,
//   and the reasoning that clears it is already written down where it is read.
//
//   FALSE NEGATIVE. The type this gate exists because of was called after the
//   activity it hosts, with no window, GUI or panel in the name at all. A name
//   gate misses it completely.
//
// The real discriminator is whether the value is REFRESHED INDEPENDENTLY OF
// RENDERING, and that is not statically decidable. So this gate keys on the
// STRUCTURE that made it possible instead: a Harmony patch on a rendering method
// is how a capture gets hold of a value that only exists during a repaint. Take
// that away and the failure mode is unreachable, whatever the types are called.
//
// NAMING NOTE. The examples above are deliberately unnamed. This file lives
// outside every Uplink, and the boundary ratchet forbids naming a producer mod
// from here; an earlier draft named both and failed that gate, which is the rule
// working.
//
// SEEDED AT ZERO, deliberately, and there is no debt list. The tree measured
// exactly one instance and it is gone; a bucket here would only be somewhere to
// put the next one.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    public class WindowGatedCaptureTests
    {
        /// <summary>
        /// How a patch names its target. BOTH forms, and the second is the one
        /// that matters: the real offender used no attribute at all. It resolved
        /// the method by name through <c>AccessTools.Method</c> and patched it
        /// imperatively with <c>harmony.Patch(target, postfix: ...)</c>, which an
        /// attribute-only matcher walks straight past.
        ///
        /// <para>That was not a hypothetical. The first version of this gate
        /// matched attributes only, passed its own planted string, and then PASSED
        /// with the real deleted file restored to the tree. A synthetic plant
        /// tests the regex against itself.</para>
        /// </summary>
        private static readonly Regex HarmonyPatch = new Regex(
            @"\[Harmony(Patch|Prefix|Postfix|Transpiler|Finalizer)|AccessTools\.Method\s*\(|\.Patch\s*\(",
            RegexOptions.Compiled);

        /// <summary>
        /// The methods a UI type repaints from. Unity's own (<c>OnGUI</c>), KSP's
        /// dialog draw entry points, and the render/draw family a mod's own
        /// window class exposes.
        /// </summary>
        private static readonly Regex RenderMethod = new Regex(
            @"\b(OnGUI|Render\w*|DrawWindow\w*|WindowContents|DrawGUI|OnDraw\w*|LateUpdateGUI)\b",
            RegexOptions.Compiled);

        /// <summary>
        /// No Uplink patches a rendering method.
        ///
        /// <para>An Uplink's job is to read the game's MODEL and publish it. A
        /// patch on a draw method reads the game's VIEW, and a view exists only
        /// while it is on screen. There is no correct use of one for a capture,
        /// which is why this has no exemption list: if a value is genuinely
        /// unreachable except during a repaint, the honest answer is that we
        /// cannot publish it, not that we publish it sometimes.</para>
        /// </summary>
        [Fact]
        public void NoUplinkPatchesARenderingMethod()
        {
            var offenders = new List<string>();

            foreach (var (name, directory) in DiscoverUplinkDirectories())
            {
                foreach (var file in Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories))
                {
                    if (file.Contains("/obj/", StringComparison.Ordinal) ||
                        file.Contains("/bin/", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var lines = File.ReadAllLines(file);
                    for (var i = 0; i < lines.Length; i++)
                    {
                        if (!HarmonyPatch.IsMatch(lines[i]))
                        {
                            continue;
                        }
                        if (RenderMethod.IsMatch(string.Join("\n", lines.Skip(i).Take(3))))
                        {
                            offenders.Add(
                                $"{name}: {Path.GetFileName(file)}:{i + 1} patches a rendering method");
                        }
                    }
                }
            }

            Assert.True(
                offenders.Count == 0,
                "An Uplink is patching a method that DRAWS, which is how a capture gets hold of a value "
                + "that only exists while a window is open. A channel fed that way answers only when the "
                + "player has the panel up, which is not something this project can support. Read the "
                + "model rather than the view; if the value is only reachable during a repaint, it is not "
                + "publishable.\n  " + string.Join("\n  ", offenders));
        }

        /// <summary>
        /// The gate can see the thing it forbids, in the form it really took.
        ///
        /// <para>The shape below reproduces the deleted hook verbatim in
        /// structure: a method name held in a const, resolved by
        /// <c>AccessTools.Method</c>, patched imperatively. An earlier version of
        /// this test planted an attribute-decorated method instead, passed, and
        /// the gate STILL passed when the real file was restored to the tree.
        /// A plant that does not match production proves only that the regex
        /// matches the plant.</para>
        /// </summary>
        [Fact]
        public void TheGateWouldSeeTheHookThatCausedThis()
        {
            var planted = new[]
            {
                "private const string RenderWindowContentsMethod = \"RenderWindowContents\";",
                "var windowTarget = AccessTools.Method(plannerType, RenderWindowContentsMethod);",
                "harmony.Patch(windowTarget, postfix: Postfix(nameof(RenderWindowContentsPostfix)));",
            };

            Assert.True(
                Offends(planted),
                "the gate cannot see the very hook it was built to forbid");
        }

        /// <summary>
        /// And does NOT fire on the shape that is legitimate: reading a UI-owned
        /// type whose value is maintained outside rendering, which is the aerodynamics case
        /// described in this file's header.
        /// </summary>
        [Fact]
        public void TheGateIgnoresAPlainReadOfAUiOwnedType()
        {
            var legitimate = new[]
            {
                "private const string GuiTypeName =",
                "    \"SomeAeroMod.Gui.FlightGui\";",
                "_speedGui = _gui?.GetProperty(\"airSpeedGui\");",
            };

            Assert.False(
                Offends(legitimate),
                "the gate fires on a plain read of a UI-owned type, which is the false positive "
                + "a name-keyed gate would produce and this one exists to avoid");
        }

        /// <summary>
        /// The decision, in one place. The scan and both planted cases call THIS,
        /// so a plant can never pass against a rule the scan does not apply.
        /// </summary>
        private static bool Offends(IReadOnlyList<string> lines)
        {
            for (var i = 0; i < lines.Count; i++)
            {
                if (!HarmonyPatch.IsMatch(lines[i]))
                {
                    continue;
                }
                if (RenderMethod.IsMatch(string.Join("\n", lines.Skip(i).Take(3))))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>Every <c>Gonogo*Uplink</c> directory carrying its own csproj.</summary>
        private static IEnumerable<(string Name, string Directory)> DiscoverUplinkDirectories()
        {
            var modDir = ResolveModDir();
            foreach (var directory in Directory.EnumerateDirectories(modDir))
            {
                var name = Path.GetFileName(directory);
                if (!name.StartsWith("Gonogo", StringComparison.Ordinal) ||
                    !name.EndsWith("Uplink", StringComparison.Ordinal))
                {
                    continue;
                }
                if (File.Exists(Path.Combine(directory, name + ".csproj")))
                {
                    yield return (name, directory);
                }
            }
        }

        private static string ResolveModDir()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory != null)
            {
                var candidate = Path.Combine(directory.FullName, "mod");
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }
                directory = directory.Parent;
            }
            throw new InvalidOperationException(
                "Could not locate mod/ walking up from " + AppContext.BaseDirectory);
        }
    }
}
