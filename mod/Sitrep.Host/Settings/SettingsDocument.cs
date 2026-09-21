using System;
using System.Collections.Generic;

namespace Sitrep.Host.Settings
{
    /// <summary>One row of a settings block: a name and the text it carries.</summary>
    public sealed class SettingsEntry
    {
        public SettingsEntry(string name, string text)
        {
            Name = name ?? throw new ArgumentNullException(nameof(name));
            Text = text ?? string.Empty;
        }

        public string Name { get; }

        public string Text { get; internal set; }
    }

    /// <summary>
    /// One block of the settings document: an ordered list of name-to-text rows
    /// and an ordered list of child blocks.
    ///
    /// <para>Deliberately NOT a <c>ConfigNode</c>. This assembly carries no KSP
    /// reference, so the document, the coercion over it and the change
    /// notification are exercised on every checkout; the single translation to
    /// KSP's on-disk format lives in the backing store that owns the file.</para>
    ///
    /// <para>Order is preserved on both lists, and setting an existing row
    /// updates it in place rather than moving it to the end, so a document that
    /// came off disk and went back unchanged keeps the operator's layout.</para>
    ///
    /// <para>A repeated name resolves to the FIRST occurrence, matching what
    /// KSP's own parser does with a duplicate node.</para>
    /// </summary>
    public sealed class SettingsBlock
    {
        private readonly List<SettingsEntry> _values = new List<SettingsEntry>();
        private readonly List<SettingsBlock> _blocks = new List<SettingsBlock>();

        public SettingsBlock(string name)
        {
            Name = name ?? string.Empty;
        }

        public string Name { get; }

        public IReadOnlyList<SettingsEntry> Values => _values;

        public IReadOnlyList<SettingsBlock> Blocks => _blocks;

        public SettingsBlock? Block(string name)
        {
            for (var i = 0; i < _blocks.Count; i++)
            {
                if (string.Equals(_blocks[i].Name, name, StringComparison.Ordinal))
                {
                    return _blocks[i];
                }
            }

            return null;
        }

        public SettingsBlock BlockOrAdd(string name)
        {
            var existing = Block(name);
            if (existing != null)
            {
                return existing;
            }

            var added = new SettingsBlock(name);
            _blocks.Add(added);
            return added;
        }

        public string? Value(string name)
        {
            for (var i = 0; i < _values.Count; i++)
            {
                if (string.Equals(_values[i].Name, name, StringComparison.Ordinal))
                {
                    return _values[i].Text;
                }
            }

            return null;
        }

        public bool HasValue(string name) => Value(name) != null;

        public void SetValue(string name, string text)
        {
            for (var i = 0; i < _values.Count; i++)
            {
                if (string.Equals(_values[i].Name, name, StringComparison.Ordinal))
                {
                    _values[i].Text = text ?? string.Empty;
                    return;
                }
            }

            _values.Add(new SettingsEntry(name, text ?? string.Empty));
        }

        public SettingsBlock Copy()
        {
            var copy = new SettingsBlock(Name);
            for (var i = 0; i < _values.Count; i++)
            {
                copy._values.Add(new SettingsEntry(_values[i].Name, _values[i].Text));
            }

            for (var i = 0; i < _blocks.Count; i++)
            {
                copy._blocks.Add(_blocks[i].Copy());
            }

            return copy;
        }
    }

    /// <summary>
    /// The whole settings document, addressed by a slash-separated path whose
    /// last segment names a row and whose earlier segments name the blocks
    /// above it: <c>SIGNAL_DELAY/delayInSimulation</c>.
    /// </summary>
    public sealed class SettingsDocument
    {
        public SettingsDocument()
            : this(new SettingsBlock(string.Empty))
        {
        }

        private SettingsDocument(SettingsBlock root)
        {
            Root = root;
        }

        public SettingsBlock Root { get; }

        /// <summary>The text at <paramref name="path"/>, or null when no such row exists.</summary>
        public string? Text(string path)
        {
            var segments = Split(path);
            var block = Root;
            for (var i = 0; i < segments.Length - 1; i++)
            {
                var child = block.Block(segments[i]);
                if (child == null)
                {
                    return null;
                }

                block = child;
            }

            return block.Value(segments[segments.Length - 1]);
        }

        public bool Has(string path) => Text(path) != null;

        /// <summary>Write <paramref name="text"/> at <paramref name="path"/>, creating any block above it that is missing.</summary>
        public void Set(string path, string text)
        {
            var segments = Split(path);
            var block = Root;
            for (var i = 0; i < segments.Length - 1; i++)
            {
                block = block.BlockOrAdd(segments[i]);
            }

            block.SetValue(segments[segments.Length - 1], text);
        }

        public SettingsDocument Copy() => new SettingsDocument(Root.Copy());

        /// <summary>
        /// Whether a path lies at or beneath <paramref name="prefix"/>, which is
        /// how a watcher on a whole block hears about one row inside it.
        /// </summary>
        internal static bool IsUnder(string path, string prefix)
        {
            if (string.IsNullOrEmpty(prefix))
            {
                return true;
            }

            return string.Equals(path, prefix, StringComparison.Ordinal)
                || (path.Length > prefix.Length
                    && path[prefix.Length] == '/'
                    && path.StartsWith(prefix, StringComparison.Ordinal));
        }

        internal static string[] Split(string path)
        {
            if (string.IsNullOrEmpty(path))
            {
                throw new ArgumentException("a settings path names at least one segment", nameof(path));
            }

            var segments = path.Split('/');
            for (var i = 0; i < segments.Length; i++)
            {
                if (segments[i].Length == 0)
                {
                    throw new ArgumentException("a settings path has no empty segment: " + path, nameof(path));
                }
            }

            return segments;
        }
    }
}
