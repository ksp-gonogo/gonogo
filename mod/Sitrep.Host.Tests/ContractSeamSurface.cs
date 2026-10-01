using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The C# surface of the shipped <c>Sitrep.Contract</c> seams, as
    /// <see cref="ContractShapeGateTests"/> freezes and compares it.
    ///
    /// <para><b>What counts as a seam.</b> Every public interface and every
    /// public abstract class: those are the types an Uplink implements, derives
    /// from or calls, so a changed member breaks it at compile time whatever the
    /// wire does. A concrete type's data is already the wire ledger's business,
    /// and its methods are a call surface rather than something a plugin fills
    /// in, so they are left out.</para>
    ///
    /// <para><b>Plugin-implemented versus merely consumed.</b> Settled by who
    /// writes the implementation, from a search of this repo and
    /// <c>gonogo-uplinks</c>: an Uplink or one of its backends implements or
    /// derives <c>ISitrepUplink</c>, <c>ICommsBackend</c>, <c>CommsBackendBase</c>,
    /// <c>ICommandCentre</c>, the election backends and so on, while the host
    /// alone implements <c>IUplinkHost</c> and the few types in
    /// <see cref="HostImplemented"/>, which a plugin only calls. A removed or
    /// retyped member breaks both kinds. A NEW abstract member breaks only a
    /// plugin-implemented type, since a plugin has to supply it, whereas the host
    /// is rebuilt with the contract. The default is plugin-implemented, so a type
    /// nobody classified is held to the stricter rule and relaxing one is a
    /// visible edit to <see cref="HostImplemented"/>, which the frozen
    /// <c>role:</c> entry then reports as a removal.</para>
    /// </summary>
    internal static class ContractSeamSurface
    {
        /// <summary>
        /// Seams the host (or the core mod) implements and a plugin only calls.
        /// Everything else is treated as plugin-implemented.
        /// </summary>
        internal static readonly HashSet<string> HostImplemented = new(StringComparer.Ordinal)
        {
            "Sitrep.Contract.IUplinkHost",
            "Sitrep.Contract.IChannelPublisher",
            "Sitrep.Contract.IDynamicChannelSource",
            "Sitrep.Contract.IGateArguments",
            "Sitrep.Contract.ISnapshotSampler",
            "Sitrep.Contract.IUplinkSettings",
            "Sitrep.Contract.IActiveVessel",
            "Sitrep.Contract.IDelayedScienceSink",
        };

        private const string Separator = "|";

        internal static bool IsSeam(Type type) =>
            (type.IsPublic || type.IsNestedPublic)
            && (type.IsInterface || (type.IsAbstract && !type.IsSealed));

        /// <summary>The frozen surface of every seam in <paramref name="assembly"/>, keyed by full name.</summary>
        internal static Dictionary<string, string[]> Compute(Assembly assembly)
        {
            var seams = new SortedDictionary<string, string[]>(StringComparer.Ordinal);
            foreach (var type in assembly.GetTypes().Where(IsSeam))
            {
                var fullName = type.FullName ?? type.Name;
                seams[fullName] = Describe(type, !HostImplemented.Contains(fullName));
            }

            return new Dictionary<string, string[]>(seams);
        }

        /// <summary>
        /// One <c>"Name(params):Return|kind"</c> string per public or protected
        /// member declared on <paramref name="type"/>, sorted. The kind is
        /// <c>abstract</c> (an implementer must supply it), <c>virtual</c> (it
        /// may be overridden) or <c>plain</c>.
        /// </summary>
        internal static string[] Describe(Type type, bool pluginImplemented)
        {
            const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic
                | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

            var entries = new List<string>
            {
                "role:" + (pluginImplemented ? "plugin" : "host") + Separator + "plain",
            };

            if (type.BaseType is { } baseType && baseType != typeof(object))
            {
                entries.Add("extends:" + baseType + Separator + "plain");
            }

            // A base interface of an interface is an obligation on every implementer.
            foreach (var implemented in type.GetInterfaces())
            {
                entries.Add("implements:" + implemented + Separator + (type.IsInterface ? "abstract" : "plain"));
            }

            foreach (var method in type.GetMethods(all).Where(IsVisible))
            {
                var generics = method.IsGenericMethodDefinition ? "<" + method.GetGenericArguments().Length + ">" : "";
                var parameters = string.Join(",", method.GetParameters().Select(p => p.ParameterType.ToString()));
                entries.Add($"{method.Name}{generics}({parameters}):{method.ReturnType}{Separator}{KindOf(method)}");
            }

            foreach (var constructor in type.GetConstructors(all).Where(IsVisible))
            {
                var parameters = string.Join(",", constructor.GetParameters().Select(p => p.ParameterType.ToString()));
                entries.Add($"ctor({parameters}){Separator}plain");
            }

            foreach (var field in type.GetFields(all).Where(f => f.IsPublic || f.IsFamily || f.IsFamilyOrAssembly))
            {
                entries.Add($"field {field.Name}:{field.FieldType}{Separator}plain");
            }

            return entries.Distinct(StringComparer.Ordinal).OrderBy(e => e, StringComparer.Ordinal).ToArray();
        }

        private static bool IsVisible(MethodBase method) =>
            method.IsPublic || method.IsFamily || method.IsFamilyOrAssembly;

        private static string KindOf(MethodInfo method)
        {
            if (method.IsAbstract)
            {
                return "abstract";
            }

            return method.IsVirtual && !method.IsFinal ? "virtual" : "plain";
        }

        /// <summary>
        /// What a plugin built against <paramref name="from"/> loses or must newly
        /// supply under <paramref name="to"/>, one canonical string each; empty
        /// means <paramref name="to"/> is compatible.
        /// </summary>
        internal static IEnumerable<string> Breaks(
            Dictionary<string, string[]> from, Dictionary<string, string[]> to)
        {
            foreach (var typeName in from.Keys.Except(to.Keys))
            {
                yield return "seam-type-removed:" + typeName;
            }

            foreach (var (typeName, fromEntries) in from)
            {
                if (!to.TryGetValue(typeName, out var toEntries))
                {
                    continue;
                }

                var fromByKey = Index(fromEntries);
                var toByKey = Index(toEntries);
                var pluginImplemented = toByKey.ContainsKey("role:plugin");

                foreach (var (key, fromKind) in fromByKey)
                {
                    if (!toByKey.TryGetValue(key, out var toKind))
                    {
                        yield return $"seam-member-removed:{typeName}.{key}";
                        continue;
                    }

                    if (fromKind != "plain" && toKind == "plain")
                    {
                        yield return $"seam-member-no-longer-overridable:{typeName}.{key}";
                    }
                    else if (pluginImplemented && fromKind != "abstract" && toKind == "abstract")
                    {
                        yield return $"seam-member-now-abstract:{typeName}.{key}";
                    }
                }

                if (!pluginImplemented)
                {
                    continue;
                }

                foreach (var (key, toKind) in toByKey)
                {
                    if (toKind == "abstract" && !fromByKey.ContainsKey(key))
                    {
                        yield return $"seam-member-added-abstract:{typeName}.{key}";
                    }
                }
            }
        }

        private static Dictionary<string, string> Index(string[] entries) =>
            entries.ToDictionary(
                e => e.Substring(0, e.LastIndexOf(Separator, StringComparison.Ordinal)),
                e => e.Substring(e.LastIndexOf(Separator, StringComparison.Ordinal) + 1),
                StringComparer.Ordinal);
    }
}
