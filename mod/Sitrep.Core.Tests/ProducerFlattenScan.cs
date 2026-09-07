using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace Sitrep.Core.Tests
{
    /// <summary>One C# source file, as the scan reads it.</summary>
    internal sealed class ScannedSource
    {
        public ScannedSource(string path, string text)
        {
            Path = path;
            Text = text;
        }

        /// <summary>Repo-relative, so a failure message names a file a reader can open.</summary>
        public string Path { get; }

        public string Text { get; }
    }

    /// <summary>
    /// One method that hand-flattens a contract type into the untyped wire
    /// dictionary, and every string literal its body mentions.
    /// </summary>
    internal sealed class FlattenProducer
    {
        public FlattenProducer(
            string typeName, string method, string? owner, string file, IReadOnlyCollection<string> literals)
        {
            TypeName = typeName;
            Method = method;
            Owner = owner;
            File = file;
            Literals = literals;
        }

        /// <summary>The contract type this producer stands for.</summary>
        public string TypeName { get; }

        public string Method { get; }

        public string? Owner { get; }

        public string File { get; }

        /// <summary>
        /// Every string literal in the method body. See
        /// <see cref="ProducerFlattenScan"/>'s doc comment for why the whole set
        /// rather than the keys in write position.
        /// </summary>
        public IReadOnlyCollection<string> Literals { get; }

        public override string ToString() =>
            (Owner is null ? Method : Owner + "." + Method) + " (" + File + ")";
    }

    /// <summary>
    /// Finds the mod's HAND-FLATTENING producers by reading its C# sources, and
    /// says which contract type each one stands for.
    ///
    /// <para><b>Why a source scan and not reflection.</b> The producer whose
    /// omission this exists for lives in <c>Gonogo.KSP.KspHost</c>, which
    /// references KSP and Unity: it is not in <c>mod/Gonogo.sln</c>'s test set,
    /// CI cannot build it without the private reference-assembly checkout, and
    /// nothing can load it into a net10.0 test process. A gate that can only see
    /// the loadable half cannot see the file the bug was in. Invoking a producer
    /// with a populated instance would grade behaviour rather than text and is
    /// the better instrument where it reaches, but it reaches
    /// <c>Sitrep.Host</c> only.</para>
    ///
    /// <para><b>What counts as a producer.</b> A method whose body constructs a
    /// <c>Dictionary&lt;string, object?&gt;</c> and that names a contract type in
    /// one of two ways:</para>
    /// <list type="number">
    /// <item>it RECEIVES one: <c>ToWire(VesselOrbit orbit)</c>,
    /// <c>BuildManeuverNodes(IList&lt;ManeuverNode&gt; plan)</c>. The strongest
    /// evidence there is, and it is read off the FIRST parameter only, the same
    /// convention <c>scripts/wire-payload-coverage.mjs</c> uses.</item>
    /// <item>it sits in a WIRE-PRODUCING class and names one:
    /// <c>CareerViewProvider.BuildEconomy</c> (owner prefix + method stem),
    /// <c>FleetVesselLinkBuilder.Build</c> (owner prefix alone),
    /// <c>ScienceViewProvider.BuildArchiveEntry</c> (method stem).</item>
    /// </list>
    ///
    /// <para>The wire-producing-class condition is load-bearing rather than
    /// decoration. Without it <c>Gonogo.KSP.KspHost.BuildBodyEntry</c> and
    /// <c>BuildVesselRosterEntry</c> are read as producers for
    /// <c>BodyEntry</c>/<c>VesselRosterEntry</c>, and they are not: they build the
    /// INTERNAL capture snapshot, whose key set deliberately differs from the wire
    /// (a body's atmosphere is flat there and nested on the wire, a roster
    /// vessel's orbit likewise), and <c>SystemViewProvider</c> is what turns one
    /// into the other. Measured: both produced a confident, wrong failure before
    /// the condition was added.</para>
    ///
    /// <para><b>Keys are every string literal in the body, deliberately.</b> Not
    /// the literals in write position. A producer legitimately spells a key
    /// somewhere other than a <c>["k"] =</c>:
    /// <c>CareerViewProvider.BuildEconomy</c> passes nine of its keys as
    /// ARGUMENTS to <c>CarryIfPresent</c>, and two more to <c>CarryUpkeep</c>,
    /// which writes the nested dictionary in a sibling method. Reading write
    /// position only reported eleven omissions there, all false. So the question
    /// this asks is the weaker and answerable one: does the producer MENTION the
    /// field at all. A field whose name appears nowhere in the method that stands
    /// for its type cannot be on the wire, which is exactly the bug class, and a
    /// generous reading is the right direction to be wrong in when there is no
    /// allowlist to park a false failure in.</para>
    /// </summary>
    internal static class ProducerFlattenScan
    {
        /// <summary>The untyped wire dictionary, in the spellings the mod uses.</summary>
        private static readonly Regex WireDictionary = new(
            @"new\s+Dictionary\s*<\s*string\s*,\s*object\s*\??\s*>", RegexOptions.Compiled);

        /// <summary>
        /// A method declaration: at least one modifier, a return type, a name, an
        /// open paren. Every producer in the tree carries a modifier, so requiring
        /// one keeps local functions and control-flow keywords out without a
        /// keyword blacklist.
        /// </summary>
        private static readonly Regex Declaration = new(
            @"(?:^|[;{}\n])[ \t]*"
                + @"(?:(?:public|private|protected|internal|static|sealed|override|virtual|async|new|partial|extern|unsafe)[ \t]+)+"
                + @"(?<ret>[A-Za-z_][\w.]*(?:<[^;{}()]*>)?\??(?:\[\])?)[ \t]+"
                + @"(?<name>[A-Za-z_]\w*)[ \t]*(?:<[^;{}()]*>)?[ \t]*\(",
            RegexOptions.Compiled);

        private static readonly Regex TypeDeclaration = new(
            @"\b(?:class|struct|record)\s+(?<name>[A-Za-z_]\w*)", RegexOptions.Compiled);

        private static readonly Regex Capitalised = new(@"[A-Z][A-Za-z0-9_]*", RegexOptions.Compiled);

        private static readonly Regex StringLiteral = new(@"""([^""\\\n]*)""", RegexOptions.Compiled);

        /// <summary>
        /// Class-name suffixes that mark a class as a producer of WIRE
        /// dictionaries rather than of the internal capture snapshot. Stripping
        /// one yields the prefix half of the composed subject:
        /// <c>CareerViewProvider</c> -> <c>Career</c>, so <c>BuildEconomy</c>
        /// claims <c>CareerEconomy</c>.
        /// </summary>
        private static readonly string[] WireOwnerSuffixes =
        {
            "ViewProvider", "Provider", "Builder", "Wire", "Writer", "Flattener",
            "Payload", "Uplink", "Capture", "Channels",
        };

        /// <summary>The verbs the mod's flatteners are named with.</summary>
        private static readonly string[] Verbs = { "ToWire", "Build", "Write", "Flatten", "Wire", "Map", "Make" };

        /// <summary>
        /// Every production C# file under <paramref name="modDir"/>: the whole
        /// mod minus its test projects. A type flattened only by a test fixture is
        /// flattened by nobody, and counting one would let a fixture vouch for a
        /// producer that does not exist.
        /// </summary>
        public static IReadOnlyList<ScannedSource> ProductionSources(string modDir)
        {
            var sources = new List<ScannedSource>();
            foreach (var file in Directory.EnumerateFiles(modDir, "*.cs", SearchOption.AllDirectories))
            {
                var relative = System.IO.Path.GetRelativePath(modDir, file).Replace('\\', '/');
                // Any project directory ENDING in Tests, not just `.Tests`:
                // Sitrep.Host.IntegrationTests is one. Plus build output, which
                // holds generated copies of the same sources.
                if (relative.Split('/').Any(segment =>
                        segment.EndsWith("Tests", StringComparison.Ordinal)
                        || segment.Equals("obj", StringComparison.Ordinal)
                        || segment.Equals("bin", StringComparison.Ordinal)
                        || segment.Contains("TestSupport", StringComparison.Ordinal)))
                {
                    continue;
                }
                if (relative.EndsWith("Tests.cs", StringComparison.Ordinal)
                    || relative.EndsWith("Test.cs", StringComparison.Ordinal))
                {
                    continue;
                }
                sources.Add(new ScannedSource("mod/" + relative, File.ReadAllText(file)));
            }

            if (sources.Count == 0)
            {
                throw new InvalidOperationException(
                    "ProducerFlattenScan: no production C# found under " + modDir
                        + ". The scan would report a clean tree over nothing.");
            }

            return sources;
        }

        /// <summary>
        /// Every hand-flattening producer in <paramref name="files"/> whose
        /// subject is one of <paramref name="contractTypes"/>.
        ///
        /// <para>A pure function over file contents, so the self-check can run a
        /// planted producer through the identical code path rather than through a
        /// second copy of these rules.</para>
        /// </summary>
        public static IReadOnlyList<FlattenProducer> Scan(
            IEnumerable<ScannedSource> files, ISet<string> contractTypes)
        {
            var found = new List<FlattenProducer>();
            foreach (var source in files)
            {
                if (!WireDictionary.IsMatch(source.Text))
                {
                    continue;
                }

                var structure = Mask(source.Text, blankStrings: true);
                var code = Mask(source.Text, blankStrings: false);
                var owners = TypeBlocks(structure);

                foreach (var method in Methods(structure, owners))
                {
                    if (!WireDictionary.IsMatch(structure.Substring(method.BodyStart, method.BodyLength)))
                    {
                        continue;
                    }

                    var literals = new HashSet<string>(StringComparer.Ordinal);
                    foreach (Match literal in StringLiteral.Matches(
                                 code.Substring(method.BodyStart, method.BodyLength)))
                    {
                        literals.Add(literal.Groups[1].Value);
                    }

                    foreach (var subject in Subjects(method, contractTypes))
                    {
                        found.Add(new FlattenProducer(
                            subject, method.Name, method.Owner, source.Path, literals));
                    }
                }
            }
            return found;
        }

        /// <summary>
        /// The contract types <paramref name="method"/> stands for.
        ///
        /// <para>A contract type in the FIRST parameter settles it, and the
        /// name-derived rules are then not consulted at all. Both halves of that
        /// matter. A method handed the type IS its flattener, so nothing weaker
        /// should be able to add a second subject to it; and without the
        /// cut-off, every one of <c>VesselPartsViewProvider</c>'s eight
        /// <c>ToWire</c> overloads ALSO claims <c>VesselParts</c> through the
        /// owner prefix, so seven producers of other types end up graded against
        /// a type they merely nest inside.</para>
        ///
        /// <para>The first parameter and no other. A second contract-typed
        /// parameter is something the method READS (a <c>PayloadMeta</c> to
        /// stamp, a config to consult), and grading against it would fail a
        /// producer for not re-emitting a value it was merely handed. Same
        /// convention <c>scripts/wire-payload-coverage.mjs</c> uses.</para>
        /// </summary>
        private static IEnumerable<string> Subjects(ScannedMethod method, ISet<string> contractTypes)
        {
            var fromParameter = new List<string>();
            foreach (Match match in Capitalised.Matches(method.Parameters.Split(',')[0]))
            {
                if (contractTypes.Contains(match.Value))
                {
                    fromParameter.Add(match.Value);
                }
            }
            if (fromParameter.Count > 0)
            {
                return fromParameter.Distinct(StringComparer.Ordinal);
            }

            var subjects = new List<string>();
            var stems = new List<string>();
            foreach (var verb in Verbs)
            {
                if (method.Name.StartsWith(verb, StringComparison.Ordinal) && method.Name.Length > verb.Length)
                {
                    stems.Add(method.Name.Substring(verb.Length));
                }
            }

            if (method.Owner != null)
            {
                foreach (var suffix in WireOwnerSuffixes)
                {
                    if (!method.Owner.EndsWith(suffix, StringComparison.Ordinal)
                        || method.Owner.Length <= suffix.Length)
                    {
                        continue;
                    }
                    var prefix = method.Owner.Substring(0, method.Owner.Length - suffix.Length);
                    // The class's own name speaks for a method that is the whole
                    // flatten and nothing else: `FleetVesselLinkBuilder.Build`.
                    // A method with a name of its own inside the same class is
                    // doing a PART of the job, and grading it against the whole
                    // type fails it for the rest: `FleetVesselResourcesBuilder`
                    // has an `Add` that folds one part's tanks into the running
                    // map, and it was read as owing the payload's `resources`
                    // key, which its sibling `Build` writes.
                    if (Verbs.Contains(method.Name, StringComparer.Ordinal))
                    {
                        subjects.Add(prefix);
                    }
                    foreach (var stem in stems)
                    {
                        subjects.Add(prefix + stem);
                        subjects.Add(stem);
                    }
                }
            }

            return subjects.Where(contractTypes.Contains).Distinct(StringComparer.Ordinal);
        }

        // ----------------------------------------------------------------
        // structure
        // ----------------------------------------------------------------

        internal sealed class ScannedMethod
        {
            public ScannedMethod(string name, string parameters, string? owner, int bodyStart, int bodyLength)
            {
                Name = name;
                Parameters = parameters;
                Owner = owner;
                BodyStart = bodyStart;
                BodyLength = bodyLength;
            }

            public string Name { get; }

            public string Parameters { get; }

            public string? Owner { get; }

            public int BodyStart { get; }

            public int BodyLength { get; }
        }

        private sealed class TypeBlock
        {
            public TypeBlock(string name, int open, int close)
            {
                Name = name;
                Open = open;
                Close = close;
            }

            public string Name { get; }

            public int Open { get; }

            public int Close { get; }
        }

        /// <summary>
        /// <paramref name="text"/> with comments (and optionally string and char
        /// literals) blanked to spaces, LENGTH PRESERVED so an offset means the
        /// same thing in both variants. The structure variant is what brace
        /// matching and the declaration regex read; the code variant keeps the
        /// literals a producer's keys are.
        /// </summary>
        internal static string Mask(string text, bool blankStrings)
        {
            var buffer = new StringBuilder(text);
            var i = 0;
            var n = text.Length;
            void Blank(int count)
            {
                for (var k = 0; k < count && i < n; k++)
                {
                    buffer[i++] = ' ';
                }
            }

            while (i < n)
            {
                var c = text[i];
                var d = i + 1 < n ? text[i + 1] : '\0';
                if (c == '/' && d == '/')
                {
                    while (i < n && text[i] != '\n')
                    {
                        buffer[i++] = ' ';
                    }
                    continue;
                }
                if (c == '/' && d == '*')
                {
                    Blank(2);
                    while (i < n && !(text[i] == '*' && i + 1 < n && text[i + 1] == '/'))
                    {
                        buffer[i++] = ' ';
                    }
                    Blank(2);
                    continue;
                }
                if ((c == '@' || c == '$') && d == '"')
                {
                    // A verbatim or interpolated string. Always blanked, in both
                    // variants: no producer spells a wire key in one, and their
                    // escaping rules differ enough that keeping them would be a
                    // second parser.
                    Blank(2);
                    while (i < n)
                    {
                        if (text[i] == '"' && i + 1 < n && text[i + 1] == '"')
                        {
                            Blank(2);
                            continue;
                        }
                        if (text[i] == '"')
                        {
                            break;
                        }
                        buffer[i++] = ' ';
                    }
                    Blank(1);
                    continue;
                }
                if (c == '"' || c == '\'')
                {
                    var quote = c;
                    var start = i;
                    i++;
                    while (i < n && text[i] != quote)
                    {
                        if (text[i] == '\\')
                        {
                            i++;
                        }
                        i++;
                    }
                    if (i < n)
                    {
                        i++;
                    }
                    if (blankStrings)
                    {
                        for (var k = start; k < i; k++)
                        {
                            buffer[k] = ' ';
                        }
                    }
                    continue;
                }
                i++;
            }
            return buffer.ToString();
        }

        private static int MatchDelimiter(string masked, int at, char open, char close)
        {
            var depth = 0;
            for (var i = at; i < masked.Length; i++)
            {
                if (masked[i] == open)
                {
                    depth++;
                }
                else if (masked[i] == close)
                {
                    depth--;
                    if (depth == 0)
                    {
                        return i;
                    }
                }
            }
            return -1;
        }

        private static IReadOnlyList<TypeBlock> TypeBlocks(string structure)
        {
            var blocks = new List<TypeBlock>();
            foreach (Match match in TypeDeclaration.Matches(structure))
            {
                var brace = structure.IndexOf('{', match.Index);
                if (brace < 0)
                {
                    continue;
                }
                var close = MatchDelimiter(structure, brace, '{', '}');
                blocks.Add(new TypeBlock(match.Groups["name"].Value, brace, close < 0 ? structure.Length : close));
            }
            return blocks;
        }

        /// <summary>
        /// Every method declaration in <paramref name="structure"/>, with its body
        /// extent. Both body forms are handled: an expression-bodied member is not
        /// an edge case here, it is how the whole
        /// <c>VesselViewProvider.ToWire</c> family is written, and reading only
        /// block bodies found 25 of the tree's 255 flatteners.
        /// </summary>
        private static IEnumerable<ScannedMethod> Methods(
            string structure, IReadOnlyList<TypeBlock>? owners = null)
        {
            owners ??= TypeBlocks(structure);
            foreach (Match match in Declaration.Matches(structure))
            {
                var parenOpen = match.Index + match.Length - 1;
                var parenClose = MatchDelimiter(structure, parenOpen, '(', ')');
                if (parenClose < 0)
                {
                    continue;
                }

                var i = parenClose + 1;
                while (i < structure.Length && char.IsWhiteSpace(structure[i]))
                {
                    i++;
                }
                if (structure.AsSpan(i).StartsWith("where"))
                {
                    var brace = structure.IndexOf('{', i);
                    var arrow = structure.IndexOf("=>", i, StringComparison.Ordinal);
                    i = brace >= 0 && (arrow < 0 || brace < arrow) ? brace : arrow;
                    if (i < 0)
                    {
                        continue;
                    }
                }

                int start;
                int end;
                if (i < structure.Length && structure[i] == '{')
                {
                    start = i;
                    end = MatchDelimiter(structure, i, '{', '}');
                    if (end < 0)
                    {
                        continue;
                    }
                }
                else if (i + 1 < structure.Length && structure[i] == '=' && structure[i + 1] == '>')
                {
                    start = i + 2;
                    end = -1;
                    var depth = 0;
                    for (var j = start; j < structure.Length; j++)
                    {
                        var c = structure[j];
                        if (c == '{' || c == '(' || c == '[')
                        {
                            depth++;
                        }
                        else if (c == '}' || c == ')' || c == ']')
                        {
                            depth--;
                        }
                        else if (c == ';' && depth == 0)
                        {
                            end = j;
                            break;
                        }
                    }
                    if (end < 0)
                    {
                        continue;
                    }
                }
                else
                {
                    continue;
                }

                var owner = owners
                    .Where(block => block.Open < match.Index && block.Close > match.Index)
                    .OrderByDescending(block => block.Open)
                    .FirstOrDefault();

                yield return new ScannedMethod(
                    match.Groups["name"].Value,
                    structure.Substring(parenOpen + 1, parenClose - parenOpen - 1),
                    owner?.Name,
                    start,
                    end - start + 1);
            }
        }
    }
}
