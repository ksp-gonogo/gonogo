using System;
using System.IO;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The mod's own <c>PluginData/gonogo.cfg</c>, on the WRITE side.
    ///
    /// <para><c>GonogoAddon.ReadSignalDelayConfig</c> reads this file at
    /// startup; a policy an operator changes from the console has to land in
    /// the same place, or it is forgotten at the next launch and the console
    /// shows a setting the mod has never heard of.</para>
    ///
    /// <para><b>Never fails loudly.</b> A GameData directory can be read-only,
    /// on a network share, or open in another process. Losing the persistence
    /// costs the operator one re-tick after a restart; throwing costs them the
    /// command, which has already taken effect in memory by the time this is
    /// called. The warning goes through <c>UnityEngine.Debug</c> rather than
    /// <c>Console.Error</c>, which KSP does not capture.</para>
    ///
    /// <para><b>Rewrites the whole file</b>, because <c>ConfigNode</c> has no
    /// in-place edit. Every other node is loaded and written back untouched, so
    /// a hand-edited <c>RECORDING</c> block survives; only formatting and
    /// comments are lost, which is what any ConfigNode round-trip costs.</para>
    /// </summary>
    internal static class GonogoConfigFile
    {
        private const string SignalDelayNode = "SIGNAL_DELAY";

        internal static string Path =>
            System.IO.Path.Combine(
                KSPUtil.ApplicationRootPath, "GameData", "Gonogo", "PluginData", "gonogo.cfg");

        /// <summary>
        /// Set one boolean under the <c>SIGNAL_DELAY</c> node, creating the
        /// file and the node if neither exists yet.
        /// </summary>
        internal static void WriteSignalDelayFlag(string key, bool value)
        {
            try
            {
                var path = Path;
                var directory = System.IO.Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                var root = File.Exists(path) ? ConfigNode.Load(path) : null;
                if (root == null)
                {
                    root = new ConfigNode();
                }

                var node = root.GetNode(SignalDelayNode);
                if (node == null)
                {
                    node = root.AddNode(SignalDelayNode);
                }

                node.SetValue(key, value.ToString(), createIfNotFound: true);
                root.Save(path);
            }
            catch (Exception ex)
            {
                try
                {
                    Debug.LogWarning(
                        "[Gonogo] could not persist " + SignalDelayNode + "/" + key
                        + ", it stays in force for this session only: " + ex.Message);
                }
                catch (Exception)
                {
                    // Unity's logger is a live-process facility, and this type
                    // is exercised headlessly. Saying nothing is the last
                    // resort; taking down the command that already succeeded
                    // over a failed log message is not.
                }
            }
        }
    }
}
