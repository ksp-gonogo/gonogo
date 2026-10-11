using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// The gate behind the value tags that are not reckonability:
    /// <see cref="SitrepSampleKindAttribute"/> and <see cref="SitrepEntryKeyAttribute"/>.
    /// Like <see cref="ReckonabilityAssertion"/>, it takes its universe as an
    /// argument and asserts nothing, so a planted fixture can be shown failing and
    /// an Uplink's own test project can run it over its own contract.
    /// </summary>
    public static class ContractTagAssertion
    {
        /// <summary>Units whose values are never points on a line: a reader can only hold one until the next.</summary>
        private static readonly ISet<string> NeverContinuousUnits = new HashSet<string>(StringComparer.Ordinal)
        {
            Units.Flag,
            Units.Id,
            Units.Text,
            Units.Enumeration,
        };

        /// <summary>
        /// Every misplaced value tag among <paramref name="candidateTypes"/>, as
        /// "<c>Type.Property -&gt; what is wrong</c>" strings. Empty means clean.
        /// </summary>
        public static IReadOnlyList<string> Problems(IEnumerable<Type> candidateTypes)
        {
            var types = candidateTypes.Where(t => t.IsClass && !t.IsAbstract).ToList();
            var problems = new List<string>();

            foreach (var type in types)
            {
                foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                {
                    var where = type.Name + "." + prop.Name;
                    var kind = prop.GetCustomAttribute<SitrepSampleKindAttribute>(false);
                    if (kind != null)
                    {
                        var problem = KindProblem(kind.Kind, prop.GetCustomAttribute<SitrepUnitAttribute>(false)?.Unit);
                        if (problem is not null)
                        {
                            problems.Add(where + " -> " + problem);
                        }
                    }

                    if (prop.IsDefined(typeof(SitrepEntryKeyAttribute), false))
                    {
                        var problem = ReckonabilityAssertion.EntryKeyProblem(type);
                        if (problem is not null)
                        {
                            problems.Add(where + " -> " + problem);
                        }
                    }
                }
            }

            return problems.Distinct(StringComparer.Ordinal).ToList();
        }

        /// <summary>Why a value may not declare <paramref name="kind"/>, or null when it may.</summary>
        private static string? KindProblem(SampleKind kind, string? unit)
        {
            if (kind == SampleKind.Event)
            {
                return "declares SampleKind.Event. Whether a sample is an occurrence is a fact about the "
                    + "whole sample, so it is declared on the channel; a field recording the last "
                    + "occurrence of something is Discrete.";
            }

            if (!Enum.IsDefined(typeof(SampleKind), kind))
            {
                return "declares sample kind " + (int)kind + ", which is not a SampleKind.";
            }

            if (kind == SampleKind.Continuous && unit != null && NeverContinuousUnits.Contains(unit))
            {
                return "declares SampleKind.Continuous on a '" + unit + "' value. Nothing lies between "
                    + "two of those, so a line drawn between them invents values that were never true.";
            }

            return null;
        }
    }
}
