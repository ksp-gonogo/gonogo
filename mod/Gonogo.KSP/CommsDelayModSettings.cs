using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>The signal delay choice a save holds: the switch and the speed signals travel at.</summary>
    internal readonly struct SignalDelayChoice
    {
        /// <summary>The slowest light speed a save can hold, as a fraction of the speed of light.</summary>
        public const double MinLightSpeedScale = 1e-8;

        /// <summary>The fastest light speed a save can hold, as a fraction of the speed of light.</summary>
        public const double MaxLightSpeedScale = 100.0;

        public SignalDelayChoice(bool enabled, double lightSpeedScale)
        {
            Enabled = enabled;
            LightSpeedScale = lightSpeedScale;
        }

        public bool Enabled { get; }

        public double LightSpeedScale { get; }
    }

    /// <summary>
    /// The save's comms choices as mod settings Gonogo can read and set: signal
    /// delay and its light speed, and "Vessel telemetry requires vessel charge".
    /// The save's difficulty settings hold them, so the value read here is the
    /// one the game shows and the one in force. While an Uplink locks the charge
    /// setting, it reads the locked value, with or without a save, and names the
    /// Uplink and its reason.
    ///
    /// <para>KSP-free: the save's node arrives through the delegates handed in,
    /// so every branch can be checked without a save.</para>
    /// </summary>
    internal sealed class CommsDelayModSettings : IModSettingsSource, IModSettingsWriter
    {
        public const string EnabledId = "delayEnabled";
        public const string LightSpeedScaleId = "lightSpeedScale";
        public const string TelemetryRequiresChargeId = "telemetryRequiresCharge";

        private const string SetIn = "Difficulty settings, Gonogo";

        private static readonly IReadOnlyList<ModSetting> Listed = new[]
        {
            ModSetting.Bool(
                EnabledId,
                "Signal delay",
                ModSettingRefresh.Live,
                description: "Commands and readings take the time light needs to cross the distance. "
                    + "Off, they arrive at once; a craft with no path is still out of contact",
                setIn: SetIn,
                writable: true),
            ModSetting.Number(
                LightSpeedScaleId,
                "Light speed",
                null,
                ModSettingRefresh.Live,
                description: "How fast signals travel, as a fraction of the speed of light. "
                    + "1 is real light speed and 0.5 doubles every delay. Any value from 0.00000001 to 100",
                setIn: SetIn,
                writable: true),
            ModSetting.Bool(
                TelemetryRequiresChargeId,
                "Vessel telemetry requires vessel charge",
                ModSettingRefresh.Live,
                description: GonogoGameParameters.TelemetryRequiresChargeTooltip,
                setIn: SetIn,
                writable: true).WithTags(SettingTags.Setup),
        };

        private readonly Func<string?> _unavailable;
        private readonly Func<SignalDelayChoice?> _read;
        private readonly Func<SignalDelayChoice, bool> _write;
        private readonly Func<bool?> _readCharge;
        private readonly Func<bool, bool> _writeCharge;
        private readonly Func<CoreSettingLock?> _chargeLock;

        /// <param name="unavailable">Why the choice cannot be reached right now, or null when it can.</param>
        /// <param name="read">The choice the loaded save holds, or null when it could not be read.</param>
        /// <param name="write">Sets the loaded save's choice; false when it could not be written.</param>
        /// <param name="readCharge">The loaded save's "Vessel telemetry requires vessel charge" choice, or null when it could not be read.</param>
        /// <param name="writeCharge">Sets that choice in the loaded save; false when it could not be written.</param>
        /// <param name="chargeLock">The lock an Uplink holds on that setting, or null.</param>
        public CommsDelayModSettings(
            Func<string?> unavailable,
            Func<SignalDelayChoice?> read,
            Func<SignalDelayChoice, bool> write,
            Func<bool?> readCharge,
            Func<bool, bool> writeCharge,
            Func<CoreSettingLock?> chargeLock)
        {
            _unavailable = unavailable;
            _read = read;
            _write = write;
            _readCharge = readCharge;
            _writeCharge = writeCharge;
            _chargeLock = chargeLock;
        }

        public IReadOnlyList<ModSetting> ListModSettings() => Listed;

        public ModSettingValue ReadModSetting(string id)
        {
            if (id == TelemetryRequiresChargeId)
            {
                return ReadCharge();
            }

            if (id != EnabledId && id != LightSpeedScaleId)
            {
                return ModSettingValue.Unavailable("not a Gonogo setting");
            }

            var unavailable = _unavailable();
            if (unavailable != null)
            {
                return ModSettingValue.Unavailable(unavailable);
            }

            var choice = _read();
            if (!choice.HasValue)
            {
                return ModSettingValue.Unavailable("the signal delay setting could not be read");
            }

            return id == EnabledId
                ? ModSettingValue.Of(choice.Value.Enabled)
                : ModSettingValue.Of(choice.Value.LightSpeedScale);
        }

        public CommandResult WriteModSetting(string id, ModSettingValue value)
        {
            if (id == TelemetryRequiresChargeId && value.Kind == SettingKind.Bool)
            {
                return WriteCharge(value.AsBool);
            }

            var isSwitch = id == EnabledId && value.Kind == SettingKind.Bool;
            var isScale = id == LightSpeedScaleId && value.Kind == SettingKind.Number;
            if (!isSwitch && !isScale)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            if (isScale)
            {
                var refusal = RefuseLightSpeed(value.AsNumber);
                if (refusal != null)
                {
                    return CommandResult.Fail(CommandErrorCode.Range, refusal);
                }
            }

            var unavailable = _unavailable();
            if (unavailable != null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable, unavailable);
            }

            var current = _read();
            if (!current.HasValue)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "the signal delay setting could not be read");
            }

            var next = isSwitch
                ? new SignalDelayChoice(value.AsBool, current.Value.LightSpeedScale)
                : new SignalDelayChoice(current.Value.Enabled, value.AsNumber);
            return _write(next)
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable, "the signal delay setting could not be set");
        }

        private ModSettingValue ReadCharge()
        {
            if (_chargeLock() is CoreSettingLock held)
            {
                return ModSettingValue.Locked(ModSettingValue.Of(held.Value), held.UplinkName, held.Reason);
            }

            var unavailable = _unavailable();
            if (unavailable != null)
            {
                return ModSettingValue.Unavailable(unavailable);
            }

            return _readCharge() is bool on
                ? ModSettingValue.Of(on)
                : ModSettingValue.Unavailable("the vessel charge setting could not be read");
        }

        private CommandResult WriteCharge(bool on)
        {
            if (_chargeLock() is CoreSettingLock held)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "set by the " + held.UplinkName + " Uplink: " + held.Reason);
            }

            var unavailable = _unavailable();
            if (unavailable != null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable, unavailable);
            }

            return _writeCharge(on)
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable, "the vessel charge setting could not be set");
        }

        /*
         * The light speed a save's stored value means. The node keeps a float, so the
         * slider's own ends read back a hair outside the double range (0.01f is a
         * little under 0.01): a value at or past an end is that end, and only a value
         * that would mean an infinite or undefined delay reads as real light speed.
         */
        internal static double HeldLightSpeed(double stored)
        {
            if (double.IsNaN(stored) || stored <= 0.0)
            {
                return 1.0;
            }

            return Math.Min(SignalDelayChoice.MaxLightSpeedScale, Math.Max(SignalDelayChoice.MinLightSpeedScale, stored));
        }

        /// <summary>Why a light speed cannot be held, or null when it can.</summary>
        internal static string? RefuseLightSpeed(double scale)
        {
            if (double.IsNaN(scale) || scale <= 0.0)
            {
                return "Light speed must be above 0. To turn signal delay off, use the Signal delay switch";
            }

            if (scale < SignalDelayChoice.MinLightSpeedScale || scale > SignalDelayChoice.MaxLightSpeedScale)
            {
                return "Light speed must be between "
                    + ModSettingValue.Of(SignalDelayChoice.MinLightSpeedScale).Spelled()
                    + " and "
                    + ModSettingValue.Of(SignalDelayChoice.MaxLightSpeedScale).Spelled();
            }

            return null;
        }
    }
}
