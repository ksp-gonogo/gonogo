using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// One part module as the save holds it: its name, its persistent values as text, and the
    /// <c>ScienceData</c> nodes under it, each as the text values of that node.
    /// </summary>
    public sealed class SavedModule
    {
        public SavedModule(
            string name,
            IReadOnlyDictionary<string, string> values,
            IReadOnlyList<Dictionary<string, string>> scienceData
        )
        {
            Name = name;
            Values = values;
            ScienceData = scienceData;
        }

        public string Name { get; }

        public IReadOnlyDictionary<string, string> Values { get; }

        public IReadOnlyList<Dictionary<string, string>> ScienceData { get; }
    }

    /// <summary>
    /// What a kerbal holds and what a flag says, read from the saved part modules of a
    /// vessel that is not loaded, where the live modules are not there to ask.
    ///
    /// <para>Carries no KSP or Unity type, so the test project compiles it without the
    /// game's assemblies; <see cref="KspHost"/> turns each <c>ProtoPartModuleSnapshot</c>
    /// into a <see cref="SavedModule"/> and hands the lot here.</para>
    /// </summary>
    public static class SavedModuleReads
    {
        private const string FlagModule = "FlagSite";

        private static readonly string[] ScienceModules = { "ModuleScienceExperiment", "ModuleScienceContainer" };

        /// <summary>
        /// The science results held in the experiment and container modules among
        /// <paramref name="modules"/>. Empty when none holds one, and null when
        /// <paramref name="modules"/> is null, which says the save was not read rather than
        /// that nothing is held.
        /// </summary>
        public static List<EvaHeldData>? HeldData(IEnumerable<SavedModule>? modules)
        {
            if (modules == null)
            {
                return null;
            }

            var held = new List<EvaHeldData>();
            foreach (var module in modules)
            {
                if (System.Array.IndexOf(ScienceModules, module.Name) < 0)
                {
                    continue;
                }

                foreach (var node in module.ScienceData)
                {
                    node.TryGetValue("subjectID", out var subjectId);
                    node.TryGetValue("title", out var title);
                    held.Add(new EvaHeldData
                    {
                        SubjectId = subjectId,
                        Title = title,
                        DataAmount = ParseAmount(node),
                    });
                }
            }

            return held;
        }

        /// <summary>
        /// The saved value of <paramref name="key"/> on the flag module among
        /// <paramref name="modules"/>, or null when there is no such module or the save has no
        /// such value. An empty saved value is returned as empty.
        /// </summary>
        public static string? FlagValue(IEnumerable<SavedModule>? modules, string key)
        {
            if (modules == null)
            {
                return null;
            }

            foreach (var module in modules)
            {
                if (module.Name == FlagModule)
                {
                    return module.Values.TryGetValue(key, out var value) ? value : null;
                }
            }

            return null;
        }

        private static double? ParseAmount(Dictionary<string, string> node) =>
            node.TryGetValue("data", out var text)
            && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var amount)
                ? amount
                : (double?)null;
    }
}
