#if SITREP_CODEGEN
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using Reinforced.Typings;
using Reinforced.Typings.Ast;
using Reinforced.Typings.Ast.TypeNames;
using Reinforced.Typings.Attributes;
using Reinforced.Typings.Visitors.TypeScript;

namespace Sitrep.Contract;

/// <summary>
/// The Reinforced.Typings exporter that writes the contract's C# doc comments
/// onto the generated TypeScript, as TSDoc. <see cref="RtDocText"/> translates
/// each summary's XML into TSDoc lines.
///
/// <para>A <c>see cref</c> whose target is exported by the file being written
/// becomes a code-form pointer at its TypeScript name; any other <c>cref</c> is
/// written as plain prose, so the TypeScript never points at a name an author
/// cannot import.</para>
/// <internal>
/// Reachability is decided here rather than in RtDocText because only the file
/// being written knows which names it exports. The C# prose crefs host types,
/// private assemblies and static helpers freely, which is right on that side,
/// where they are all one solution.
/// </internal>
/// </summary>
/// <category>Serialization</category>
public class RtDocVisitor : TypeScriptExportVisitor
{
    /// <summary>
    /// C# simple type name -> the name the SDK exports it as. The two differ
    /// wherever a registration overrides the name (<c>CommandResult&lt;T&gt;</c>
    /// generates as <c>CommandResultOf</c>), so a cref cannot be echoed
    /// verbatim.
    /// </summary>
    private readonly Dictionary<string, string> _exportedTypes =
        new Dictionary<string, string>(StringComparer.Ordinal);

    /// <summary>
    /// Exported type name -> the member identifiers emitted under it, exactly as
    /// written. Properties are camelCased on the way out and enum values are
    /// not, so a member cref is checked against what the file actually says
    /// rather than against a convention.
    /// </summary>
    private readonly Dictionary<string, HashSet<string>> _exportedMembers =
        new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

    /// <summary>
    /// Exported generic interface -> C# type parameter -> the word the SDK
    /// writes in its place. C# spells a type parameter <c>T</c> or
    /// <c>TArgs</c> by convention; an author hovering the TypeScript should read
    /// what the parameter is, not a letter the docs then have to explain.
    /// </summary>
    private static readonly Dictionary<string, Dictionary<string, string>> TypeParameterWords =
        new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal)
        {
            ["StreamData"] = new Dictionary<string, string> { ["T"] = "Payload" },
            ["CommandRequest"] = new Dictionary<string, string> { ["TArgs"] = "Args" },
            ["CommandResponse"] = new Dictionary<string, string> { ["TResult"] = "Result" },
            ["CommandResultOf"] = new Dictionary<string, string> { ["T"] = "Payload" },
        };

    private static readonly Regex Word = new Regex(@"\b\w+\b", RegexOptions.CultureInvariant);

    private Dictionary<string, string>? _typeParameters;

    private bool _collected;
    private int _blocks;
    private int _pointers;
    private int _demoted;

    public RtDocVisitor(TextWriter writer, ExportContext exportContext)
        : base(writer, exportContext)
    {
    }

    /// <summary>
    /// Collects what this file exports before a line of it is written. A cref
    /// can point forward as easily as back, so the set has to be complete before
    /// the first doc block is judged against it.
    /// </summary>
    public override void VisitFile(ExportedFile file)
    {
        Collect(file);
        base.VisitFile(file);
        // Printed for the same reason the unit pass prints its own count: a
        // carrier that silently carried nothing looks exactly like one that had
        // nothing to carry, and the demoted figure is the one worth watching,
        // because it counts the places the prose names something the reader
        // cannot open.
        Console.WriteLine(
            $"codegen (docs) -> {_blocks} declarations documented, "
            + $"{_pointers} crefs carried as pointers, {_demoted} as prose, "
            + $"{RtDocText.InternalBlocksStripped} <{RtDocText.InternalElement}> blocks withheld, "
            + $"{RtDocText.CategoriesCarried} <{RtDocText.CategoryElement}>s carried, "
            + $"{RtDocText.CategoryDescriptionsCarried} <{RtDocText.CategoryDescriptionElement}>s carried");
    }

    public override void Visit(RtJsdocNode node)
    {
        if (node == null) return;
        var lines = RtDocText.ToDocLines(
            node.Description ?? string.Empty, RenderCref, out var category, out var categoryDescription);
        if (lines.Count == 0 && node.TagToDescription.Count == 0 && category == null) return;
        _blocks++;

        if (lines.Count == 1 && node.TagToDescription.Count == 0 && category == null)
        {
            AppendTabs();
            Write("/** ");
            Write(lines[0]);
            WriteLine(" */");
            return;
        }

        AppendTabs();
        WriteLine("/**");
        foreach (var line in lines)
        {
            AppendTabs();
            WriteLine(line.Length == 0 ? "*" : "* " + line);
        }
        if (lines.Count > 0 && (node.TagToDescription.Count > 0 || category != null))
        {
            AppendTabs();
            WriteLine("*");
        }
        foreach (var tag in node.TagToDescription) DocTag(tag.Item1, tag.Item2);
        if (category != null)
        {
            AppendTabs();
            WriteLine("* @category " + category);
        }
        if (categoryDescription.Count > 0)
        {
            AppendTabs();
            WriteLine("* @categoryDescription " + category);
            foreach (var line in categoryDescription)
            {
                AppendTabs();
                WriteLine(line.Length == 0 ? "*" : "* " + line);
            }
        }
        AppendTabs();
        WriteLine("*/");
    }

    public override void Visit(RtInterface node)
    {
        if (node == null) return;
        TypeParameterWords.TryGetValue(node.Name?.TypeName ?? string.Empty, out _typeParameters);
        base.Visit(node);
        _typeParameters = null;
    }

    /// <summary>
    /// Writes a type parameter of the interface being written under its word.
    /// A retyped field arrives as one composed name (<c>T | null</c>), so the
    /// swap is per word rather than per node.
    /// </summary>
    public override void Visit(RtSimpleTypeName node)
    {
        if (_typeParameters == null || node == null || node.HasPrefix || node.TypeName == null)
        {
            base.Visit(node);
            return;
        }
        var parameters = _typeParameters;
        Write(Word.Replace(node.TypeName, m => parameters.TryGetValue(m.Value, out var word) ? word : m.Value));
        if (node.GenericArguments.Length == 0) return;
        Write("<");
        SequentialVisit(node.GenericArguments, ", ");
        Write(">");
    }

    private void Collect(ExportedFile file)
    {
        if (_collected) return;
        _collected = true;

        foreach (var ns in file.Namespaces)
        {
            foreach (var unit in ns.CompilationUnits)
            {
                switch (unit)
                {
                    case RtInterface iface:
                        Members(iface.Name, iface.Members);
                        break;
                    case RtClass cls:
                        Members(cls.Name, cls.Members);
                        break;
                    case RtEnum en:
                        EnumValues(en);
                        break;
                }
            }
        }

        // The bridge from a cref's C# name to the emitted one. `TypeResolver` is
        // the same resolver the file's own type references went through, so the
        // mapping is RT's answer rather than a second guess at it.
        //
        // Sorted, and taking the name-for-name match first, because two C# types
        // can share a simple name: `CommandResult` and `CommandResult<T>` both
        // key on `CommandResult` while the generic one emits as
        // `CommandResultOf`. If whichever landed last won, a cref to
        // `CommandResult.ErrorCode` would look up the generic's members, find no
        // such field, and degrade to prose; and `HashSet` order is not something
        // a generated file should rest on.
        var exportable = new List<Type>(file.TypesToExport);
        exportable.Sort((a, b) => string.CompareOrdinal(a.FullName, b.FullName));
        foreach (var pass in new[] { true, false })
        {
            foreach (var type in exportable)
            {
                var simple = Simple(type);
                var emitted = Resolve(file, type);
                if (emitted == null || !_exportedMembers.ContainsKey(emitted)) continue;
                if (pass != (emitted == simple)) continue;
                if (!_exportedTypes.ContainsKey(simple)) _exportedTypes[simple] = emitted;
            }
        }

        // Types the SDK exports from a file this run is not writing: an Uplink
        // slice's docs cref core contract types, and an Uplink client depends on
        // the published SDK, so those are reachable even though they are absent
        // here. Recognised by the codegen attributes, which is the same signal
        // that put them on the wire surface in the first place.
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            var name = assembly.GetName().Name;
            if (name == null || !name.EndsWith(".Contract", StringComparison.Ordinal)) continue;
            foreach (var type in SafeTypes(assembly))
            {
                var isInterface = type.GetCustomAttribute<TsInterfaceAttribute>() != null;
                var isEnum = type.GetCustomAttribute<TsEnumAttribute>() != null;
                if (!isInterface && !isEnum) continue;
                var simple = Simple(type);
                if (_exportedTypes.ContainsKey(simple)) continue;
                _exportedTypes[simple] = simple;
                _exportedMembers[simple] = ReflectedMembers(type, isEnum);
            }

            // Error-code holders are emitted into error-codes.ts, which the SDK
            // exports, as const objects keyed by the C# field names.
            foreach (var type in SafeTypes(assembly))
            {
                var refusals = ErrorCodeCatalog.NamedFieldsOf<RefusalCode>(type);
                var faults = ErrorCodeCatalog.NamedFieldsOf<FaultCode>(type);
                if (refusals.Count == 0 && faults.Count == 0) continue;
                var simple = Simple(type);
                if (_exportedTypes.ContainsKey(simple)) continue;
                _exportedTypes[simple] = simple;
                var set = new HashSet<string>(StringComparer.Ordinal);
                foreach (var (field, _) in refusals) set.Add(field);
                foreach (var (field, _) in faults) set.Add(field);
                _exportedMembers[simple] = set;
            }
        }
    }

    private void Members(RtSimpleTypeName name, IEnumerable<RtNode> members)
    {
        if (name?.TypeName == null) return;
        var set = Set(name.TypeName);
        foreach (var member in members)
        {
            if (member is RtField field && field.Identifier?.IdentifierName != null)
                set.Add(field.Identifier.IdentifierName);
        }
    }

    private void EnumValues(RtEnum en)
    {
        if (en.EnumName?.TypeName == null) return;
        var set = Set(en.EnumName.TypeName);
        foreach (var value in en.Values)
        {
            if (value.EnumValueName != null) set.Add(value.EnumValueName);
        }
    }

    private HashSet<string> Set(string typeName)
    {
        if (!_exportedMembers.TryGetValue(typeName, out var set))
        {
            set = new HashSet<string>(StringComparer.Ordinal);
            _exportedMembers[typeName] = set;
        }
        return set;
    }

    private static string Resolve(ExportedFile file, Type type)
    {
        try
        {
            return file.TypeResolver.ResolveTypeName(type) is RtSimpleTypeName simple
                ? simple.TypeName
                : null;
        }
        catch (Exception)
        {
            // A type the resolver cannot name is one no doc can point at, which
            // is the answer this method exists to produce.
            return null;
        }
    }

    private static IEnumerable<Type> SafeTypes(Assembly assembly)
    {
        try { return assembly.GetTypes(); }
        catch (ReflectionTypeLoadException e)
        {
            var loaded = new List<Type>();
            foreach (var type in e.Types) if (type != null) loaded.Add(type);
            return loaded;
        }
    }

    private HashSet<string> ReflectedMembers(Type type, bool isEnum)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        if (isEnum)
        {
            foreach (var value in Enum.GetNames(type)) set.Add(value);
            return set;
        }
        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            set.Add(ExportContext.Global.CamelCaseForProperties
                ? TypeBlueprint.ConvertToCamelCase(property.Name)
                : property.Name);
        }
        return set;
    }

    private static string Simple(Type type)
    {
        var name = type.Name;
        var arity = name.IndexOf('`');
        return arity >= 0 ? name.Substring(0, arity) : name;
    }

    /// <summary>
    /// One <c>see cref</c>, rendered for a reader who has the SDK and nothing
    /// else. Backticks mean "you can import this and read its declaration";
    /// anything else is written as prose.
    /// </summary>
    private string RenderCref(string cref)
    {
        if (RtDocText.IsUnresolvedCref(cref))
        {
            _demoted++;
            var stale = RtDocText.CrefSegments(cref);
            return stale.Length == 0 ? string.Empty : stale[stale.Length - 1];
        }

        var segments = RtDocText.CrefSegments(cref);
        if (segments.Length == 0) return string.Empty;

        var kind = cref.Length > 1 && cref[1] == ':' ? cref[0] : 'T';
        var last = segments[segments.Length - 1];

        if (kind == 'T' || kind == 'N')
        {
            if (_exportedTypes.TryGetValue(last, out var exported))
            {
                _pointers++;
                return "`" + exported + "`";
            }
            _demoted++;
            return last;
        }

        var owner = segments.Length >= 2 ? segments[segments.Length - 2] : null;
        if (owner != null
            && _exportedTypes.TryGetValue(owner, out var exportedOwner)
            && _exportedMembers.TryGetValue(exportedOwner, out var members))
        {
            if (members.Contains(last))
            {
                _pointers++;
                return "`" + exportedOwner + "." + last + "`";
            }
            var camel = TypeBlueprint.ConvertToCamelCase(last);
            if (members.Contains(camel))
            {
                _pointers++;
                return "`" + exportedOwner + "." + camel + "`";
            }
        }
        _demoted++;
        return owner == null ? last : owner + "." + last;
    }
}
#endif
