using System;
using System.Collections.Generic;
using System.IO;
using Sitrep.Host.Settings;

namespace Gonogo.KSP.Settings
{
    /// <summary>
    /// The settings document as <c>PluginData/gonogo.cfg</c>. The only place in
    /// the mod that turns a <see cref="SettingsDocument"/> into a
    /// <c>ConfigNode</c> and back; how the file is written safely is
    /// <see cref="AtomicSettingsFile"/>'s, which this supplies with KSP's
    /// format and the real file system.
    ///
    /// <para>The path is a constructor argument, not
    /// <c>KSPUtil.ApplicationRootPath</c>. That property reads a live Unity
    /// player, so a store built on it cannot be exercised outside a running
    /// game, and a test over such a store passes whether or not a byte was ever
    /// written. <see cref="LivePath"/> is the game's own location and is
    /// resolved by the caller that has a game.</para>
    ///
    /// <para><b>Never fails loudly.</b> A GameData directory can be read-only,
    /// on a network share, or open in another process, and the settings change
    /// has already taken effect in memory by the time a write is attempted.
    /// The failure comes back as a <see cref="WriteOutcome"/> for the operator
    /// and goes to <c>UnityEngine.Debug</c>, which KSP captures and
    /// <c>Console.Error</c> is not.</para>
    ///
    /// <para><b>Rewrites the whole file.</b> <c>ConfigNode</c> has no in-place
    /// edit, so every block the document holds is written back; comments and
    /// formatting do not survive, which is what any ConfigNode round trip
    /// costs.</para>
    /// </summary>
    internal sealed class ConfigNodeSettingsStore : ISettingsBackingStore
    {
        private readonly AtomicSettingsFile _file;

        internal ConfigNodeSettingsStore(string path, Action<string>? log = null)
        {
            if (path == null)
            {
                throw new ArgumentNullException(nameof(path));
            }

            Action<string> warn = message => Warn(log, message);
            _file = new AtomicSettingsFile(path, new ConfigNodeFiles(path, warn), warn);
        }

        /// <summary>Where the running game keeps the file. Reachable only inside KSP.</summary>
        internal static string LivePath =>
            System.IO.Path.Combine(
                KSPUtil.ApplicationRootPath, "GameData", "Gonogo", "PluginData", "gonogo.cfg");

        public string Path => _file.Path;

        public SettingsReadSource LastReadFrom => _file.LastReadFrom;

        public SettingsDocument Read() => _file.Read();

        public SettingsDocument? ReadIfChangedElsewhere() => _file.ReadIfChangedElsewhere();

        public WriteOutcome Write(SettingsDocument document) => _file.Write(document);

        private static void Warn(Action<string>? log, string message)
        {
            try
            {
                if (log != null)
                {
                    log(message);
                    return;
                }

                UnityEngine.Debug.LogWarning("[Gonogo] " + message);
            }
            catch (Exception)
            {
                // Unity's logger is a live-process facility and this type is
                // exercised headlessly. Saying nothing is the last resort;
                // taking down a settings change that already succeeded over a
                // failed log message is not.
            }
        }

        /// <summary>KSP's format over the real file system.</summary>
        private sealed class ConfigNodeFiles : ISettingsFileSystem
        {
            private readonly string _primary;
            private readonly Action<string> _warn;

            internal ConfigNodeFiles(string primary, Action<string> warn)
            {
                _primary = primary;
                _warn = warn;
            }

            public bool Exists(string path) => File.Exists(path);

            public byte[]? Bytes(string path) => File.Exists(path) ? File.ReadAllBytes(path) : null;

            public SettingsDocument? ReadDocument(string path)
            {
                if (!File.Exists(path))
                {
                    return null;
                }

                var root = ConfigNode.Load(path);
                if (root == null)
                {
                    return null;
                }

                var document = new SettingsDocument();
                var shadowed = new List<string>();
                ReadInto(root, document.Root, string.Empty, shadowed);

                // Only for the file itself: the pending file is read back on
                // every save and would repeat the same warning each time.
                if (shadowed.Count > 0 && string.Equals(path, _primary, StringComparison.Ordinal))
                {
                    _warn(path + " names a block more than once, and only the first of each is read: "
                        + string.Join(", ", shadowed) + ". Every copy is kept in the file.");
                }

                return document;
            }

            public void WriteDocument(string path, SettingsDocument document)
            {
                var directory = System.IO.Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                var root = new ConfigNode();
                WriteFrom(document.Root, root);
                root.Save(path);
            }

            public void Copy(string source, string destination) => File.Copy(source, destination, overwrite: true);

            public void Replace(string source, string destination) => File.Replace(source, destination, null);

            public void Move(string source, string destination) => File.Move(source, destination);

            public void Delete(string path) => File.Delete(path);

            /// <summary>
            /// KSP's reader keeps a tab inside a hand-edited name or value, and
            /// its writer turns that tab into a space. Reading it as the space
            /// makes the document what the next save will write, so a hand edit
            /// can never leave the file in a state no save is allowed to
            /// reproduce.
            /// </summary>
            private static string AsWritten(string? text) => (text ?? string.Empty).Replace('\t', ' ');

            /// <summary>
            /// Carries the file through entry for entry: a repeated value name
            /// is a list, and a repeated block is kept after the first, which is
            /// the one every read resolves to.
            /// </summary>
            private static void ReadInto(ConfigNode source, SettingsBlock target, string prefix, List<string> shadowed)
            {
                foreach (ConfigNode.Value value in source.values)
                {
                    target.AppendValue(AsWritten(value.name), AsWritten(value.value));
                }

                foreach (ConfigNode child in source.nodes)
                {
                    var name = AsWritten(child.name);
                    if (target.Block(name) != null)
                    {
                        shadowed.Add(prefix + name);
                    }

                    ReadInto(child, target.AppendBlock(name), prefix + name + "/", shadowed);
                }
            }

            private static void WriteFrom(SettingsBlock source, ConfigNode target)
            {
                for (var i = 0; i < source.Values.Count; i++)
                {
                    target.AddValue(source.Values[i].Name, source.Values[i].Text);
                }

                for (var i = 0; i < source.Blocks.Count; i++)
                {
                    WriteFrom(source.Blocks[i], target.AddNode(source.Blocks[i].Name));
                }
            }
        }
    }
}
