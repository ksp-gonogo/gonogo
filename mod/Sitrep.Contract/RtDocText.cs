#if SITREP_CODEGEN
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using Reinforced.Typings.Fluent;

namespace Sitrep.Contract;

/// <summary>
/// Turns a C# XMLDoc <c>summary</c> body into the lines of a TSDoc block.
///
/// <para>Reinforced.Typings reads the doc file natively, but what it hands the
/// writer is <c>reader.ReadInnerXml()</c>: the summary's RAW XML, tags and
/// entities intact. Passed through unchanged, an author hovering the type reads
/// <c>&lt;para&gt;&lt;b&gt;Typing-only mirror.&lt;/b&gt;</c>. This is the
/// translation that stops that, and it is a pure function of its input, so the
/// generated file stays byte-stable across runs.</para>
///
/// <para>Prose is re-wrapped rather than kept at the C# source's line breaks.
/// Those breaks were chosen against a C# indent that no longer applies, and
/// re-wrapping is what makes two runs over the same prose agree regardless of
/// how the C# happened to be formatted.</para>
/// </summary>
public static class RtDocText
{
    /// <summary>
    /// Prose width inside the block, before the leading tabs and <c>* </c>.
    /// </summary>
    private const int Width = 76;

    private static readonly Regex GenericArity = new Regex("`\\d+", RegexOptions.Compiled);
    private static readonly Regex WhitespaceRun = new Regex("\\s+", RegexOptions.Compiled);

    private sealed class Paragraph
    {
        public string Text = string.Empty;
        public bool Bullet;
    }

    /// <summary>
    /// The doc lines for one summary body, without the <c>/**</c>, the leading
    /// tabs or the <c>*</c> gutter. An empty string is a blank gutter line.
    /// </summary>
    /// <param name="summaryXml">The summary's inner XML, as RT cached it.</param>
    /// <param name="renderCref">
    /// Renders one <c>see cref</c> target. Owned by the caller because whether a
    /// name can be pointed at depends on what the file being written exports,
    /// which this translation cannot know.
    /// </param>
    public static List<string> ToDocLines(string summaryXml, Func<string, string> renderCref)
    {
        var paragraphs = Parse(summaryXml, renderCref);
        var lines = new List<string>();
        for (var i = 0; i < paragraphs.Count; i++)
        {
            var p = paragraphs[i];
            // Blank gutter line between paragraphs, but not between consecutive
            // bullets: a list reads as a list only when it is tight.
            if (i > 0 && !(p.Bullet && paragraphs[i - 1].Bullet)) lines.Add(string.Empty);
            if (p.Bullet) Wrap("- " + p.Text, "  ", lines);
            else Wrap(p.Text, string.Empty, lines);
        }
        return lines;
    }

    private static List<Paragraph> Parse(string summaryXml, Func<string, string> renderCref)
    {
        var paragraphs = new List<Paragraph>();
        var sb = new StringBuilder();
        var closers = new Stack<string>();
        var bullet = false;
        // Whether the last thing read was a tag rather than text, which is how
        // a space that WAS in the C# gets put back.
        //
        // RT deserialises the doc file with an XmlSerializer, and that discards
        // whitespace-only text. Whitespace inside a run of prose is mixed
        // content and survives; the line break between `</b>` and `<c>` on the
        // next line is its own node and does not, so `</b>\n<c>` reaches here as
        // `</b><c>` and two words run together. Tags written genuinely adjacent
        // are one occurrence in the whole tree, and that one is on a type the
        // SDK does not export.
        var afterTag = false;

        void Flush(bool nextBullet = false)
        {
            var text = Collapse(sb.ToString());
            if (text.Length > 0) paragraphs.Add(new Paragraph { Text = text, Bullet = bullet });
            sb.Length = 0;
            bullet = nextBullet;
        }

        var settings = new XmlReaderSettings
        {
            ConformanceLevel = ConformanceLevel.Fragment,
            IgnoreWhitespace = false,
            DtdProcessing = DtdProcessing.Prohibit,
        };
        using (var reader = XmlReader.Create(new StringReader(summaryXml), settings))
        {
            while (SafeRead(reader))
            {
                switch (reader.NodeType)
                {
                    case XmlNodeType.Text:
                    case XmlNodeType.CDATA:
                    case XmlNodeType.Whitespace:
                    case XmlNodeType.SignificantWhitespace:
                        sb.Append(reader.Value);
                        afterTag = false;
                        break;

                    case XmlNodeType.Element:
                    {
                        var name = reader.Name.ToLowerInvariant();
                        var empty = reader.IsEmptyElement;
                        if (afterTag && sb.Length > 0 && !char.IsWhiteSpace(sb[sb.Length - 1]))
                            sb.Append(' ');
                        afterTag = empty;
                        switch (name)
                        {
                            case "para":
                            case "p":
                            case "list":
                            case "remarks":
                            case "example":
                                Flush();
                                break;
                            case "item":
                                Flush(nextBullet: true);
                                break;
                            case "term":
                            case "description":
                            case "listheader":
                                break;
                            case "b":
                            case "strong":
                                sb.Append("**");
                                if (!empty) closers.Push("**");
                                break;
                            case "i":
                            case "em":
                                sb.Append('*');
                                if (!empty) closers.Push("*");
                                break;
                            case "c":
                            case "code":
                                sb.Append('`');
                                if (!empty) closers.Push("`");
                                break;
                            case "see":
                            case "seealso":
                            {
                                var cref = reader.GetAttribute("cref");
                                var langword = reader.GetAttribute("langword");
                                var href = reader.GetAttribute("href");
                                // A `see` with a body says what to call it; only
                                // the self-closing form has to be named for the
                                // reader, and every one in this tree is that form.
                                if (!empty) { closers.Push(string.Empty); break; }
                                if (!string.IsNullOrEmpty(cref)) sb.Append(renderCref(cref));
                                else if (!string.IsNullOrEmpty(langword)) sb.Append('`').Append(langword).Append('`');
                                else if (!string.IsNullOrEmpty(href)) sb.Append(href);
                                break;
                            }
                            case "paramref":
                            case "typeparamref":
                            {
                                var n = reader.GetAttribute("name");
                                if (!empty && n == null) { closers.Push(string.Empty); break; }
                                if (n != null) sb.Append('`').Append(n).Append('`');
                                if (!empty) closers.Push(string.Empty);
                                break;
                            }
                            case "br":
                                sb.Append(' ');
                                break;
                            default:
                                if (!empty) closers.Push(string.Empty);
                                break;
                        }
                        break;
                    }

                    case XmlNodeType.EndElement:
                    {
                        var name = reader.Name.ToLowerInvariant();
                        if (name == "para" || name == "p" || name == "list" || name == "item"
                            || name == "remarks" || name == "example") Flush();
                        else if (name == "term" || name == "description" || name == "listheader") { }
                        else if (closers.Count > 0) sb.Append(closers.Pop());
                        afterTag = true;
                        break;
                    }
                }
            }
        }

        Flush();
        return paragraphs;
    }

    /// <summary>
    /// A malformed summary is prose we cannot read, not a build failure: the
    /// reader stops and the paragraphs collected so far are kept. Codegen
    /// refusing to run over a stray angle bracket in a comment would be the
    /// worse trade.
    /// </summary>
    private static bool SafeRead(XmlReader reader)
    {
        try { return reader.Read(); }
        catch (XmlException) { return false; }
    }

    private static string Collapse(string s) => WhitespaceRun.Replace(s, " ").Trim();

    private static void Wrap(string text, string hang, List<string> into)
    {
        var line = new StringBuilder();
        var empty = true;
        foreach (var word in text.Split(' '))
        {
            if (word.Length == 0) continue;
            if (!empty && line.Length + 1 + word.Length > Width)
            {
                into.Add(line.ToString());
                line.Length = 0;
                line.Append(hang);
                empty = true;
            }
            if (!empty) line.Append(' ');
            line.Append(word);
            empty = false;
        }
        if (!empty) into.Add(line.ToString());
    }

    /// <summary>
    /// The simple name a <c>cref</c> value points at, with the doc-id kind
    /// prefix, the parameter list and the generic arity marker removed.
    /// </summary>
    public static string[] CrefSegments(string cref)
    {
        if (string.IsNullOrEmpty(cref)) return new string[0];
        var body = cref;
        if (body.Length > 1 && body[1] == ':') body = body.Substring(2);
        var paren = body.IndexOf('(');
        if (paren >= 0) body = body.Substring(0, paren);
        body = GenericArity.Replace(body, string.Empty);
        return body.Split('.');
    }

    /// <summary>
    /// Whether a <c>cref</c> is one the C# compiler could not resolve. Those
    /// arrive as <c>!:Whatever</c> and are a stale doc, so nothing is pointed at.
    /// </summary>
    public static bool IsUnresolvedCref(string cref) =>
        !string.IsNullOrEmpty(cref) && cref.Length > 1 && cref[0] == '!';

    /// <summary>
    /// Folds each member's <c>remarks</c> into its <c>summary</c> as a trailing
    /// paragraph, in a sibling copy of the doc file, and registers that copy so
    /// RT reads it.
    ///
    /// <para>RT parses <c>remarks</c> and then never emits it: only
    /// <c>Summary.Text</c> reaches a generated declaration. Forty-two blocks in
    /// this tree put their reasoning there, several of them the whole meaning of
    /// an enum value, so they would be the one part of the prose still dropped on
    /// the floor.</para>
    ///
    /// <para>Registered through <c>AdditionalDocumentationPathes</c> rather than
    /// written over the compiler's own output: additional files are cached after
    /// the main one and win on a key collision, so the merged copy overrides
    /// exactly the members it carries and the build's own artifact is left
    /// alone. It has to happen here because the fluent configuration is applied
    /// before the documentation is loaded, which is the only window in which
    /// adding a path still has an effect.</para>
    /// </summary>
    public static void MergeRemarksIntoSummaries(ConfigurationBuilder builder)
    {
        var source = builder.Context.DocumentationFilePath;
        if (string.IsNullOrEmpty(source) || !File.Exists(source)) return;

        XDocument doc;
        try { doc = XDocument.Load(source); }
        catch (XmlException) { return; }

        var members = new List<XElement>();
        foreach (var member in doc.Descendants("member"))
        {
            var remarks = member.Element("remarks");
            if (remarks == null) continue;
            var summary = member.Element("summary");
            if (summary == null)
            {
                summary = new XElement("summary");
                member.AddFirst(summary);
            }
            var carried = new XElement("para");
            foreach (var node in remarks.Nodes()) carried.Add(node);
            summary.Add(carried);
            remarks.Remove();
            members.Add(member);
        }
        if (members.Count == 0) return;

        var merged = new XDocument(new XElement("doc", new XElement("members", members)));
        var target = Path.ChangeExtension(source, ".remarks.xml");
        merged.Save(target);
        builder.Context.Project.AdditionalDocumentationPathes.Add(target);
    }
}
#endif
