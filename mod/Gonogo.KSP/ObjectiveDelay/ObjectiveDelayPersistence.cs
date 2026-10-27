using System;
using System.Globalization;
using Sitrep.Contract;

namespace Gonogo.KSP.ObjectiveDelay
{
    /// <summary>
    /// Saves the objective changes still on the line inside the currency-delay
    /// scenario's node, and puts them back on load. An apply cannot be saved, so
    /// a restored change waits until its owner rebinds.
    /// </summary>
    public static class ObjectiveDelayPersistence
    {
        private const string LineNodeName = "OBJECTIVE_DELAY_LINE";
        private const string ChangeNodeName = "CHANGE";

        public static void Save(ObjectiveDelayBook book, ConfigNode node)
        {
            var line = node.AddNode(LineNodeName);
            foreach (var held in book.Held)
            {
                var change = held.Change;
                var entry = line.AddNode(ChangeNodeName);
                entry.AddValue("contract", change.ContractId.ToString("N"));
                entry.AddValue("owner", change.OwnerId);
                entry.AddValue("path", change.ObjectivePath);
                entry.AddValue("target", change.Target.ToString());
                entry.AddValue("craftUt", change.CraftUt.ToString("R", CultureInfo.InvariantCulture));
                entry.AddValue("description", change.Description);
                foreach (var source in change.SourceVesselIds)
                {
                    entry.AddValue("source", source);
                }
                if (held.ArrivesUt is double arrives)
                {
                    entry.AddValue("arrivesUt", arrives.ToString("R", CultureInfo.InvariantCulture));
                }
                foreach (var unheard in held.UnheardSources)
                {
                    entry.AddValue("unheard", unheard);
                }
            }
        }

        /// <summary>
        /// Restores every saved change onto <paramref name="book"/>. A save from
        /// before the line existed has no node and leaves the book empty; an
        /// entry that cannot be read is skipped.
        /// </summary>
        public static void Load(ObjectiveDelayBook book, ConfigNode? node)
        {
            var line = node?.GetNode(LineNodeName);
            if (line == null)
            {
                return;
            }
            foreach (var entry in line.GetNodes(ChangeNodeName))
            {
                if (!TryGuid(entry.GetValue("contract"), out var contractId)
                    || !Enum.TryParse(entry.GetValue("target") ?? "", out ObjectiveState target)
                    || !TryDouble(entry.GetValue("craftUt"), out var craftUt))
                {
                    GonogoLog.Warn("objectives", "skipped a saved objective change that could not be read");
                    continue;
                }
                var change = new ObjectiveChange
                {
                    ContractId = contractId,
                    OwnerId = entry.GetValue("owner") ?? "",
                    ObjectivePath = entry.GetValue("path") ?? "",
                    Target = target,
                    SourceVesselIds = entry.GetValues("source") ?? Array.Empty<string>(),
                    CraftUt = craftUt,
                    Description = entry.GetValue("description") ?? "",
                };
                double? arrives = TryDouble(entry.GetValue("arrivesUt"), out var at) ? at : (double?)null;
                book.Restore(change, arrives, entry.GetValues("unheard") ?? Array.Empty<string>());
            }
        }

        private static bool TryGuid(string? text, out Guid value)
        {
            value = Guid.Empty;
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
        }

        private static bool TryDouble(string? text, out double value) =>
            double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }
}
