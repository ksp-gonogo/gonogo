using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace Sitrep.Core.Tests
{
    /// <summary>One command name or topic as the source writes it, with where it was written.</summary>
    internal sealed class WiringUse
    {
        public WiringUse(string expression, string? value, string file, int index, int line)
        {
            Expression = expression;
            Value = value;
            File = file;
            Index = index;
            Line = line;
        }

        /// <summary>The argument exactly as written, e.g. <c>SomeUplinkChannels.RunCommand</c>.</summary>
        public string Expression { get; }

        /// <summary>The string it resolves to, or null when the walk could not resolve it.</summary>
        public string? Value { get; }

        public string File { get; }

        /// <summary>
        /// Where <see cref="Expression"/> starts in the file's stripped text, so a
        /// caller can rewrite exactly this occurrence. A line number is not enough
        /// to plant a violation with: both sides of a pairing usually name the same
        /// const, and RP-1 writes two command names inside one <c>foreach</c> array
        /// whose elements are read from a call several lines below them.
        /// </summary>
        public int Index { get; }

        public int Line { get; }

        public override string ToString() =>
            (Value is null ? Expression : $"\"{Value}\" ({Expression})") + $" at {File}:{Line}";
    }

    /// <summary>What one Uplink's source declares and what it registers.</summary>
    internal sealed class UplinkWiring
    {
        public UplinkWiring(
            string name,
            IReadOnlyList<WiringUse> registeredCommands,
            IReadOnlyList<WiringUse> declaredCommands,
            IReadOnlyList<WiringUse> publishedTopics,
            IReadOnlyList<WiringUse> declaredTopics,
            IReadOnlyList<WiringUse> offHostCalls)
        {
            Name = name;
            RegisteredCommands = registeredCommands;
            DeclaredCommands = declaredCommands;
            PublishedTopics = publishedTopics;
            DeclaredTopics = declaredTopics;
            OffHostCalls = offHostCalls;
        }

        public string Name { get; }

        /// <summary>Every <c>host.AddCommandHandler</c> / <c>host.AddVantageCommandHandler</c>.</summary>
        public IReadOnlyList<WiringUse> RegisteredCommands { get; }

        /// <summary>Every <c>CommandDeclaration</c> the manifest builds.</summary>
        public IReadOnlyList<WiringUse> DeclaredCommands { get; }

        /// <summary>Every <c>host.Publisher</c> / <c>host.AddChannelSource</c>.</summary>
        public IReadOnlyList<WiringUse> PublishedTopics { get; }

        /// <summary>Every <c>ChannelDeclaration</c> the manifest builds that names a topic.</summary>
        public IReadOnlyList<WiringUse> DeclaredTopics { get; }

        /// <summary>
        /// Registration calls written on a receiver other than the <c>host</c>
        /// parameter, which the walk reads nothing from. There is no legitimate
        /// one: an Uplink that stashed the host in a field and called
        /// <c>_host.AddCommandHandler</c> would register commands this walk never
        /// sees, and it would report no violation, which is exactly the shape of
        /// hole this file exists to close.
        /// </summary>
        public IReadOnlyList<WiringUse> OffHostCalls { get; }

        /// <summary>Registered commands with no matching declaration, by resolved value.</summary>
        public IReadOnlyList<WiringUse> UndeclaredCommands => Missing(RegisteredCommands, DeclaredCommands);

        /// <summary>Published topics with no matching declaration, by resolved value.</summary>
        public IReadOnlyList<WiringUse> UndeclaredTopics => Missing(PublishedTopics, DeclaredTopics);

        /// <summary>
        /// Declared commands nothing registers a handler for. The other direction
        /// of the same pairing, and a quieter defect than an undeclared
        /// registration: the manifest advertises the command, the client renders a
        /// control for it, and the press is answered by the engine's "no handler"
        /// rather than by the Uplink.
        /// </summary>
        public IReadOnlyList<WiringUse> UnregisteredCommands => Missing(DeclaredCommands, RegisteredCommands);

        /// <summary>
        /// Declared channels nothing publishes to. The subscribe is accepted and
        /// then never produces a value, so the widget reading it holds an empty
        /// reading for the life of the session with nothing logged anywhere.
        /// </summary>
        public IReadOnlyList<WiringUse> UnpublishedTopics => Missing(DeclaredTopics, PublishedTopics);

        /// <summary>
        /// Every name on either side the walk read but could not turn into a
        /// string. The walk compares VALUES, so an unresolved name is not a
        /// violation, it is a hole: it would drop out of both sides and the
        /// comparison would report nothing about it.
        /// </summary>
        public IReadOnlyList<WiringUse> Unresolved =>
            RegisteredCommands.Concat(DeclaredCommands)
                .Concat(PublishedTopics).Concat(DeclaredTopics)
                .Where(u => u.Value is null)
                .ToList();

        /// <summary>
        /// The names on <paramref name="one"/> side of the pairing that the
        /// <paramref name="other"/> side does not carry, one entry per distinct
        /// value. Runs in both directions: an unresolved name is on neither side,
        /// which <see cref="Unresolved"/> reports separately.
        /// </summary>
        private static IReadOnlyList<WiringUse> Missing(
            IReadOnlyList<WiringUse> one, IReadOnlyList<WiringUse> other)
        {
            var names = new HashSet<string>(
                other.Where(d => d.Value is not null).Select(d => d.Value!), StringComparer.Ordinal);

            return one
                .Where(u => u.Value is not null && !names.Contains(u.Value))
                .GroupBy(u => u.Value!, StringComparer.Ordinal)
                .Select(g => g.First())
                .OrderBy(u => u.Value, StringComparer.Ordinal)
                .ToList();
        }
    }

    /// <summary>
    /// Reads an Uplink's C# source and pairs the names it REGISTERS against the
    /// names it DECLARES.
    ///
    /// <para><b>Why source rather than calling Register.</b> The obvious form is to
    /// hand the Uplink a recording host and compare what it asked for against its
    /// manifest, which is what <c>Sitrep.Contract.TestSupport.CommandRegistrationAssertion</c>
    /// does. That form only sees what the headless test build can RUN, and on most
    /// Uplinks here it runs nothing: several keep their whole registration body in
    /// a <c>.Ksp.cs</c> half the test csproj
    /// deliberately excludes, so <c>Register</c> forwards to an unimplemented
    /// <c>partial void</c> and compiles away to nothing, and the Uplinks that gate
    /// registration on a reflection probe of an absent mod return early. Both pass
    /// against an Uplink whose wiring is entirely missing. Source is the only place
    /// both halves of the pairing are visible at once.</para>
    ///
    /// <para><b>Why it resolves values rather than comparing symbols.</b>
    /// Registration and declaration usually name the same const, so comparing the
    /// expressions as written would agree by construction, including when one side
    /// writes a literal and the other a const with a different value. The walk
    /// resolves each name to the string it actually carries, and reports anything
    /// it cannot resolve rather than dropping it.</para>
    ///
    /// <para><b>THIS FILE IS VENDORED, and a copy of it is pinned by content
    /// elsewhere.</b> Uplinks that leave this repo leave the reach of the walk that
    /// enrols them by their living under <c>mod/</c>, so the repo they move to runs
    /// this same walk over its own layout, from a byte-for-byte copy differing only
    /// in its namespace line. That is why <see cref="Scan"/> takes the source
    /// DIRECTORIES rather than deriving them: two hand-maintained walks are two
    /// chances for one of them to stop matching <c>host.AddCommandHandler</c>, and
    /// a walk that matches nothing reports a clean repo. Editing this file is fine
    /// and expected; it puts the copy out of date, and the consequence is that the
    /// other repo's own check goes red asking to be re-synced. Nothing here can see
    /// that, so a change that matters to the pairing is worth mentioning where the
    /// Uplinks went.</para>
    /// </summary>
    internal static class UplinkWiringScan
    {
        /// <summary>Where a command handler is asked for.</summary>
        private static readonly string[] RegistrationCalls =
        {
            "host.AddCommandHandler",
            "host.AddVantageCommandHandler",
        };

        /// <summary>
        /// Where a topic is published to. The receiver has to be <c>host</c>: a
        /// <c>Publisher</c> taken off an <c>IDynamicChannelSource</c> field names a
        /// SUB-topic under a namespace whose template was registered with
        /// <c>RegisterDynamicNamespace</c>, and those are correctly absent from
        /// the manifest's channel list.
        /// </summary>
        private static readonly string[] PublishCalls =
        {
            "host.Publisher",
            "host.AddChannelSource",
        };

        /// <summary>
        /// The <c>IUplinkHost</c> members that only ever make sense on the
        /// <c>host</c> parameter itself. <c>Publisher</c> is deliberately absent:
        /// a dynamic channel source offers one too, and those sub-topics are
        /// correctly outside the manifest.
        /// </summary>
        private static readonly string[] HostOnlyMembers =
        {
            "AddCommandHandler",
            "AddVantageCommandHandler",
            "AddChannelSource",
        };

        /// <summary>
        /// Scan one Uplink, over every directory holding its C#: its own project
        /// and, usually, the contract slice its command-name and topic constants
        /// live in. The caller supplies them because the two repos that run this
        /// walk lay an Uplink out differently, and a walk that guesses a layout
        /// finds nothing in the other one and reports it clean.
        ///
        /// <para><paramref name="mutate"/> rewrites a named file's text after
        /// comments are blanked and before names are read, which is how the gate
        /// is made to see a violation that is known to be there. It runs on the
        /// same text the reader sees, so a caller can target one line by the
        /// number the walk reported.</para>
        /// </summary>
        public static UplinkWiring Scan(
            string name, IReadOnlyList<string> directories, Func<string, string, string>? mutate = null)
        {
            var files = Sources(directories, mutate);
            var constants = Constants(files);
            var forwarded = HelperParameters(files, "CommandDeclaration")
                .Concat(HelperParameters(files, "ChannelDeclaration"))
                .ToHashSet(StringComparer.Ordinal);

            var commandHelpers = HelperNames(files, "CommandDeclaration");
            var channelHelpers = HelperNames(files, "ChannelDeclaration");

            var registeredCommands = new List<WiringUse>();
            var publishedTopics = new List<WiringUse>();
            var declaredCommands = new List<WiringUse>();
            var declaredTopics = new List<WiringUse>();
            var offHostCalls = new List<WiringUse>();

            foreach (var (file, text) in files)
            {
                var reader = new NameReader(file, text, constants, forwarded);

                foreach (var member in HostOnlyMembers)
                {
                    offHostCalls.AddRange(reader.CallsNotOn("host", member));
                }

                foreach (var call in RegistrationCalls)
                {
                    registeredCommands.AddRange(reader.FirstArguments(call));
                }

                foreach (var call in PublishCalls)
                {
                    publishedTopics.AddRange(reader.FirstArguments(call));
                }

                declaredCommands.AddRange(reader.InitialiserAssignments("CommandDeclaration", "Command"));
                declaredTopics.AddRange(reader.InitialiserAssignments("ChannelDeclaration", "Topic"));

                foreach (var helper in commandHelpers)
                {
                    declaredCommands.AddRange(reader.FirstArguments(helper));
                }

                foreach (var helper in channelHelpers)
                {
                    declaredTopics.AddRange(reader.FirstArguments(helper));
                }
            }

            return new UplinkWiring(
                name, registeredCommands, declaredCommands, publishedTopics, declaredTopics, offHostCalls);
        }

        /// <summary>
        /// Every hand-written <c>.cs</c> under the given directories, with comments
        /// blanked first: prose quotes these names constantly, and a doc comment
        /// reading "Delayed (uplink to the craft)" is otherwise indistinguishable
        /// from a call to a <c>Delayed(topic)</c> declaration helper.
        /// </summary>
        private static List<(string File, string Text)> Sources(
            IReadOnlyList<string> directories, Func<string, string, string>? mutate)
        {
            return directories
                .Where(Directory.Exists)
                .SelectMany(SourceFiles)
                .OrderBy(f => f, StringComparer.Ordinal)
                .Select(f =>
                {
                    var name = Path.GetFileName(f);
                    var text = StripComments(File.ReadAllText(f));
                    return (name, mutate is null ? text : mutate(name, text));
                })
                .ToList();
        }

        /// <summary>
        /// Every hand-written <c>.cs</c> under a directory, skipping the build
        /// outputs and the TypeScript client's own folder.
        /// </summary>
        internal static IEnumerable<string> SourceFiles(string directory)
        {
            foreach (var file in Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories))
            {
                if (file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
                    file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
                    file.Contains($"{Path.DirectorySeparatorChar}client{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
                {
                    continue;
                }

                yield return file;
            }
        }

        /// <summary>
        /// Every comment replaced by spaces, string and character literals left
        /// alone. Length and newlines are preserved so line numbers stay true.
        /// </summary>
        internal static string StripComments(string text)
        {
            var stripped = new StringBuilder(text.Length);
            var at = 0;

            while (at < text.Length)
            {
                var c = text[at];

                if (c == '"' || c == '\'' || (c == '@' && at + 1 < text.Length && text[at + 1] == '"'))
                {
                    var end = EndOfLiteral(text, at);
                    stripped.Append(text, at, end - at);
                    at = end;
                }
                else if (c == '/' && at + 1 < text.Length && text[at + 1] == '/')
                {
                    while (at < text.Length && text[at] != '\n')
                    {
                        stripped.Append(' ');
                        at++;
                    }
                }
                else if (c == '/' && at + 1 < text.Length && text[at + 1] == '*')
                {
                    var end = text.IndexOf("*/", at + 2, StringComparison.Ordinal);
                    end = end < 0 ? text.Length : end + 2;
                    for (; at < end; at++)
                    {
                        stripped.Append(text[at] == '\n' ? '\n' : ' ');
                    }
                }
                else
                {
                    stripped.Append(c);
                    at++;
                }
            }

            return stripped.ToString();
        }

        /// <summary>One past the end of the literal starting at <paramref name="at"/>.</summary>
        private static int EndOfLiteral(string text, int at)
        {
            if (text[at] == '@')
            {
                for (var i = at + 2; i < text.Length; i++)
                {
                    if (text[i] != '"')
                    {
                        continue;
                    }

                    if (i + 1 < text.Length && text[i + 1] == '"')
                    {
                        i++;
                        continue;
                    }

                    return i + 1;
                }

                return text.Length;
            }

            var quote = text[at];
            for (var i = at + 1; i < text.Length; i++)
            {
                if (text[i] == '\\')
                {
                    i++;
                }
                else if (text[i] == quote || text[i] == '\n')
                {
                    return i + 1;
                }
            }

            return text.Length;
        }

        /// <summary>
        /// <c>const string</c> and <c>static readonly string</c> literals, keyed
        /// both by their bare name and by <c>Type.Name</c>, so a qualified use
        /// resolves even when two types in one Uplink spell a member the same.
        /// </summary>
        private static Dictionary<string, List<string>> Constants(List<(string File, string Text)> files)
        {
            var declaration = new Regex(
                @"\b(?:const|static\s+readonly)\s+string\s+([A-Za-z_]\w*)\s*=\s*""((?:[^""\\]|\\.)*)""",
                RegexOptions.Compiled);
            var type = new Regex(@"\b(?:class|struct|record)\s+([A-Za-z_]\w*)", RegexOptions.Compiled);

            var constants = new Dictionary<string, List<string>>(StringComparer.Ordinal);

            void Add(string key, string value)
            {
                if (!constants.TryGetValue(key, out var values))
                {
                    values = new List<string>();
                    constants[key] = values;
                }

                if (!values.Contains(value, StringComparer.Ordinal))
                {
                    values.Add(value);
                }
            }

            foreach (var (_, text) in files)
            {
                var enclosing = "?";
                foreach (var line in text.Split('\n'))
                {
                    var typeMatch = type.Match(line);
                    if (typeMatch.Success)
                    {
                        enclosing = typeMatch.Groups[1].Value;
                    }

                    var match = declaration.Match(line);
                    if (match.Success)
                    {
                        Add(match.Groups[1].Value, Unescape(match.Groups[2].Value));
                        Add(enclosing + "." + match.Groups[1].Value, Unescape(match.Groups[2].Value));
                    }
                }
            }

            return constants;
        }

        /// <summary>
        /// Methods that BUILD a declaration from a name, e.g.
        /// <c>private static CommandDeclaration Declare(string command)</c>. Their
        /// call sites are declaration sites, which is where the name is written.
        /// </summary>
        private static List<string> HelperNames(List<(string File, string Text)> files, string declarationType)
        {
            var helper = new Regex(
                @"\b(?:static\s+)?" + declarationType + @"\s+([A-Za-z_]\w*)\s*\(\s*string\b",
                RegexOptions.Compiled);

            return files
                .SelectMany(f => helper.Matches(f.Text).Select(m => m.Groups[1].Value))
                .Distinct(StringComparer.Ordinal)
                .ToList();
        }

        /// <summary>
        /// The PARAMETER names those helpers take. Inside a helper body the name is
        /// a parameter rather than a const, and resolving it is neither possible
        /// nor wanted: the real name is at the call site, which is scanned
        /// separately.
        /// </summary>
        private static List<string> HelperParameters(List<(string File, string Text)> files, string declarationType)
        {
            var helper = new Regex(
                @"\b(?:static\s+)?" + declarationType + @"\s+[A-Za-z_]\w*\s*\(\s*string\s+([A-Za-z_]\w*)",
                RegexOptions.Compiled);

            return files
                .SelectMany(f => helper.Matches(f.Text).Select(m => m.Groups[1].Value))
                .Distinct(StringComparer.Ordinal)
                .ToList();
        }

        private static string Unescape(string literal) =>
            literal.Replace("\\\"", "\"", StringComparison.Ordinal)
                .Replace("\\\\", "\\", StringComparison.Ordinal);

        /// <summary>Pulls the names out of one file.</summary>
        private sealed class NameReader
        {
            private static readonly Regex LoopOverArray = new(
                @"foreach\s*\(\s*(?:var|string)\s+([A-Za-z_]\w*)\s+in\s+new\s*(?:string\s*)?\[\s*\]\s*\{([^}]*)\}",
                RegexOptions.Compiled);

            private static readonly Regex TypedParameter = new(
                @"^(?:string|bool|int|long|double|this)\b", RegexOptions.Compiled);

            private static readonly Regex NameExpression = new(
                @"^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$", RegexOptions.Compiled);

            private readonly string _file;
            private readonly string _text;
            private readonly Dictionary<string, List<string>> _constants;
            private readonly HashSet<string> _forwarded;

            /// <summary>
            /// Names a <c>foreach</c> binds over a literal array, mapped to the
            /// elements and to the span of the loop body. RP-1 declares its two
            /// warp commands that way, so without this the loop variable is the
            /// only thing at the declaration site and both commands read as
            /// undeclared. Scoped to the body rather than the file because a
            /// declaration helper elsewhere in the same file often spells its
            /// parameter the same, and an unscoped binding credits that helper with
            /// declaring the loop's names a second time.
            /// </summary>
            private readonly List<(string Name, List<(string Text, int Index)> Elements, int Start, int End)> _loopBindings;

            public NameReader(
                string file,
                string text,
                Dictionary<string, List<string>> constants,
                HashSet<string> forwarded)
            {
                _file = file;
                _text = text;
                _constants = constants;
                _forwarded = forwarded;
                _loopBindings = new List<(string, List<(string, int)>, int, int)>();

                foreach (Match match in LoopOverArray.Matches(text))
                {
                    var body = text.IndexOf('{', match.Index + match.Length);
                    if (body < 0)
                    {
                        continue;
                    }

                    _loopBindings.Add((
                        match.Groups[1].Value,
                        SplitKeepingOffsets(match.Groups[2].Value, match.Groups[2].Index),
                        body,
                        body + Braced(body).Length));
                }
            }

            /// <summary>
            /// The comma-separated elements of an array literal, each with where it
            /// starts in the file, so a plant can rewrite the element rather than
            /// the loop variable that stands for it.
            /// </summary>
            private static List<(string Text, int Index)> SplitKeepingOffsets(string list, int at)
            {
                var elements = new List<(string, int)>();
                var start = 0;

                for (var i = 0; i <= list.Length; i++)
                {
                    if (i < list.Length && list[i] != ',')
                    {
                        continue;
                    }

                    var raw = list.Substring(start, i - start);
                    var lead = raw.Length - raw.TrimStart().Length;
                    var trimmed = raw.Trim();

                    if (trimmed.Length > 0)
                    {
                        elements.Add((trimmed, at + start + lead));
                    }

                    start = i + 1;
                }

                return elements;
            }

            /// <summary>
            /// The first argument of every call to <paramref name="callee"/>,
            /// skipping the method's own declaration (whose "argument" is a typed
            /// parameter).
            /// </summary>
            public List<WiringUse> FirstArguments(string callee)
            {
                var uses = new List<WiringUse>();

                for (var at = _text.IndexOf(callee, StringComparison.Ordinal);
                     at >= 0;
                     at = _text.IndexOf(callee, at + callee.Length, StringComparison.Ordinal))
                {
                    // A longer identifier ending in the same name is a different call.
                    if (at > 0 && (char.IsLetterOrDigit(_text[at - 1]) || _text[at - 1] == '_' || _text[at - 1] == '.'))
                    {
                        continue;
                    }

                    var after = at + callee.Length;
                    if (after < _text.Length && (char.IsLetterOrDigit(_text[after]) || _text[after] == '_'))
                    {
                        continue;
                    }

                    var argument = FirstArgument(after);
                    if (argument is not null)
                    {
                        uses.AddRange(Uses(argument.Value.Text, argument.Value.Start, at));
                    }
                }

                return uses;
            }

            /// <summary>
            /// Calls to <paramref name="member"/> whose receiver is anything but
            /// <paramref name="receiver"/>, which the walk would not read.
            /// </summary>
            public List<WiringUse> CallsNotOn(string receiver, string member)
            {
                var call = new Regex(@"([A-Za-z_]\w*)\s*\??\s*\.\s*" + member + @"\s*[<(]");

                return call.Matches(_text)
                    .Where(m => m.Groups[1].Value != receiver)
                    .Select(m => new WiringUse(
                        m.Groups[1].Value + "." + member, null, _file, m.Index, LineAt(m.Index)))
                    .ToList();
            }

            /// <summary>
            /// The <paramref name="member"/> assignment inside every
            /// <c>new <paramref name="declarationType"/> { ... }</c> initialiser.
            /// </summary>
            public List<WiringUse> InitialiserAssignments(string declarationType, string member)
            {
                var uses = new List<WiringUse>();
                var opening = new Regex(@"\bnew\s+" + declarationType + @"\s*(?:\(\s*\))?\s*\{");
                var assignment = new Regex(@"\b" + member + @"\s*=\s*([^,;\r\n}]+)");

                foreach (Match match in opening.Matches(_text))
                {
                    var open = match.Index + match.Length - 1;
                    var found = assignment.Match(Braced(open));
                    if (found.Success)
                    {
                        uses.AddRange(Uses(found.Groups[1].Value, open + 1 + found.Groups[1].Index, match.Index));
                    }
                }

                return uses;
            }

            /// <summary>
            /// One expression as the uses it stands for: a loop variable expands to
            /// the array it walks, a helper's own parameter stands for nothing
            /// (the name is at the call site), anything else is itself.
            /// </summary>
            /// <param name="raw">The expression as written, leading space and all.</param>
            /// <param name="index">Where <paramref name="raw"/> starts in the file.</param>
            /// <param name="at">
            /// The call this expression was read from, which is what decides whether
            /// a loop variable is in scope. It is not where the NAME is written: a
            /// loop's names are written in the array above the body.
            /// </param>
            private IEnumerable<WiringUse> Uses(string raw, int index, int at)
            {
                var expression = raw.Trim();
                index += raw.Length - raw.TrimStart().Length;

                if (expression.Length == 0 || TypedParameter.IsMatch(expression))
                {
                    yield break;
                }

                var loop = _loopBindings.FirstOrDefault(
                    b => b.Name == expression && at >= b.Start && at <= b.End);
                if (loop.Elements is not null)
                {
                    foreach (var (element, elementAt) in loop.Elements)
                    {
                        yield return new WiringUse(
                            element, Resolve(element), _file, elementAt, LineAt(elementAt));
                    }

                    yield break;
                }

                if (_forwarded.Contains(expression))
                {
                    yield break;
                }

                yield return new WiringUse(expression, Resolve(expression), _file, index, LineAt(index));
            }

            /// <summary>
            /// A name expression as the string it carries: a literal directly, an
            /// identifier through the constant map. Null when it cannot be
            /// resolved, including when a bare name is spelled by two types with
            /// different values, because a guess there would compare the wrong
            /// pair.
            /// </summary>
            private string? Resolve(string expression)
            {
                if (expression.Length >= 2 && expression[0] == '"' && expression[^1] == '"')
                {
                    return Unescape(expression.Substring(1, expression.Length - 2));
                }

                if (!NameExpression.IsMatch(expression))
                {
                    return null;
                }

                var segments = expression.Split('.');
                var qualified = segments.Length >= 2 ? segments[^2] + "." + segments[^1] : segments[^1];

                if (_constants.TryGetValue(qualified, out var byType) && byType.Count == 1)
                {
                    return byType[0];
                }

                return _constants.TryGetValue(segments[^1], out var bare) && bare.Count == 1 ? bare[0] : null;
            }

            /// <summary>
            /// The text of the first argument of the call whose name ends at
            /// <paramref name="from"/>, stepping over any generic argument list.
            /// Null when what follows is not an argument list.
            /// </summary>
            private (string Text, int Start)? FirstArgument(int from)
            {
                var angle = 0;
                var at = from;

                for (; at < _text.Length; at++)
                {
                    var c = _text[at];
                    if (c == '<')
                    {
                        angle++;
                    }
                    else if (c == '>')
                    {
                        angle--;
                    }
                    else if (c == '(' && angle == 0)
                    {
                        break;
                    }
                    else if (angle == 0 && !char.IsWhiteSpace(c) && c != ',' && c != '?')
                    {
                        return null;
                    }
                }

                if (at >= _text.Length)
                {
                    return null;
                }

                var start = at + 1;
                var depth = 0;

                for (at = start; at < _text.Length; at++)
                {
                    var c = _text[at];
                    if (c is '(' or '[' or '{')
                    {
                        depth++;
                    }
                    else if (c is ')' or ']' or '}')
                    {
                        if (depth == 0)
                        {
                            return (_text.Substring(start, at - start), start);
                        }

                        depth--;
                    }
                    else if (c == ',' && depth == 0)
                    {
                        return (_text.Substring(start, at - start), start);
                    }
                }

                return null;
            }

            /// <summary>The text between the brace at <paramref name="open"/> and its match.</summary>
            private string Braced(int open)
            {
                var depth = 0;
                for (var at = open; at < _text.Length; at++)
                {
                    if (_text[at] == '{')
                    {
                        depth++;
                    }
                    else if (_text[at] == '}')
                    {
                        depth--;
                        if (depth == 0)
                        {
                            return _text.Substring(open + 1, at - open - 1);
                        }
                    }
                }

                return _text.Substring(open);
            }

            private int LineAt(int index) => _text.Take(index).Count(c => c == '\n') + 1;
        }
    }
}
