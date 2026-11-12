using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Settings
{
    /// <summary>
    /// One Uplink's host mod settings as <c>settings.&lt;uplink&gt;</c> reads
    /// them, and the <c>settings.mod.write</c> path into them.
    ///
    /// <para><b>Everything here runs on the main thread</b>: the list at
    /// discovery, each read from <see cref="Sample"/>, each write from its
    /// command handler. The channel source is read on another thread, so every
    /// change rebuilds an immutable payload and the source only ever hands that
    /// out.</para>
    /// </summary>
    public sealed class ModSettingsPublisher
    {
        /// <summary>How often a <see cref="ModSettingRefresh.Live"/> setting, or one not read yet, is read again.</summary>
        public const double LiveIntervalSec = 1.0;

        private readonly string _uplinkId;
        private readonly IModSettingsSource _source;
        private readonly IModSettingsWriter? _writer;
        private readonly List<ModSetting> _settings = new List<ModSetting>();
        private readonly Dictionary<string, ModSettingValue> _values =
            new Dictionary<string, ModSettingValue>(StringComparer.Ordinal);
        private readonly HashSet<string> _launchSettled = new HashSet<string>(StringComparer.Ordinal);
        private string? _failure;
        private string? _saveKey;
        private double? _lastPollSec;
        private volatile Dictionary<string, object?> _snapshot;

        /// <summary>
        /// Take the Uplink's list. A list that throws or breaks a rule leaves no
        /// settings and says why in <see cref="Failure"/>; it never throws.
        /// </summary>
        public ModSettingsPublisher(string uplinkId, IModSettingsSource source)
        {
            _uplinkId = uplinkId ?? throw new ArgumentNullException(nameof(uplinkId));
            _source = source ?? throw new ArgumentNullException(nameof(source));
            _writer = source as IModSettingsWriter;
            _failure = List();
            _snapshot = Build();
        }

        /// <summary>The topic these settings ride.</summary>
        public string Topic => TopicFor(_uplinkId);

        /// <summary>Why the list could not be taken, or null when it was.</summary>
        public string? Failure => _failure;

        /// <summary>The latest payload, for the channel source. Safe to read from any thread.</summary>
        public object Snapshot => _snapshot;

        /// <summary>The topic an Uplink's mod settings ride.</summary>
        public static string TopicFor(string uplinkId) => "settings." + uplinkId;

        /// <summary>
        /// Read every setting that is due. <see cref="ModSettingRefresh.Save"/>
        /// settings are due whenever <paramref name="saveKey"/> differs from the
        /// last call's, which the caller changes on a save load or a scene change;
        /// <see cref="ModSettingRefresh.Live"/> settings and any
        /// <see cref="ModSettingRefresh.Launch"/> setting not yet read are due
        /// once every <see cref="LiveIntervalSec"/>. Never throws.
        /// </summary>
        public void Sample(double nowRealSec, string saveKey)
        {
            if (_failure != null)
            {
                return;
            }

            var saveChanged = !string.Equals(saveKey, _saveKey, StringComparison.Ordinal);
            _saveKey = saveKey;
            var pollDue = _lastPollSec == null || nowRealSec - _lastPollSec.Value >= LiveIntervalSec;
            if (pollDue)
            {
                _lastPollSec = nowRealSec;
            }

            var changed = false;
            foreach (var setting in _settings)
            {
                if (IsDue(setting, saveChanged, pollDue))
                {
                    changed |= ReadOne(setting);
                }
            }

            if (changed)
            {
                _snapshot = Build();
            }
        }

        /// <summary>
        /// One <c>settings.mod.write</c>. Refused, with the Uplink never asked,
        /// when the setting is not listed, not writable, or the value is not of
        /// its kind. The setting is read again straight after, whatever the
        /// Uplink answered, so the payload says what the mod now holds.
        /// </summary>
        public CommandResult Write(string id, string text)
        {
            var setting = _settings.Find(s => s.Id == id);
            if (setting == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, _uplinkId + " lists no mod setting " + id);
            }

            if (!setting.Writable || _writer == null)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, setting.Label + " is not offered to be changed from here");
            }

            var value = Parse(setting.Kind, text);
            if (!value.IsAvailable)
            {
                return CommandResult.Fail(CommandErrorCode.Range, value.UnavailableReason);
            }

            CommandResult result;
            try
            {
                result = _writer.WriteModSetting(id, value)
                    ?? CommandResult.Fail(CommandErrorCode.ModeUnavailable, _uplinkId + " answered nothing writing " + id);
            }
            catch (Exception ex)
            {
                result = CommandResult.Fail(CommandErrorCode.ModeUnavailable, _uplinkId + " threw writing " + id + ": " + ex.Message);
            }

            if (ReadOne(setting))
            {
                _snapshot = Build();
            }

            return result;
        }

        private static bool IsDue(ModSetting setting, bool saveChanged, bool pollDue) =>
            setting.Refresh == ModSettingRefresh.Save ? saveChanged : pollDue;

        /// <summary>Read one setting; true when what the payload shows for it changed.</summary>
        private bool ReadOne(ModSetting setting)
        {
            if (setting.Refresh == ModSettingRefresh.Launch && _launchSettled.Contains(setting.Id))
            {
                return false;
            }

            ModSettingValue read;
            try
            {
                read = _source.ReadModSetting(setting.Id);
            }
            catch (Exception ex)
            {
                read = ModSettingValue.Unavailable(_uplinkId + " threw reading it: " + ex.Message);
            }

            if (read.IsAvailable && read.Kind != setting.Kind)
            {
                read = ModSettingValue.Unavailable(_uplinkId + " read a " + read.Kind + " for a " + setting.Kind + " setting");
            }

            if (read.IsAvailable && setting.Refresh == ModSettingRefresh.Launch)
            {
                _launchSettled.Add(setting.Id);
            }

            var had = _values.TryGetValue(setting.Id, out var before);
            _values[setting.Id] = read;
            return !had
                || before.Spelled() != read.Spelled()
                || before.UnavailableReason != read.UnavailableReason;
        }

        private string? List()
        {
            IReadOnlyList<ModSetting>? listed;
            try
            {
                listed = _source.ListModSettings();
            }
            catch (Exception ex)
            {
                return "listing its mod settings threw: " + ex.Message;
            }

            if (listed == null)
            {
                return "it listed no mod settings";
            }

            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var setting in listed)
            {
                if (setting == null)
                {
                    return "it listed a missing mod setting";
                }

                if (string.IsNullOrEmpty(setting.Id))
                {
                    return "it listed a mod setting with no id";
                }

                if (!ids.Add(setting.Id))
                {
                    return "it listed the mod setting " + setting.Id + " more than once";
                }

                if (setting.Writable && _writer == null)
                {
                    return "it marks " + setting.Id + " writable but cannot write mod settings";
                }
            }

            _settings.AddRange(listed);
            return null;
        }

        /// <summary>A written value of <paramref name="kind"/>, or unavailable with why it is not one.</summary>
        private static ModSettingValue Parse(SettingKind kind, string? text)
        {
            switch (kind)
            {
                case SettingKind.Bool:
                    return text == "True" || text == "False"
                        ? ModSettingValue.Of(text == "True")
                        : ModSettingValue.Unavailable("not True or False: " + text);
                case SettingKind.Number:
                    var number = SettingsText.ToNumber(text);
                    return number.HasValue && !double.IsNaN(number.Value) && !double.IsInfinity(number.Value)
                        ? ModSettingValue.Of(number.Value)
                        : ModSettingValue.Unavailable("not a number: " + text);
                default:
                    return text == null ? ModSettingValue.Unavailable("no value") : ModSettingValue.Of(text);
            }
        }

        private Dictionary<string, object?> Build()
        {
            var rows = new List<ModSettingsWire.Row>();
            foreach (var setting in _settings)
            {
                _values.TryGetValue(setting.Id, out var value);
                rows.Add(new ModSettingsWire.Row(setting, value));
            }

            return ModSettingsWire.BuildModel(_uplinkId, rows, _failure);
        }
    }
}
