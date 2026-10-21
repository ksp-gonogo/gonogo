using System.Globalization;

namespace Gonogo.KSP
{
    /// <summary>
    /// ConfigNode round-trip for <see cref="CraftLaunchLog"/>, one child node per
    /// launch. <see cref="Load"/> restores into the caller's existing book, which
    /// <see cref="CraftLaunchScenario"/> holds for the process.
    /// </summary>
    public static class CraftLaunchLogPersistence
    {
        private const string RootNodeName = "CRAFT_LAUNCHES";
        private const string EntryNodeName = "LAUNCH";

        public static void Save(CraftLaunchLog book, ConfigNode node)
        {
            if (book == null || node == null)
            {
                return;
            }

            var root = node.AddNode(RootNodeName);
            foreach (var entry in book.Entries)
            {
                var entryNode = root.AddNode(EntryNodeName);
                entryNode.AddValue("facility", entry.Facility);
                entryNode.AddValue(entry.ByFile ? "file" : "shipName", entry.Name);
                entryNode.AddValue("ut", entry.Ut.ToString("R", CultureInfo.InvariantCulture));
            }
        }

        /// <summary>
        /// Reads the node back if it is there. A save from before the book existed
        /// has none and leaves the book as it was. A row that will not parse is
        /// skipped: losing one launch date is a smaller fault than losing the node.
        /// </summary>
        public static void Load(CraftLaunchLog target, ConfigNode node)
        {
            var root = node?.GetNode(RootNodeName);
            if (target == null || root == null)
            {
                return;
            }

            foreach (var entryNode in root.GetNodes(EntryNodeName))
            {
                var facility = entryNode.GetValue("facility");
                var file = entryNode.GetValue("file");
                var shipName = entryNode.GetValue("shipName");
                var name = file ?? shipName;
                if (string.IsNullOrEmpty(facility) || string.IsNullOrEmpty(name)
                    || !double.TryParse(entryNode.GetValue("ut"), NumberStyles.Float, CultureInfo.InvariantCulture, out var ut))
                {
                    continue;
                }

                target.Restore(new CraftLaunchLog.LaunchEntry(facility, name, file != null, ut));
            }
        }
    }
}
