using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>The signal delay choice a save holds: the switch and the speed signals travel at.</summary>
    internal readonly struct SignalDelayChoice
    {
        /// <summary>The slowest light speed a save can hold, as a fraction of the speed of light.</summary>
        public const double MinLightSpeedScale = 0.01;

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
    /// The signal delay choice as a mod setting Gonogo can read and set. The
    /// save's difficulty settings hold it, so the value read here is the one the
    /// game shows and the one in force.
    ///
    /// <para>KSP-free: the save's node arrives through the delegates handed in,
    /// so every branch can be checked without a save.</para>
    /// </summary>
    internal sealed class CommsDelayModSettings : IModSettingsSource, IModSettingsWriter
    {
        public const string EnabledId = "delayEnabled";
        public const string LightSpeedScaleId = "lightSpeedScale";

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
                    + "1 is real light speed and 0.5 doubles every delay",
                setIn: SetIn,
                writable: true),
        };

        private readonly Func<string?> _unavailable;
        private readonly Func<SignalDelayChoice?> _read;
        private readonly Func<SignalDelayChoice, bool> _write;

        /// <param name="unavailable">Why the choice cannot be reached right now, or null when it can.</param>
        /// <param name="read">The choice the loaded save holds, or null when it could not be read.</param>
        /// <param name="write">Sets the loaded save's choice; false when it could not be written.</param>
        public CommsDelayModSettings(
            Func<string?> unavailable,
            Func<SignalDelayChoice?> read,
            Func<SignalDelayChoice, bool> write)
        {
            _unavailable = unavailable;
            _read = read;
            _write = write;
        }

        public IReadOnlyList<ModSetting> ListModSettings() => Listed;

        public ModSettingValue ReadModSetting(string id)
        {
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
                    + SignalDelayChoice.MinLightSpeedScale.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture)
                    + " and "
                    + SignalDelayChoice.MaxLightSpeedScale.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
            }

            return null;
        }
    }
}
