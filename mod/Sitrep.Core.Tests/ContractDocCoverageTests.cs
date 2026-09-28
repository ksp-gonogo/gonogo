using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Xml.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Every public type and member of <c>Sitrep.Contract</c> carries an XML doc
    /// comment, because the contract's reference pages are generated from them and
    /// an undocumented member reaches an Uplink author as a bare signature.
    ///
    /// <para>Held by <see cref="ContractDocCoverageDebt.Undocumented"/>, which only
    /// shrinks: a member missing from it fails, and so does an entry that is now
    /// documented or names nothing. Set <c>GONOGO_CONTRACT_DOC_DEBT_UPDATE=1</c> to
    /// rewrite the list with the documented entries removed; it never adds one.</para>
    ///
    /// <para>Members are named by their XML doc ids, built here from reflection.
    /// <see cref="EveryDocIdNamesAMember"/> checks the builder against the ids the
    /// compiler wrote, so a builder that misspells an id fails rather than leaving
    /// a documented member in the debt forever.</para>
    ///
    /// <para>Not graded: compiler-generated members, property and event accessors,
    /// overrides of <c>object</c>'s members, members of delegate types, and a lone
    /// parameterless constructor, which is usually the implicit one and has no
    /// source to document.</para>
    /// </summary>
    public class ContractDocCoverageTests
    {
        private static readonly Assembly Contract = typeof(ContractVersion).Assembly;

        private const BindingFlags Declared =
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance |
            BindingFlags.Static | BindingFlags.DeclaredOnly;

        private static readonly string[] ObjectMembers = { "Equals", "GetHashCode", "ToString", "Finalize" };

        [Fact]
        public void PlantedMembersAreGraded()
        {
            var ids = GradedMembers(new[] { typeof(PlantedDocs) }).Select(m => DocId(m)).ToList();
            Assert.Contains("T:Sitrep.Core.Tests.ContractDocCoverageTests.PlantedDocs", ids);
            Assert.Contains("M:Sitrep.Core.Tests.ContractDocCoverageTests.PlantedDocs.Undocumented(System.Int32,System.String[])", ids);
            Assert.Contains("P:Sitrep.Core.Tests.ContractDocCoverageTests.PlantedDocs.Value", ids);
            Assert.DoesNotContain(ids, id => id.Contains("get_Value"));
        }

        [Fact]
        public void EveryDocIdNamesAMember()
        {
            var known = new HashSet<string>(Contract.GetTypes().SelectMany(t => AllMembers(t)).Select(DocId));
            var unknown = DocumentedIds().Where(id => !id.StartsWith("N:") && !known.Contains(id)).OrderBy(id => id).ToList();
            Assert.True(
                unknown.Count == 0,
                $"BLIND: {unknown.Count} XML doc id(s) name no member this builder produces, so its ids are wrong:\n  " +
                string.Join("\n  ", unknown.Take(40)));
        }

        [Fact]
        public void EveryPublicMemberIsDocumentedOrListed()
        {
            var documented = DocumentedIds();
            var undocumented = new SortedSet<string>(
                GradedMembers(PublicTypes()).Select(DocId).Where(id => !documented.Contains(id)),
                StringComparer.Ordinal);
            Assert.True(undocumented.Count > 0 || ContractDocCoverageDebt.Undocumented.Length == 0, "graded nothing");

            var listed = new HashSet<string>(ContractDocCoverageDebt.Undocumented);
            if (Environment.GetEnvironmentVariable("GONOGO_CONTRACT_DOC_DEBT_UPDATE") == "1")
            {
                WriteDebt(ContractDocCoverageDebt.Undocumented.Where(undocumented.Contains));
                return;
            }

            var unlisted = undocumented.Where(id => !listed.Contains(id)).ToList();
            Assert.True(
                unlisted.Count == 0,
                $"{unlisted.Count} public contract member(s) have no XML doc comment. Document each:\n  " +
                string.Join("\n  ", unlisted));
            var stale = ContractDocCoverageDebt.Undocumented.Where(id => !undocumented.Contains(id)).ToList();
            Assert.True(
                stale.Count == 0,
                $"{stale.Count} debt entr(ies) are documented now or name nothing. Remove them with GONOGO_CONTRACT_DOC_DEBT_UPDATE=1:\n  " +
                string.Join("\n  ", stale));
        }

        private static HashSet<string> DocumentedIds()
        {
            var path = Path.ChangeExtension(Contract.Location, ".xml");
            Assert.True(File.Exists(path), $"BLIND: no XML doc file beside {Contract.Location}");
            return new HashSet<string>(
                XDocument.Load(path).Descendants("member")
                    .Where(m => m.Elements().Any())
                    .Select(m => (string)m.Attribute("name")!));
        }

        private static IEnumerable<Type> PublicTypes() =>
            Contract.GetTypes().Where(IsVisible);

        private static bool IsVisible(Type type)
        {
            for (var t = type; t != null; t = t.DeclaringType)
            {
                if (t.IsNested ? !(t.IsNestedPublic || t.IsNestedFamily || t.IsNestedFamORAssem) : !t.IsPublic) return false;
            }
            return true;
        }

        private static IEnumerable<MemberInfo> AllMembers(Type type) =>
            new MemberInfo[] { type }.Concat(type.GetMembers(Declared).Where(m => m is not Type));

        private static IEnumerable<MemberInfo> GradedMembers(IEnumerable<Type> types)
        {
            foreach (var type in types)
            {
                if (IsCompilerGenerated(type)) continue;
                yield return type;
                if (typeof(Delegate).IsAssignableFrom(type)) continue;
                var ctors = type.GetConstructors(Declared).Where(IsReachable).ToList();
                var loneDefault = ctors.Count == 1 && ctors[0].GetParameters().Length == 0;
                foreach (var member in type.GetMembers(Declared))
                {
                    if (member is Type || IsCompilerGenerated(member)) continue;
                    if (!IsReachable(member)) continue;
                    if (member is MethodBase method && method.IsSpecialName && !(method is ConstructorInfo) && !method.Name.StartsWith("op_")) continue;
                    if (member is ConstructorInfo && loneDefault) continue;
                    if (member is MethodInfo m && m.GetBaseDefinition().DeclaringType == typeof(object) && ObjectMembers.Contains(m.Name)) continue;
                    if (member is FieldInfo f && type.IsEnum && f.IsSpecialName) continue;
                    yield return member;
                }
            }
        }

        private static bool IsCompilerGenerated(MemberInfo member) =>
            member.IsDefined(typeof(CompilerGeneratedAttribute), false) || member.Name.Contains('<');

        private static bool IsReachable(MemberInfo member) => member switch
        {
            MethodBase m => m.IsPublic || m.IsFamily || m.IsFamilyOrAssembly,
            FieldInfo f => f.IsPublic || f.IsFamily || f.IsFamilyOrAssembly,
            PropertyInfo p => p.GetAccessors(true).Any(a => a.IsPublic || a.IsFamily || a.IsFamilyOrAssembly),
            EventInfo e => e.AddMethod is { } add && (add.IsPublic || add.IsFamily || add.IsFamilyOrAssembly),
            _ => false,
        };

        private static string DocId(MemberInfo member) => member switch
        {
            Type t => "T:" + TypeName(t),
            FieldInfo f => "F:" + TypeName(f.DeclaringType!) + "." + f.Name,
            PropertyInfo p => "P:" + TypeName(p.DeclaringType!) + "." + p.Name + Parameters(p.GetIndexParameters(), null),
            EventInfo e => "E:" + TypeName(e.DeclaringType!) + "." + e.Name,
            ConstructorInfo c => "M:" + TypeName(c.DeclaringType!) + "." + (c.IsStatic ? "#cctor" : "#ctor") + Parameters(c.GetParameters(), null),
            MethodInfo m => "M:" + TypeName(m.DeclaringType!) + "." + m.Name.Replace('.', '#') +
                (m.IsGenericMethodDefinition ? "``" + m.GetGenericArguments().Length : "") +
                Parameters(m.GetParameters(), m) +
                (m.Name is "op_Implicit" or "op_Explicit" ? "~" + ParameterType(m.ReturnType, m) : ""),
            _ => throw new ArgumentException(member.ToString()),
        };

        /// <summary>A type's doc-id name: namespace-qualified, nested types joined by a dot, generic arity kept.</summary>
        private static string TypeName(Type type) =>
            type.IsNested ? TypeName(type.DeclaringType!) + "." + type.Name : type.FullName ?? type.Name;

        private static string Parameters(ParameterInfo[] parameters, MethodInfo? method) =>
            parameters.Length == 0 ? "" : "(" + string.Join(",", parameters.Select(p => ParameterType(p.ParameterType, method))) + ")";

        private static string ParameterType(Type type, MethodInfo? method)
        {
            if (type.IsByRef) return ParameterType(type.GetElementType()!, method) + "@";
            if (type.IsPointer) return ParameterType(type.GetElementType()!, method) + "*";
            if (type.IsArray)
            {
                var rank = type.GetArrayRank();
                return ParameterType(type.GetElementType()!, method) + (rank == 1 ? "[]" : "[" + string.Join(",", Enumerable.Repeat("0:", rank)) + "]");
            }
            if (type.IsGenericParameter)
            {
                return type.DeclaringMethod != null ? "``" + type.GenericParameterPosition : "`" + type.GenericParameterPosition;
            }
            if (!type.IsGenericType) return TypeName(type);
            var definition = type.GetGenericTypeDefinition();
            var args = type.GetGenericArguments();
            var name = new StringBuilder();
            var offset = 0;
            foreach (var segment in Chain(definition))
            {
                if (name.Length > 0) name.Append('.');
                var tick = segment.Name.IndexOf('`');
                if (tick < 0)
                {
                    name.Append(segment.IsNested ? segment.Name : segment.FullName);
                    continue;
                }
                var arity = int.Parse(segment.Name.Substring(tick + 1));
                var bare = segment.Name.Substring(0, tick);
                name.Append(segment.IsNested ? bare : segment.Namespace + "." + bare);
                name.Append('{').Append(string.Join(",", args.Skip(offset).Take(arity).Select(a => ParameterType(a, method)))).Append('}');
                offset += arity;
            }
            return name.ToString();
        }

        private static IEnumerable<Type> Chain(Type type)
        {
            var chain = new Stack<Type>();
            for (var t = type; t != null; t = t.DeclaringType) chain.Push(t);
            return chain;
        }

        private static void WriteDebt(IEnumerable<string> remaining)
        {
            var path = Path.Combine(RepoRoot(), "mod", "Sitrep.Core.Tests", "ContractDocCoverageDebt.cs");
            var ids = remaining.OrderBy(id => id, StringComparer.Ordinal).ToList();
            var text = new StringBuilder();
            text.AppendLine("namespace Sitrep.Core.Tests");
            text.AppendLine("{");
            text.AppendLine("    /// <summary>");
            text.AppendLine($"    /// Public <c>Sitrep.Contract</c> members with no XML doc comment, by doc id. {ids.Count} entries.");
            text.AppendLine("    /// Shrink-only, rewritten by <see cref=\"ContractDocCoverageTests\"/> with");
            text.AppendLine("    /// <c>GONOGO_CONTRACT_DOC_DEBT_UPDATE=1</c>, which only removes. Nothing is added by hand.");
            text.AppendLine("    /// </summary>");
            text.AppendLine("    public static class ContractDocCoverageDebt");
            text.AppendLine("    {");
            text.AppendLine("        public static readonly string[] Undocumented =");
            text.AppendLine("        {");
            foreach (var id in ids) text.AppendLine($"            \"{id}\",");
            text.AppendLine("        };");
            text.AppendLine("    }");
            text.AppendLine("}");
            File.WriteAllText(path, text.ToString());
        }

        private static string RepoRoot()
        {
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
            {
                if (File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml"))) return dir.FullName;
            }
            throw new InvalidOperationException("no repo root above " + AppContext.BaseDirectory);
        }

        /// <summary>Graded by <see cref="PlantedMembersAreGraded"/>; its members are deliberately undocumented.</summary>
        public class PlantedDocs
        {
            public void Undocumented(int count, string[] names) { }
            public int Value { get; set; }
        }
    }
}
