using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The ids of Gonogo's own settings that an Uplink may lock with
    /// <see cref="ICoreSettingLocks.Lock"/>. Useful for naming the setting to
    /// lock without spelling its id by hand.
    /// </summary>
    /// <category>Uplink API</category>
    public static class CoreSettings
    {
        /// <summary>
        /// "Vessel telemetry requires vessel charge", in the Gonogo section of a save's difficulty
        /// settings. On, a craft with no electric charge takes no command from a
        /// command centre and sends nothing home, while its crew can still fly
        /// it. Off, which a new save starts with, the comms network alone
        /// decides a craft's link. Its value is a <c>bool</c>.
        /// </summary>
        public const string TelemetryRequiresCharge = "telemetryRequiresCharge";

        /// <summary>Every id an Uplink may lock.</summary>
        public static readonly IReadOnlyList<string> All = new[] { TelemetryRequiresCharge };
    }

    /// <summary>
    /// Holds one of Gonogo's own settings at a value for the session. The game
    /// shows the setting greyed out at that value, with a line under it giving
    /// the Uplink's name and its reason. Useful for an Uplink whose mod
    /// already decides what the setting controls, so the player is not offered
    /// a choice that would change nothing. Used by a comms Uplink whose mod
    /// cuts the link of a craft with no charge itself, to hold
    /// <see cref="CoreSettings.TelemetryRequiresCharge"/> on.
    ///
    /// <para>The host an Uplink is registered with implements it. Reach it
    /// from <see cref="ISitrepUplink.Register"/> as
    /// <c>if (host is ICoreSettingLocks locks) locks.Lock(...)</c>; a host
    /// without it (a test host, say) has no settings to lock.</para>
    ///
    /// <para>The lock lasts for the session and is shown in every save. The
    /// first Uplink to lock a setting holds it: a later lock of the same
    /// setting is logged and ignored, whatever its value.</para>
    /// </summary>
    /// <category>Uplink API</category>
    public interface ICoreSettingLocks
    {
        /// <summary>
        /// Locks <paramref name="setting"/> at <paramref name="value"/>, naming
        /// the calling Uplink and <paramref name="reason"/> to the player. Only
        /// valid inside <see cref="ISitrepUplink.Register"/>, which is how the
        /// host knows which Uplink is calling; a call from anywhere else, for a
        /// setting not in <see cref="CoreSettings.All"/>, or with no reason is
        /// logged and ignored.
        /// </summary>
        /// <param name="setting">The setting, one of <see cref="CoreSettings.All"/>.</param>
        /// <param name="value">The value it is held at.</param>
        /// <param name="reason">One sentence for the player saying why, for example "this comms mod already cuts the link of a craft with no charge".</param>
        void Lock(string setting, bool value, string reason);
    }
}
