using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using RP0;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// The one file that keeps the client's transcription of RP-1's build price
    /// honest.
    ///
    /// <para><b>Why a transcription exists at all.</b> Every other price this
    /// Uplink shows is computed here, beside RP-1, because it prices something that
    /// already exists. A NEW complex is priced against what the operator is still
    /// typing, and these commands are delay-aware, so a quote per keystroke would
    /// be a round trip a remote vantage waits minutes for. The client therefore
    /// carries the closed-form halves itself.</para>
    ///
    /// <para><b>What this test is for.</b> A transcription drifts silently: it goes
    /// on agreeing with itself long after it has stopped agreeing with RP-1. So the
    /// cases below are computed by the SHIPPED <c>LCData.GetCostStats</c> and
    /// written to a file the client's own test reads. If RP-1 changes, this fails
    /// and the file is regenerated; if the client drifts, the client's test fails
    /// against the same file. Neither side can move alone.</para>
    ///
    /// <para>Regenerate with <c>GONOGO_WRITE_LC_COST_CASES=1</c>, and read the diff
    /// rather than committing it blind: a changed figure means RP-1 now charges
    /// something different, which is a finding rather than a chore.</para>
    ///
    /// <para>The resource term is deliberately NOT here. Its factors come from a
    /// RealFuels tank definition and a KSP resource library that no test harness
    /// stands up, and the client does not transcribe it either: it arrives per
    /// resource on <c>rp1.lcPricing</c>.</para>
    ///
    /// <para><b>WHAT THIS FILE'S NAME OVERSTATES, and it matters for reading a
    /// green run.</b> <c>using RP0</c> resolves to the STAND-IN types declared in
    /// <c>ComplexLifecycleFixture.cs</c>, not to the shipped assembly: this
    /// project takes no reference to RP0.dll and could not, since the type is a
    /// ScenarioModule over half a dozen Unity assemblies. The stand-in's own
    /// header says its <c>GetCostStats</c> and <c>ResModifyCost</c> are
    /// "reproduced from the shipped source", so what these cases pin is the
    /// CLIENT transcription against the C# one, and two copies of a reading agree
    /// with each other for ever. RP-1's own binary is held only by
    /// <c>Rp1InstalledCompatibilityTests</c>, which checks SHAPE and never value,
    /// so a retune of RP-1's prices passes everything here. That gap is real and
    /// unclosed; closing it needs a figure read off a running game.</para>
    /// </summary>
    public class Rp1LcCostCrossCheckTests
    {
        /// <summary>RP-1's shipped additional-pad multiplier, as Rp1LcCostModelTests names it.</summary>
        private const double PadMult = 0.5;

        private static string CasesPath => TestDataPath("lc-cost-cases.json");

        private static string ModifyCasesPath => TestDataPath("lc-modify-cases.json");

        private static string TestDataPath(string file)
        {
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
            {
                var candidate = Path.Combine(
                    dir.FullName, "mod", "GonogoRp1Uplink", "client", "src",
                    "KscComplexes", "__testdata__", file);
                if (Directory.Exists(Path.GetDirectoryName(candidate)!))
                {
                    return candidate;
                }
            }
            throw new DirectoryNotFoundException(
                "Could not find the client's __testdata__ from " + AppContext.BaseDirectory);
        }

        /// <summary>Mass, width, height, depth, human-rated, hangar.</summary>
        private static readonly (float Mass, float W, float H, float D, bool Human, bool Hangar)[] Cases =
        {
            (100f, 10f, 20f, 10f, false, false),
            (100f, 10f, 20f, 10f, true, false),
            (1f, 1f, 1f, 1f, false, false),
            (15f, 3f, 3f, 5f, false, false),
            (180f, 12f, 9f, 40f, false, false),
            (350f, 20f, 30f, 20f, false, false),
            // Above 350 t the second term starts to bite, which is the clause a
            // transcription is most likely to drop.
            (351f, 20f, 30f, 20f, false, false),
            (600f, 25f, 40f, 25f, false, false),
            (600f, 25f, 40f, 25f, true, false),
            (2000f, 40f, 60f, 40f, false, false),
            // A hangar has no pad and stretches its own height fivefold first.
            (100f, 10f, 20f, 10f, false, true),
            (100f, 10f, 20f, 10f, true, true),
            // Small enough that the integration floor of 1000 is what applies.
            (1f, 1f, 1f, 1f, false, true),
        };

        /// <summary>
        /// Renovations: what the complex stands at, what it is renovated to, and
        /// how many working pads it has.
        ///
        /// <para>Chosen for the clauses a transcription drops rather than for
        /// coverage. In order: a plain growth; the same growth with two pads,
        /// which reprices every pad the complex already has; a shrink, which is
        /// charged at half in both halves and is the case an operator most expects
        /// a refund for; a tonnage nudge small enough that the 1,000-fund floor is
        /// what applies; an envelope change at a FIXED tonnage, where the floor
        /// must NOT apply; a growth big enough for the "rebuilding cannot cost
        /// more than building" cap to bite; and a hangar, which has no pad half
        /// and a flat metre rate.</para>
        /// </summary>
        private static readonly (
            float Mass, float W, float H, float D, bool Human,
            float ToMass, float ToW, float ToH, float ToD, bool ToHuman,
            int Pads, bool Hangar)[] ModifyCases =
        {
            (100f, 10f, 20f, 10f, false, 180f, 10f, 20f, 10f, false, 1, false),
            (100f, 10f, 20f, 10f, false, 180f, 10f, 20f, 10f, false, 2, false),
            (180f, 12f, 24f, 12f, false, 100f, 10f, 20f, 10f, false, 1, false),
            (100f, 10f, 20f, 10f, false, 101f, 10f, 20f, 10f, false, 1, false),
            (100f, 10f, 20f, 10f, false, 100f, 14f, 26f, 14f, false, 1, false),
            (100f, 10f, 20f, 10f, false, 190f, 20f, 40f, 20f, true, 1, false),
            // The hangar, whose tonnage and human rating a modify REFUSES rather
            // than accepting: RP-1 draws neither field for it, forces the rating
            // true and holds the limit where it is. So the case states both sides
            // the way the command would leave them, and the client mirrors it
            // rather than inferring it.
            (100f, 10f, 20f, 10f, true, 100f, 14f, 26f, 14f, true, 1, true),
        };

        [Fact]
        public void The_client_renovation_cases_are_what_the_cost_model_charges()
        {
            var rows = ModifyCases.Select(c =>
            {
                var current = new LCData
                {
                    Name = "case",
                    massMax = c.Mass,
                    massOrig = c.Mass,
                    sizeMax = new UnityEngine.Vector3(c.W, c.H, c.D),
                    isHumanRated = c.Human,
                    lcType = c.Hangar ? LaunchComplexType.Hangar : LaunchComplexType.Pad,
                };
                var next = new LCData
                {
                    Name = "case",
                    massMax = c.ToMass,
                    // Carried through unchanged, which is what a renovation does:
                    // massOrig fixes the envelope and is the curve the per-metre
                    // charge is lerped over.
                    massOrig = c.Mass,
                    sizeMax = new UnityEngine.Vector3(c.ToW, c.ToH, c.ToD),
                    isHumanRated = c.ToHuman,
                    lcType = c.Hangar ? LaunchComplexType.Hangar : LaunchComplexType.Pad,
                };

                var complex = new LaunchComplex { Name = "case", StatsValue = new LCData(current) };
                complex.SyncFromStats();

                var quote = Rp1LcCostModel.QuoteModify(
                    next, complex, complex.Stats, c.Hangar, c.Pads, typeof(LaunchComplex), PadMult);
                Assert.NotNull(quote);
                return (c, quote!.TotalCost, quote.IsDowngrade);
            }).ToList();

            var json = RenderModify(rows);

            if (Environment.GetEnvironmentVariable("GONOGO_WRITE_LC_COST_CASES") == "1")
            {
                File.WriteAllText(ModifyCasesPath, json);
                return;
            }

            Assert.True(File.Exists(ModifyCasesPath),
                "lc-modify-cases.json is missing. Regenerate with GONOGO_WRITE_LC_COST_CASES=1.");
            Assert.Equal(Normalise(File.ReadAllText(ModifyCasesPath)), Normalise(json));
        }

        [Fact]
        public void The_client_cost_cases_are_what_the_shipped_assembly_charges()
        {
            var rows = Cases.Select(c =>
            {
                var spec = new LCData
                {
                    Name = "case",
                    massMax = c.Mass,
                    massOrig = c.Mass,
                    sizeMax = new UnityEngine.Vector3(c.W, c.H, c.D),
                    isHumanRated = c.Human,
                    lcType = c.Hangar ? LaunchComplexType.Hangar : LaunchComplexType.Pad,
                };
                spec.GetCostStats(out var pad, out var integration, out var resources);
                Assert.Equal(0.0, resources, 9);
                return (c, pad, integration);
            }).ToList();

            var json = Render(rows);

            if (Environment.GetEnvironmentVariable("GONOGO_WRITE_LC_COST_CASES") == "1")
            {
                File.WriteAllText(CasesPath, json);
                return;
            }

            Assert.True(File.Exists(CasesPath),
                "lc-cost-cases.json is missing. Regenerate with GONOGO_WRITE_LC_COST_CASES=1.");
            // Whitespace-normalised, not byte-compared. The file is formatted by
            // the repo's own formatter, and a test that failed on its indentation
            // would be a test the formatter breaks every time it touches the file.
            // A changed FIGURE still fails, which is the only thing this is for.
            Assert.Equal(Normalise(File.ReadAllText(CasesPath)), Normalise(json));
        }

        private static string Normalise(string text) =>
            new string(text.Where(c => !char.IsWhiteSpace(c)).ToArray());

        private static string Render(
            List<((float Mass, float W, float H, float D, bool Human, bool Hangar) C, double Pad, double Integration)> rows)
        {
            var sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append("  \"_comment\": \"GENERATED from the shipped RP0.dll by ");
            sb.Append("Rp1LcCostCrossCheckTests. Do not hand-edit: regenerate with ");
            sb.Append("GONOGO_WRITE_LC_COST_CASES=1 and read the diff, because a changed ");
            sb.Append("figure means RP-1 now charges something different.\",\n");
            sb.Append("  \"cases\": [\n");
            for (var i = 0; i < rows.Count; i++)
            {
                var (c, pad, integration) = rows[i];
                sb.Append("    { ");
                sb.Append(Num("massMax", c.Mass)).Append(", ");
                sb.Append(Num("sizeMaxWidth", c.W)).Append(", ");
                sb.Append(Num("sizeMaxHeight", c.H)).Append(", ");
                sb.Append(Num("sizeMaxDepth", c.D)).Append(", ");
                sb.Append("\"humanRated\": ").Append(c.Human ? "true" : "false").Append(", ");
                sb.Append("\"isHangar\": ").Append(c.Hangar ? "true" : "false").Append(", ");
                sb.Append(Num("pad", pad)).Append(", ");
                sb.Append(Num("integration", integration));
                sb.Append(" }");
                sb.Append(i == rows.Count - 1 ? "\n" : ",\n");
            }
            sb.Append("  ]\n}\n");
            return sb.ToString();
        }

        private static string RenderModify(
            List<((float Mass, float W, float H, float D, bool Human,
                   float ToMass, float ToW, float ToH, float ToD, bool ToHuman,
                   int Pads, bool Hangar) C, double Total, bool IsDowngrade)> rows)
        {
            var sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append("  \"_comment\": \"GENERATED by Rp1LcCostCrossCheckTests from ");
            sb.Append("Rp1LcCostModel.QuoteModify. Do not hand-edit: regenerate with ");
            sb.Append("GONOGO_WRITE_LC_COST_CASES=1 and read the diff. See that file's ");
            sb.Append("summary for what this pins and what it does NOT.\",\n");
            sb.Append("  \"cases\": [\n");
            for (var i = 0; i < rows.Count; i++)
            {
                var (c, total, downgrade) = rows[i];
                sb.Append("    { ");
                sb.Append(Num("massMax", c.Mass)).Append(", ");
                sb.Append(Num("sizeMaxWidth", c.W)).Append(", ");
                sb.Append(Num("sizeMaxHeight", c.H)).Append(", ");
                sb.Append(Num("sizeMaxDepth", c.D)).Append(", ");
                sb.Append("\"humanRated\": ").Append(c.Human ? "true" : "false").Append(", ");
                sb.Append(Num("toMassMax", c.ToMass)).Append(", ");
                sb.Append(Num("toSizeMaxWidth", c.ToW)).Append(", ");
                sb.Append(Num("toSizeMaxHeight", c.ToH)).Append(", ");
                sb.Append(Num("toSizeMaxDepth", c.ToD)).Append(", ");
                sb.Append("\"toHumanRated\": ").Append(c.ToHuman ? "true" : "false").Append(", ");
                sb.Append(Num("launchPadCount", c.Pads)).Append(", ");
                sb.Append("\"isHangar\": ").Append(c.Hangar ? "true" : "false").Append(", ");
                sb.Append(Num("total", total)).Append(", ");
                sb.Append("\"isDowngrade\": ").Append(downgrade ? "true" : "false");
                sb.Append(" }");
                sb.Append(i == rows.Count - 1 ? "\n" : ",\n");
            }
            sb.Append("  ]\n}\n");
            return sb.ToString();
        }

        /// <summary>Round-trippable, so a re-render of unchanged numbers is byte-identical.</summary>
        private static string Num(string name, double value) =>
            "\"" + name + "\": " + value.ToString("R", CultureInfo.InvariantCulture);
    }
}
