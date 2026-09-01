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
// WHY THE FIRST AXIS IS STRUCTURAL AND NOT A NAME MATCH, which is the whole
// design. The obvious gate, flagging captures that reach a type called *Window,
// *GUI or *Panel, is wrong in BOTH directions, and the tree held a live example
// of each:
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
// Measured again on 2026-09-01, across every project this file now walks: the
// identifier `Window` appears on 84 code lines and almost none of them are UI.
// They are time windows (a rolling PerfBudget window, an attribution window, a
// visibility sweep window) and one mention of the Windows operating system. A
// name gate would open with two dozen false entries, and a list that is mostly
// noise is one nobody reads.
//
// The real discriminator is whether the value is REFRESHED INDEPENDENTLY OF
// RENDERING, and that is not statically decidable. So the first axis keys on the
// STRUCTURE that made it possible instead: a Harmony patch on a rendering method
// is how a capture gets hold of a value that only exists during a repaint. Take
// that away and the failure mode is unreachable, whatever the types are called.
//
// WHY THERE IS A SECOND AXIS. The first one forbids a mechanism, and it is the
// dangerous mechanism, but it is not the only way a capture can end up reading
// the view. A capture can also be handed a live UI object by the game and read
// state off it, with no patch anywhere, and the tree does exactly that in one
// place. The first axis cannot see that shape at all.
//
// So the second axis asks a different and statically answerable question: does
// this capture reach into the game's UI layer, as the GAME ITSELF classifies it,
// by namespace? That is precise where a name match is not. `KSP.UI` is the
// engine's own statement that a type is user interface, it needs no vocabulary
// of ours to maintain, and it produced zero false matches on the current tree
// against 84 for the name match. Every reach is then either removed or carries a
// written reason, and the reason has to say why the value is not gated on a
// panel being open.
//
// WHAT THE SECOND AXIS DELIBERATELY DOES NOT COVER: a producer mod's UI type
// reached by a reflection string. There is no namespace to key on (the string is
// just a string) and no way to tell a producer's window from its model without
// knowing that mod. That case is what the first axis is for, and between them
// the mechanism is closed: to read a producer's window you must either patch its
// render, which axis one forbids, or hold an instance the producer handed you,
// which is the thing the deleted hook needed a patch to get.
//
// NAMING NOTE. The producer examples above are deliberately unnamed. This file
// lives outside every Uplink, and the boundary ratchet forbids naming a producer
// mod from here; an earlier draft named both and failed that gate, which is the
// rule working. Stock KSP types are not producer mods and are named freely.
//
// AXIS ONE IS SEEDED AT ZERO and has no exemption list. The tree measured
// exactly one instance and it is gone; a bucket there would only be somewhere to
// put the next one. Axis two is seeded from measurement and does have one,
// because unlike patching a render there are correct reasons to name a UI type
// and the list is where each of them is written down.
//
// THE SCAN IS NOT BLIND. Five deliberate violations were planted on 2026-09-01,
// each run against the real tree, each reverted after. A gate that cannot be
// shown to fail reports zero, and zero reads as success:
//
//   Control, unmodified                        8 passed
//   Exemption key mistyped                     NoCaptureReachesAGameUiNamespace...
//                                              named the real file both ways:
//                                              "Gonogo.KSP/RecoveryUplink.cs
//                                              reaches" and "...TYPO.cs no longer
//                                              reaches"
//   RenderMethod widened to match `Method`,    NoCaptureProjectPatchesARendering...
//   so real Harmony call sites qualify         named two files in two different
//                                              Uplinks, with line numbers
//   MinimumCaptureProjectCount set to 999      ScanFindsEveryCaptureProject:
//                                              "found 31 project(s), expected at
//                                              least 999"
//   An entry added with an empty reason        EveryUiReachExemptionStatesItsReason
//   Restored                                   8 passed
//
// The middle three are the ones worth having: they fail through the REAL walk
// over the REAL tree and name real paths, which is the half the in-file plants
// below cannot demonstrate. The clean run at each end is as much of the proof as
// the red ones, because a gate that fails at everything says nothing about its
// subject.
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
        /// The namespaces that ARE the game's user interface, by the engine's own
        /// classification rather than ours. A type under one of these exists to be
        /// looked at, so a capture reading state off it is reading the view.
        ///
        /// <para><c>KSP.UI</c> covers every stock screen, dialog and scene
        /// controller; <c>UnityEngine.UI</c> and <c>TMPro</c> are the widget and
        /// text layers those screens are built from. Matching the namespace rather
        /// than the type name is what keeps this precise: it needs no list of type
        /// names kept up to date, and a UI type nobody here has heard of is caught
        /// on the day it is first used.</para>
        /// </summary>
        private static readonly string[] GameUiNamespaces = { "KSP.UI", "UnityEngine.UI", "TMPro" };

        /// <summary>
        /// Floors on what the walk found, because a directory-walking gate whose
        /// walk returns nothing reports no violations and looks exactly like a
        /// clean repo. Measured 2026-09-01 at 31 projects and 562 files; the
        /// floors sit below that so ordinary movement does not trip them and a
        /// broken path cannot pass as a clean one.
        /// </summary>
        private const int MinimumCaptureProjectCount = 28;

        private const int MinimumScannedFileCount = 500;

        /// <summary>
        /// One file's sanctioned reach into the game's UI layer.
        ///
        /// <para><see cref="Reason"/> is a field rather than a comment on purpose.
        /// An exemption with no reason is not an exemption, and a convention that
        /// reasons get written is one that erodes; making it a required value that
        /// <see cref="EveryUiReachExemptionStatesItsReason"/> checks makes it a
        /// thing the compiler and the suite both insist on.</para>
        /// </summary>
        private sealed class UiReach
        {
            public UiReach(string reason, params string[] namespaces)
            {
                Reason = reason;
                Namespaces = namespaces;
            }

            public string Reason { get; }

            public string[] Namespaces { get; }
        }

        /// <summary>
        /// Every file that may name a game UI namespace, and why it is not a
        /// window-gated capture. Seeded 2026-09-01 from measurement, and
        /// SHRINK-ONLY in both directions: a file that reaches a UI namespace
        /// without an entry fails, and an entry for a reach that no longer happens
        /// fails too, because a list nobody prunes stops describing anything.
        ///
        /// <para>Every entry today is in the KSP-facing project, which is where a
        /// first-party capture meets the game and the only place stock UI types
        /// are in scope at all. No Uplink appears here and none should: an Uplink
        /// that needs the game's UI layer has picked the wrong route.</para>
        ///
        /// <para>Three shapes are represented, and only the first is a real reach.
        /// Most of this list is the namespace being imported for an enum or an
        /// event signature, which is worth pinning precisely because it looks like
        /// a reach and is not: the day one of those files starts reading a dialog,
        /// the entry beside it is visibly false.</para>
        /// </summary>
        private static readonly Dictionary<string, UiReach> GameUiReachExemptions =
            new Dictionary<string, UiReach>(StringComparer.Ordinal)
            {
                ["Gonogo.KSP/RecoveryUplink.cs"] = new UiReach(
                    "Reads the itemised recovery breakdown off the MissionRecoveryDialog instance "
                    + "the game passes to onVesselRecoveryProcessingComplete. Not gated on a panel "
                    + "being open: the recovery flow constructs that dialog and populates its widget "
                    + "lists through its own public AddPartWidget/AddResourceWidget/AddCrewWidget "
                    + "before firing the event, so being called is the evidence the values are there. "
                    + "No interop route exists for the breakdown: the aggregate totals are public on "
                    + "the dialog but the per-item lists are private fields with no API of any kind "
                    + "behind them, which is why this one reads them by reflection and degrades to an "
                    + "empty breakdown rather than throwing. The widest entry in this list and the "
                    + "only genuine reach in it.",
                    "KSP.UI"),

                ["Gonogo.KSP/FlightUplink.cs"] = new UiReach(
                    "The MissionRecoveryDialog appears only in the signature of the "
                    + "onVesselRecoveryProcessingComplete handler, which cannot be written without "
                    + "naming the parameter's type. Nothing is read off it: this handler wants the "
                    + "completion signal alone and takes its facts from the ProtoVessel. No value "
                    + "here comes from the UI, so there is nothing to find an interop route for.",
                    "KSP.UI"),

                ["Gonogo.KSP/CurrencyDelay/StockCurrencyInterceptor.cs"] = new UiReach(
                    "Same shape as the flight handler above: MissionRecoveryDialog is the type of a "
                    + "parameter on the same game event and the body never touches it, taking the "
                    + "vessel id off the ProtoVessel instead.",
                    "KSP.UI"),

                ["Gonogo.KSP/KspHost.cs"] = new UiReach(
                    "Two uses, neither a capture of UI state. EditorLogic.fetch and the EditorFacility "
                    + "enum are how KSP exposes which editor is open and what is in it, and there is "
                    + "no non-UI namespace they live in. Administration.Instance is read as a null "
                    + "check to decide whether a command can run, never for a value: a precondition "
                    + "that a building is open is a fact about the command, not a telemetry reading.",
                    "KSP.UI"),

                ["Gonogo.KSP/KspCareerActuator.cs"] = new UiReach(
                    "Administration.Instance as a command precondition, and this file is the clearest "
                    + "case of the rule being obeyed rather than bent: KSP commits a strategy only "
                    + "from the Administration Building, so the actuator REFUSES with that reason when "
                    + "the building is closed. It publishes nothing that depends on the window. The "
                    + "remaining matches are the SpaceCenterFacility enum, which is not a UI type.",
                    "KSP.UI"),

                ["Gonogo.KSP/KspVesselActuator.cs"] = new UiReach(
                    "StageManager.ActivateNextStage(), a command. StageManager is the staging "
                    + "controller and lives under the UI namespace, but firing the next stage is an "
                    + "action on the vessel and reads nothing back.",
                    "KSP.UI"),

                ["Gonogo.KSP/CraftCatalogueBackend.cs"] = new UiReach(
                    "The EditorFacility enum only, used to pick the VAB or SPH craft folder off disk. "
                    + "An enum member is a constant, so no UI object is touched and nothing here can "
                    + "become stale with a closed window.",
                    "KSP.UI"),
            };

        /// <summary>
        /// The walk found its subjects, checked against a source it does not
        /// control.
        ///
        /// <para>Two floors and a cross-check, because the counts alone would only
        /// catch a walk that broke completely. <c>Gonogo.sln</c> is the
        /// independent list: if the directory walk and the solution disagree about
        /// which projects exist, one of them is wrong and this says so before the
        /// gates below report clean on a set they never assembled.</para>
        /// </summary>
        [Fact]
        public void ScanFindsEveryCaptureProject()
        {
            var modDir = ResolveModDir();
            var projects = DiscoverCaptureProjects(modDir);

            Assert.True(
                projects.Count >= MinimumCaptureProjectCount,
                $"The capture-project scan found {projects.Count} project(s), expected at least "
                + $"{MinimumCaptureProjectCount}. Every gate in this file walks this set, so a walk "
                + "that finds nothing reports no violations and is indistinguishable from a clean "
                + "repo. Either mod/ moved (fix ResolveModDir/DiscoverCaptureProjects) or projects "
                + "were removed (lower the floor deliberately). Found: "
                + string.Join(", ", projects.Keys.OrderBy(k => k, StringComparer.Ordinal)));

            var files = projects.Values.SelectMany(SourceFilesIn).Count();
            Assert.True(
                files >= MinimumScannedFileCount,
                $"The scan walked {files} C# file(s) across {projects.Count} project(s), expected at "
                + $"least {MinimumScannedFileCount}. The project count can look healthy while the "
                + "file walk beneath it returns nothing, which is the same vacuous pass one level "
                + "down, so the files are counted too.");

            var declared = CaptureProjectsDeclaredInSolution(modDir);
            Assert.True(
                declared.Count >= MinimumCaptureProjectCount,
                $"Gonogo.sln declares only {declared.Count} non-test project(s). This is the "
                + "independent source the directory walk is checked against, so if it comes back "
                + "empty the comparison below compares nothing to nothing and passes.");

            var missing = declared.Except(projects.Keys).OrderBy(n => n, StringComparer.Ordinal).ToList();
            Assert.True(
                missing.Count == 0,
                "Gonogo.sln declares projects the directory walk did not find: "
                + string.Join(", ", missing)
                + ". Either the walk is broken or a project was removed from disk but left in the "
                + "solution.");
        }

        /// <summary>
        /// Nothing that ships a capture patches a rendering method.
        ///
        /// <para>A capture's job is to read the game's MODEL and publish it. A
        /// patch on a draw method reads the game's VIEW, and a view exists only
        /// while it is on screen. There is no correct use of one for a capture,
        /// which is why this has no exemption list: if a value is genuinely
        /// unreachable except during a repaint, the honest answer is that we
        /// cannot publish it, not that we publish it sometimes.</para>
        ///
        /// <para>The scan covers every non-test project under <c>mod/</c>, not
        /// just the Uplinks. It was Uplinks-only until 2026-09-01, which left the
        /// KSP-facing project and the host out of scope, and those are where the
        /// first-party captures live. A gate told to skip a directory reports that
        /// directory clean.</para>
        /// </summary>
        [Fact]
        public void NoCaptureProjectPatchesARenderingMethod()
        {
            var offenders = ScanForRenderPatches(ResolveModDir());

            Assert.True(
                offenders.Count == 0,
                "Something that ships a capture is patching a method that DRAWS, which is how a "
                + "capture gets hold of a value that only exists while a window is open. A channel "
                + "fed that way answers only when the player has the panel up, which is not "
                + "something this project can support. Read the model rather than the view; if the "
                + "value is only reachable during a repaint, it is not publishable.\n  "
                + string.Join("\n  ", offenders));
        }

        /// <summary>
        /// No capture reaches the game's UI layer without a written reason.
        ///
        /// <para>Shrink-only in both directions. An unexcused reach fails, and so
        /// does an entry for a reach that has since gone: the second half is what
        /// stops the list drifting into a set of claims about code that no longer
        /// exists.</para>
        /// </summary>
        [Fact]
        public void NoCaptureReachesAGameUiNamespaceOutsideTheExemptionList()
        {
            var found = ScanForGameUiReach(ResolveModDir());
            var failures = new List<string>();

            foreach (var file in found.Keys.OrderBy(f => f, StringComparer.Ordinal))
            {
                if (!GameUiReachExemptions.ContainsKey(file))
                {
                    failures.Add(
                        $"{file} reaches {string.Join(", ", found[file])}, which is the game's own UI "
                        + "layer. If this is a capture, read the model instead: a value held by a "
                        + "screen is a value that can be stale or absent when nobody is looking at "
                        + "it. If it genuinely is not window-gated, add an entry to "
                        + "GameUiReachExemptions saying why, and say what interop route was looked "
                        + "for and not found.");
                }
            }

            foreach (var file in GameUiReachExemptions.Keys.OrderBy(f => f, StringComparer.Ordinal))
            {
                if (!found.ContainsKey(file))
                {
                    failures.Add(
                        $"{file} no longer reaches a game UI namespace, but GameUiReachExemptions "
                        + "still excuses it. Delete that entry: this list is shrink-only.");
                }
            }

            Assert.True(
                failures.Count == 0,
                "Game-UI reach:\n  " + string.Join("\n  ", failures));
        }

        /// <summary>
        /// Every exemption says something. Length is a crude proxy for a reason
        /// and it is not trying to be more than that: it exists so an entry cannot
        /// be added with an empty string or a shrug, which is the way these lists
        /// actually decay.
        /// </summary>
        [Fact]
        public void EveryUiReachExemptionStatesItsReason()
        {
            foreach (var (file, reach) in GameUiReachExemptions.OrderBy(e => e.Key, StringComparer.Ordinal))
            {
                Assert.True(
                    reach.Reason.Trim().Length >= 80,
                    $"The exemption for {file} does not state a reason. An exemption with no reason "
                    + "is not an exemption: say why the value is not gated on a window being open, "
                    + "and what interop route was looked for.");

                Assert.True(
                    reach.Namespaces.Length > 0,
                    $"The exemption for {file} excuses no namespace, so it can never match and will "
                    + "read as stale forever.");
            }
        }

        /// <summary>
        /// The matcher can see the thing it forbids, in the form it really took.
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
        /// The WALK sees a violation, not just the matcher.
        ///
        /// <para>The two plants above prove the regex pair works on strings held
        /// in this file. They say nothing about whether the scan reaches any file
        /// on disk, and a scan that reaches nothing reports zero offenders while
        /// every one of them passes. So this plants a real file in a real project
        /// layout and runs the real <see cref="ScanForRenderPatches"/> over it.
        /// Between this and <see cref="ScanFindsEveryCaptureProject"/> both halves
        /// are covered: that the walk finds the true tree, and that what it finds
        /// is then judged.</para>
        ///
        /// <para>Planted into a temporary tree rather than into <c>mod/</c>
        /// itself, deliberately. Several agents build this repo at once and a
        /// stray <c>.cs</c> file appearing in a real project directory would land
        /// in someone else's compile.</para>
        /// </summary>
        [Fact]
        public void TheScanItselfSeesAPlantedHook()
        {
            var root = CreateTemporaryProjectTree("GonogoPlantedUplink", "PlantedHook.cs", string.Join(
                "\n",
                "namespace GonogoPlantedUplink",
                "{",
                "    public sealed class PlantedHook",
                "    {",
                "        private const string RenderWindowContentsMethod = \"RenderWindowContents\";",
                "",
                "        public void Attach(object plannerType, object harmony)",
                "        {",
                "            var windowTarget = AccessTools.Method(plannerType, RenderWindowContentsMethod);",
                "            harmony.Patch(windowTarget, postfix: null);",
                "        }",
                "    }",
                "}"));

            try
            {
                var offenders = ScanForRenderPatches(root);

                Assert.True(
                    offenders.Count > 0,
                    "the scan walked a tree containing the hook this gate exists to forbid and "
                    + "reported nothing, so a clean result from it means nothing either");
                Assert.Contains(offenders, o => o.Contains("PlantedHook.cs", StringComparison.Ordinal));
            }
            finally
            {
                Directory.Delete(root, recursive: true);
            }
        }

        /// <summary>
        /// The UI-reach walk sees a violation too, and ignores the same file with
        /// the import removed. The negative half is what stops this passing for
        /// the wrong reason: a scan that flagged every file would satisfy the
        /// positive assertion on its own.
        /// </summary>
        [Fact]
        public void TheUiReachScanSeesAPlantedImport()
        {
            var offending = CreateTemporaryProjectTree("GonogoPlantedUplink", "PlantedReach.cs", string.Join(
                "\n",
                "using KSP.UI.Screens;",
                "",
                "namespace GonogoPlantedUplink",
                "{",
                "    public sealed class PlantedReach",
                "    {",
                "        public void Read(MissionRecoveryDialog dialog) { }",
                "    }",
                "}"));

            var clean = CreateTemporaryProjectTree("GonogoPlantedUplink", "PlantedReach.cs", string.Join(
                "\n",
                "namespace GonogoPlantedUplink",
                "{",
                "    /// <summary>Mentions KSP.UI.Screens in prose only.</summary>",
                "    public sealed class PlantedReach",
                "    {",
                "    }",
                "}"));

            try
            {
                var found = ScanForGameUiReach(offending);
                Assert.True(
                    found.Count > 0,
                    "the UI-reach scan walked a tree that imports the game's UI namespace and "
                    + "reported nothing");
                Assert.Contains(found.Keys, k => k.Contains("PlantedReach.cs", StringComparison.Ordinal));

                Assert.Empty(ScanForGameUiReach(clean));
            }
            finally
            {
                Directory.Delete(offending, recursive: true);
                Directory.Delete(clean, recursive: true);
            }
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

        /// <summary>Every render-patch offender under <paramref name="root"/>, as
        /// "project: file:line".</summary>
        private static List<string> ScanForRenderPatches(string root)
        {
            var offenders = new List<string>();

            foreach (var (name, directory) in DiscoverCaptureProjects(root).OrderBy(p => p.Key, StringComparer.Ordinal))
            {
                foreach (var file in SourceFilesIn(directory))
                {
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

            return offenders;
        }

        /// <summary>
        /// Every file under <paramref name="root"/> that names a game UI
        /// namespace in CODE, mapped to the namespaces it names.
        ///
        /// <para>Comment lines are stripped first, and that is load-bearing rather
        /// than tidy: this file's own exemption list explains what each reach is,
        /// several of the excused files carry a <c>&lt;see cref&gt;</c> naming the
        /// dialog they take as a parameter, and an unstripped scan would match the
        /// prose describing the rule as readily as a breach of it.</para>
        /// </summary>
        private static Dictionary<string, SortedSet<string>> ScanForGameUiReach(string root)
        {
            var found = new Dictionary<string, SortedSet<string>>(StringComparer.Ordinal);

            foreach (var (_, directory) in DiscoverCaptureProjects(root))
            {
                foreach (var file in SourceFilesIn(directory))
                {
                    var reached = new SortedSet<string>(StringComparer.Ordinal);

                    foreach (var line in File.ReadAllLines(file))
                    {
                        var trimmed = line.TrimStart();
                        if (trimmed.StartsWith("//", StringComparison.Ordinal) ||
                            trimmed.StartsWith("/*", StringComparison.Ordinal) ||
                            trimmed.StartsWith("*", StringComparison.Ordinal))
                        {
                            continue;
                        }

                        foreach (var ns in GameUiNamespaces)
                        {
                            if (Regex.IsMatch(line, @"\b" + Regex.Escape(ns) + @"\b"))
                            {
                                reached.Add(ns);
                            }
                        }
                    }

                    if (reached.Count > 0)
                    {
                        found[RelativePath(root, file)] = reached;
                    }
                }
            }

            return found;
        }

        /// <summary>
        /// Project name -> source directory, for every non-test project under
        /// <paramref name="root"/> carrying a csproj of its own name.
        ///
        /// <para>Test projects are excluded because a test ships no capture, and
        /// because this file would otherwise flag its own planted strings. The
        /// codegen and test-support siblings are excluded for the first reason
        /// alone.</para>
        /// </summary>
        private static Dictionary<string, string> DiscoverCaptureProjects(string root)
        {
            var projects = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (var directory in Directory.EnumerateDirectories(root))
            {
                var name = Path.GetFileName(directory);
                if (name.EndsWith("Tests", StringComparison.Ordinal) ||
                    name.EndsWith(".Codegen", StringComparison.Ordinal) ||
                    name.EndsWith(".TestSupport", StringComparison.Ordinal))
                {
                    continue;
                }

                if (File.Exists(Path.Combine(directory, name + ".csproj")))
                {
                    projects[name] = directory;
                }
            }

            return projects;
        }

        /// <summary>The C# a project actually ships: no build output, and no
        /// client half (that is TypeScript territory and has its own gates).</summary>
        private static IEnumerable<string> SourceFilesIn(string directory) =>
            Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories)
                .Where(f =>
                {
                    var normalised = f.Replace('\\', '/');
                    return !normalised.Contains("/obj/", StringComparison.Ordinal)
                        && !normalised.Contains("/bin/", StringComparison.Ordinal)
                        && !normalised.Contains("/client/", StringComparison.Ordinal);
                });

        /// <summary>
        /// The non-test projects <c>Gonogo.sln</c> declares, the independent
        /// source <see cref="DiscoverCaptureProjects"/> is checked against. A walk
        /// checked against a list hardcoded here would only ever confirm that
        /// someone remembered to edit the list.
        /// </summary>
        private static HashSet<string> CaptureProjectsDeclaredInSolution(string root)
        {
            var declared = new HashSet<string>(StringComparer.Ordinal);
            var solution = Path.Combine(root, "Gonogo.sln");
            if (!File.Exists(solution))
            {
                return declared;
            }

            foreach (Match match in Regex.Matches(File.ReadAllText(solution), @"=\s*""([A-Za-z0-9_.]+)"""))
            {
                var name = match.Groups[1].Value;
                if (name.EndsWith("Tests", StringComparison.Ordinal) ||
                    name.EndsWith(".Codegen", StringComparison.Ordinal) ||
                    name.EndsWith(".TestSupport", StringComparison.Ordinal))
                {
                    continue;
                }
                if (Directory.Exists(Path.Combine(root, name)))
                {
                    declared.Add(name);
                }
            }

            return declared;
        }

        /// <summary>A throwaway <c>mod/</c>-shaped tree holding one project and
        /// one file, for the planted-failure tests.</summary>
        private static string CreateTemporaryProjectTree(string project, string fileName, string content)
        {
            var root = Path.Combine(Path.GetTempPath(), "windowgate-" + Guid.NewGuid().ToString("N"));
            var directory = Path.Combine(root, project);
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, project + ".csproj"), "<Project />");
            File.WriteAllText(Path.Combine(directory, fileName), content);
            return root;
        }

        private static string RelativePath(string root, string file) =>
            Path.GetRelativePath(root, file).Replace('\\', '/');

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
