using System;

namespace Gonogo.KSP
{
    /// <summary>
    /// ConfigNode round-trip for <see cref="EvaParentage"/>, one child node per
    /// kerbal. Same discipline as <c>SilenceTracking.SilenceTrackerPersistence</c>:
    /// <see cref="Load"/> restores INTO the caller's existing book rather than
    /// replacing it, so <see cref="EvaParentageScenario"/> can hold one book for
    /// the process and have OnLoad fill that same instance.
    ///
    /// <para>This is the whole of the quickload answer. Stock puts nothing in the
    /// save that says which craft a kerbal stepped out of - the kerbal's part
    /// inherits <c>missionID</c>/<c>launchID</c> from the craft, but those name a
    /// LAUNCH and are shared by every vessel that ever undocked from it, so they
    /// cannot tell a lander from its mothership. Without this node, a quicksave
    /// taken during an EVA reloads with the relation gone and the kerbal reported
    /// as active again, which is the collapse the seam exists to prevent.</para>
    /// </summary>
    public static class EvaParentagePersistence
    {
        private const string RootNodeName = "EVA_PARENTAGE";
        private const string EntryNodeName = "KERBAL";

        public static void Save(EvaParentage book, ConfigNode node)
        {
            if (book == null || node == null)
            {
                return;
            }

            var root = node.AddNode(RootNodeName);
            foreach (var entry in book.Entries)
            {
                var entryNode = root.AddNode(EntryNodeName);
                entryNode.AddValue("kerbal", entry.Key.ToString());
                entryNode.AddValue("parent", entry.Value.ToString());
            }
        }

        /// <summary>
        /// Reads the node back if it is there. A save from before this existed, or
        /// a brand-new game, has none, and the book is left as it was constructed.
        /// A row whose ids will not parse is skipped rather than throwing: the cost
        /// of dropping one is that one kerbal reports as themselves, and the cost of
        /// throwing is the whole scenario module's OnLoad.
        /// </summary>
        public static void Load(EvaParentage target, ConfigNode node)
        {
            var root = node?.GetNode(RootNodeName);
            if (target == null || root == null)
            {
                return;
            }

            foreach (var entryNode in root.GetNodes(EntryNodeName))
            {
                if (!TryReadGuid(entryNode, "kerbal", out var kerbal) ||
                    !TryReadGuid(entryNode, "parent", out var parent))
                {
                    continue;
                }

                target.RecordEgress(kerbal, parent);
            }
        }

        private static bool TryReadGuid(ConfigNode node, string key, out Guid value)
        {
            value = Guid.Empty;
            var text = node?.GetValue(key);
            if (string.IsNullOrEmpty(text))
            {
                return false;
            }

            try
            {
                value = new Guid(text);
                return true;
            }
            catch (FormatException)
            {
                return false;
            }
            catch (OverflowException)
            {
                return false;
            }
        }
    }
}
