using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Settings
{
    /// <summary>
    /// <c>settings.gonogo</c> as the wire carries it: one flattener per contract
    /// type, named for the type it stands for, so the producer parity scan holds
    /// each to every field of <see cref="SettingsModel"/> and the types under it.
    /// </summary>
    internal static class SettingsWire
    {
        /// <summary>One declared row and the value in force for it, as <see cref="BuildModel"/> takes it.</summary>
        internal readonly struct Row
        {
            internal Row(SettingsRow declared, string owner, string value)
            {
                Declared = declared;
                Owner = owner;
                Value = value;
            }

            internal SettingsRow Declared { get; }

            internal string Owner { get; }

            internal string Value { get; }
        }

        internal static Dictionary<string, object?> BuildModel(
            IReadOnlyList<Row> rows,
            string path,
            SettingsPersistenceState state,
            double? savedAtUt,
            string? reason,
            IReadOnlyDictionary<string, string> undeclared,
            IReadOnlyList<(string Owner, string Name, string Label, string Value)> modSettings)
        {
            var wireRows = new List<object?>();
            foreach (var row in rows)
            {
                wireRows.Add(BuildRowState(
                    row.Declared.Path, row.Owner, row.Declared.Kind, row.Declared.Label, row.Value, row.Declared.DefaultText));
            }

            var wireModSettings = new List<object?>();
            foreach (var shown in modSettings)
            {
                wireModSettings.Add(BuildModSettingState(shown.Owner, shown.Name, shown.Label, shown.Value));
            }

            var wireUndeclared = new List<object?>();
            foreach (var failure in undeclared)
            {
                wireUndeclared.Add(BuildDeclarationFailure(failure.Key, failure.Value));
            }

            return new Dictionary<string, object?>
            {
                ["rows"] = wireRows,
                ["persistence"] = BuildPersistence(path, state, savedAtUt, reason),
                ["undeclared"] = wireUndeclared,
                ["modSettings"] = wireModSettings,
                // Settings are the game install's own configuration, about no
                // vessel, and exact whenever they can be read at all.
                ["meta"] = new Dictionary<string, object?>
                {
                    ["source"] = "game",
                    ["quality"] = Quality.Loaded,
                },
            };
        }

        internal static Dictionary<string, object?> BuildRowState(
            string path, string owner, SettingKind kind, string label, string value, string defaultValue) =>
            new Dictionary<string, object?>
            {
                ["path"] = path,
                ["owner"] = owner,
                ["kind"] = kind,
                ["label"] = label,
                ["value"] = value,
                ["default"] = defaultValue,
            };

        internal static Dictionary<string, object?> BuildPersistence(
            string path, SettingsPersistenceState state, double? savedAtUt, string? reason) =>
            new Dictionary<string, object?>
            {
                ["state"] = state,
                ["path"] = path,
                ["savedAtUt"] = savedAtUt,
                ["reason"] = reason,
            };

        internal static Dictionary<string, object?> BuildModSettingState(
            string owner, string name, string label, string value) =>
            new Dictionary<string, object?>
            {
                ["owner"] = owner,
                ["name"] = name,
                ["label"] = label,
                ["value"] = value,
            };

        internal static Dictionary<string, object?> BuildDeclarationFailure(string uplinkId, string reason) =>
            new Dictionary<string, object?>
            {
                ["uplinkId"] = uplinkId,
                ["reason"] = reason,
            };
    }
}
