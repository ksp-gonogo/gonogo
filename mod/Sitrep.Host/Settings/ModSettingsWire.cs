using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Settings
{
    /// <summary>
    /// <c>settings.&lt;uplink&gt;</c> as the wire carries it: one flattener per
    /// contract type, named for the type it stands for, so the producer parity
    /// scan holds each to every field of <see cref="ModSettingsModel"/> and
    /// <see cref="ModSettingRow"/>.
    /// </summary>
    internal static class ModSettingsWire
    {
        /// <summary>One listed setting and what was last read for it.</summary>
        internal readonly struct Row
        {
            internal Row(ModSetting setting, ModSettingValue value)
            {
                Setting = setting;
                Value = value;
            }

            internal ModSetting Setting { get; }

            internal ModSettingValue Value { get; }
        }

        internal static Dictionary<string, object?> BuildModel(string uplinkId, IReadOnlyList<Row> rows, string? failure)
        {
            var settings = new List<object?>();
            foreach (var row in rows)
            {
                settings.Add(BuildModSettingRow(row.Setting, row.Value));
            }

            return new Dictionary<string, object?>
            {
                ["uplink"] = uplinkId,
                ["settings"] = settings,
                ["failure"] = failure,
                ["meta"] = new Dictionary<string, object?>
                {
                    ["source"] = "game",
                    ["quality"] = Quality.Loaded,
                },
            };
        }

        /// <summary>A setting not read yet is unavailable with a reason, never a value of false or zero.</summary>
        internal static Dictionary<string, object?> BuildModSettingRow(ModSetting setting, ModSettingValue value) =>
            new Dictionary<string, object?>
            {
                ["id"] = setting.Id,
                ["label"] = setting.Label,
                ["description"] = setting.Description,
                ["kind"] = setting.Kind,
                ["unit"] = setting.Unit,
                ["group"] = setting.Group,
                ["setIn"] = setting.SetIn,
                ["writable"] = setting.Writable,
                ["value"] = value.IsAvailable ? value.Spelled() : null,
                ["unavailable"] = value.IsAvailable ? null : value.UnavailableReason ?? "not read yet",
            };
    }
}
