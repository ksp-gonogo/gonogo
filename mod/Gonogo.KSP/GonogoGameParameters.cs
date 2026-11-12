using System;
using System.Reflection;
using KSP.Localization;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The Gonogo section of a save's difficulty settings, shown beside the
    /// stock CommNet options when a game is created and in the Difficulty
    /// settings of a game in progress. Holds the signal delay choice and
    /// whether a craft with no charge loses its link, so both belong to the
    /// save.
    ///
    /// <para>An Uplink may lock "Vessel telemetry requires vessel charge" (see
    /// <see cref="ICoreSettingLocks"/>). Locked, the row is greyed out at the
    /// Uplink's value with a line under it naming the Uplink and its reason. The save
    /// keeps the player's own choice, so it is theirs again once the Uplink is
    /// gone.</para>
    /// </summary>
    public sealed class GonogoGameParameters : GameParameters.CustomParameterNode
    {
        [GameParameters.CustomParameterUI("Signal delay",
            toolTip = "Commands and readings take the time light needs to cross the distance. "
                + "Off, they arrive at once; a craft with no path is still out of contact")]
        public bool signalDelay = true;

        [GameParameters.CustomFloatParameterUI("Light speed",
            minValue = (float)SignalDelayChoice.MinLightSpeedScale,
            maxValue = (float)SignalDelayChoice.MaxLightSpeedScale,
            addTextField = true,
            displayFormat = "0.############",
            toolTip = "How fast signals travel, as a fraction of the speed of light. "
                + "1 is real light speed and 0.5 doubles every delay. Any value from 0.00000001 to 100")]
        /*
         * Typed, not dragged: the slider KSP draws beside the field is linear, so it
         * cannot reach the small end. A log scale is not an option because KSP reads
         * the typed text as the exponent when logBase is set. The format has to keep
         * a value like 0.00000001 intact, since KSP rounds every committed value
         * through it (F2 would store 0).
         */
        public float lightSpeedScale = 1f;

        [GameParameters.CustomParameterUI("Vessel telemetry requires vessel charge", toolTip = TelemetryRequiresChargeTooltipTag)]
        /*
         * The tooltip is a localisation tag because KSP reads the attribute's text
         * once, as it builds the window, through Localizer.Format. Writing the
         * tag's text before then is the only way the tooltip can name a lock.
         */
        public bool telemetryRequiresCharge = false;

        [GameParameters.CustomStringParameterUI("", lines = 3, autoPersistance = false)]
        /*
         * The line under "Vessel telemetry requires vessel charge" that names the Uplink holding it and
         * why, shown only while a lock holds the row. KSP draws no tooltip over a
         * row it has greyed out, so the reason has to be printed. An empty title
         * makes KSP draw the value alone, and it reads the value live.
         */
        public string telemetryRequiresChargeLock = "";

        internal const string TelemetryRequiresChargeTooltipTag = "#Gonogo_TelemetryRequiresCharge_Tooltip";

        internal const string TelemetryRequiresChargeTooltip =
            "A craft with no electric charge takes no command from a command centre and sends nothing home. "
            + "Its crew can still fly it";

        private static Func<string, CoreSettingLock?> _locks = _ => null;

        /// <summary>The player's own "Vessel telemetry requires vessel charge" choice, which the save keeps while a lock holds the row.</summary>
        private bool _ownTelemetryRequiresCharge;

        public GonogoGameParameters()
        {
            WriteTooltips();
            HoldLockedValues();
        }

        /// <summary>Where the setting locks Uplinks took at registration are read from, once they are known.</summary>
        internal static void UseLocks(Func<string, CoreSettingLock?> locks)
        {
            _locks = locks ?? (_ => null);
            WriteTooltips();
        }

        /// <summary>The lock an Uplink holds on <paramref name="setting"/>, or <c>null</c>.</summary>
        internal static CoreSettingLock? LockOn(string setting) => _locks(setting);

        /// <summary>The "Vessel telemetry requires vessel charge" tooltip, naming the Uplink and its reason while one holds it.</summary>
        internal static string TelemetryRequiresChargeTooltipFor(CoreSettingLock? held) =>
            held == null
                ? TelemetryRequiresChargeTooltip
                : "Set " + (held.Value ? "on" : "off") + " by the " + held.UplinkName + " Uplink: " + held.Reason.TrimEnd('.');

        public override void OnLoad(ConfigNode node)
        {
            base.OnLoad(node);
            /*
             * Read from the node, not the field: a save that never held this setting
             * leaves the field as the constructor set it, which is the locked value
             * while a lock holds the row, and that is not the player's choice.
             */
            _ownTelemetryRequiresCharge = bool.TryParse(node?.GetValue(nameof(telemetryRequiresCharge)), out var own) && own;
            if (LockOn(CoreSettings.TelemetryRequiresCharge) == null)
            {
                telemetryRequiresCharge = _ownTelemetryRequiresCharge;
            }
            HoldLockedValues();
        }

        public override void OnSave(ConfigNode node)
        {
            base.OnSave(node);
            if (LockOn(CoreSettings.TelemetryRequiresCharge) != null)
            {
                node.SetValue(nameof(telemetryRequiresCharge), _ownTelemetryRequiresCharge.ToString(), true);
            }
        }

        public override bool Enabled(MemberInfo member, GameParameters parameters) =>
            member.Name != nameof(telemetryRequiresChargeLock) || LockOn(CoreSettings.TelemetryRequiresCharge) != null;

        public override bool Interactible(MemberInfo member, GameParameters parameters)
        {
            if (member.Name != nameof(telemetryRequiresCharge))
            {
                return true;
            }
            HoldLockedValues();
            return LockOn(CoreSettings.TelemetryRequiresCharge) == null;
        }

        private void HoldLockedValues()
        {
            if (LockOn(CoreSettings.TelemetryRequiresCharge) is CoreSettingLock held)
            {
                telemetryRequiresCharge = held.Value;
                telemetryRequiresChargeLock = TelemetryRequiresChargeTooltipFor(held);
            }
            else
            {
                _ownTelemetryRequiresCharge = telemetryRequiresCharge;
                telemetryRequiresChargeLock = "";
            }
        }

        private static void WriteTooltips()
        {
            try
            {
                Localizer.Tags[TelemetryRequiresChargeTooltipTag] = TelemetryRequiresChargeTooltipFor(LockOn(CoreSettings.TelemetryRequiresCharge));
            }
            catch (Exception)
            {
                // No localiser before the game has loaded one, so no window to show a tooltip in yet either.
            }
        }

        public override string Title => "Signal delay";

        public override string DisplaySection => "Gonogo";

        public override string Section => "Gonogo";

        public override int SectionOrder => 1;

        public override GameParameters.GameMode GameMode => GameParameters.GameMode.ANY;

        public override bool HasPresets => false;
    }
}
