using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>One of Gonogo's own settings held at a value by an Uplink, as <see cref="ICoreSettingLocks.Lock"/> recorded it.</summary>
    public sealed class CoreSettingLock
    {
        public CoreSettingLock(string setting, bool value, string uplinkId, string uplinkName, string reason)
        {
            Setting = setting;
            Value = value;
            UplinkId = uplinkId;
            UplinkName = uplinkName;
            Reason = reason;
        }

        /// <summary>The setting's id, one of <see cref="CoreSettings.All"/>.</summary>
        public string Setting { get; }

        /// <summary>The value the setting is held at.</summary>
        public bool Value { get; }

        /// <summary>The id of the Uplink that locked it.</summary>
        public string UplinkId { get; }

        /// <summary>The Uplink's name as its manifest gives it, or its id when the manifest names none.</summary>
        public string UplinkName { get; }

        /// <summary>The Uplink's reason, for the player.</summary>
        public string Reason { get; }
    }

    public sealed partial class ChannelEngine : ICoreSettingLocks
    {
        private readonly Dictionary<string, CoreSettingLock> _settingLocks = new Dictionary<string, CoreSettingLock>(StringComparer.Ordinal);

        /// <inheritdoc/>
        public void Lock(string setting, bool value, string reason)
        {
            if (_currentRegisteringUplinkId is not string uplinkId)
            {
                LogHost("Lock(\"" + setting + "\") called outside an uplink's Register: IGNORED. A setting lock names the uplink whose Register is running");
                return;
            }
            if (!CoreSettings.All.Contains(setting))
            {
                LogHost("uplink \"" + uplinkId + "\" tried to lock \"" + setting + "\", which is not a setting an uplink may lock: IGNORED");
                return;
            }
            if (string.IsNullOrWhiteSpace(reason))
            {
                LogHost("uplink \"" + uplinkId + "\" tried to lock \"" + setting + "\" with no reason for the player: IGNORED");
                return;
            }
            if (_settingLocks.TryGetValue(setting, out var holder))
            {
                LogHost("uplink \"" + uplinkId + "\" tried to lock \"" + setting + "\", which uplink \"" + holder.UplinkId + "\" already holds: IGNORED");
                return;
            }
            var name = _registeredUplinks.TryGetValue(uplinkId, out var uplink) && !string.IsNullOrWhiteSpace(uplink.Manifest.Name)
                ? uplink.Manifest.Name
                : uplinkId;
            _settingLocks[setting] = new CoreSettingLock(setting, value, uplinkId, name, reason.Trim());
            LogHost("uplink \"" + uplinkId + "\" locked \"" + setting + "\" " + (value ? "on" : "off") + ": " + reason.Trim());
        }

        /// <summary>The lock an Uplink holds on <paramref name="setting"/>, or <c>null</c> when none does.</summary>
        public CoreSettingLock? SettingLock(string setting) =>
            _settingLocks.TryGetValue(setting, out var held) ? held : null;
    }
}
