using System;
using System.IO;
using Sitrep.Host.Settings;

namespace Gonogo.KSP.Settings
{
    /// <summary>
    /// The settings document as <c>PluginData/gonogo.cfg</c>. The only place in
    /// the mod that turns a <see cref="SettingsDocument"/> into a
    /// <c>ConfigNode</c> and back.
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
        private readonly Action<string>? _log;

        internal ConfigNodeSettingsStore(string path, Action<string>? log = null)
        {
            Path = path ?? throw new ArgumentNullException(nameof(path));
            _log = log;
        }

        /// <summary>Where the running game keeps the file. Reachable only inside KSP.</summary>
        internal static string LivePath =>
            System.IO.Path.Combine(
                KSPUtil.ApplicationRootPath, "GameData", "Gonogo", "PluginData", "gonogo.cfg");

        public string Path { get; }

        public SettingsDocument Read()
        {
            var document = new SettingsDocument();
            try
            {
                if (!File.Exists(Path))
                {
                    return document;
                }

                var root = ConfigNode.Load(Path);
                if (root != null)
                {
                    ReadInto(root, document.Root);
                }
            }
            catch (Exception ex)
            {
                Warn("could not read " + Path + ", every setting starts at its default: " + ex.Message);
                return new SettingsDocument();
            }

            return document;
        }

        public WriteOutcome Write(SettingsDocument document)
        {
            if (document == null)
            {
                return WriteOutcome.Failed(Path, "no document given");
            }

            // KSP's writer and reader would change such a value without an
            // error, so the file would say something other than what was
            // meant. Refusing leaves the file as it was.
            var violation = document.FirstEncodingViolation();
            if (violation != null)
            {
                Warn("did not write " + Path + ": " + violation);
                return WriteOutcome.Failed(Path, violation);
            }

            try
            {
                var directory = System.IO.Path.GetDirectoryName(Path);
                if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                var root = new ConfigNode();
                WriteFrom(document.Root, root);
                root.Save(Path);
                return WriteOutcome.Written(Path);
            }
            catch (Exception ex)
            {
                Warn("could not persist " + Path
                    + ", the settings stay in force for this session only: " + ex.Message);
                return WriteOutcome.Failed(Path, ex.Message);
            }
        }

        /// <summary>
        /// KSP's reader keeps a tab inside a hand-edited name or value, and its
        /// writer turns that tab into a space. Reading it as the space makes
        /// the document what the next save will write, so a hand edit can never
        /// leave the file in a state no save is allowed to reproduce.
        /// </summary>
        private static string AsWritten(string? text) => (text ?? string.Empty).Replace('\t', ' ');

        private static void ReadInto(ConfigNode source, SettingsBlock target)
        {
            foreach (ConfigNode.Value value in source.values)
            {
                target.SetValue(AsWritten(value.name), AsWritten(value.value));
            }

            foreach (ConfigNode child in source.nodes)
            {
                ReadInto(child, target.BlockOrAdd(AsWritten(child.name)));
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

        private void Warn(string message)
        {
            try
            {
                if (_log != null)
                {
                    _log(message);
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
    }
}
