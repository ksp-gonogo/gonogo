namespace Sitrep.Host.Settings
{
    /// <summary>
    /// The settings the gonogo screens act on rather than the mod: what mission
    /// history records and whether the main screen plays sound. They are kept
    /// in the settings file with the rest so that every screen showing this
    /// game reads the same answer; a screen holds only a copy, which the file's
    /// value always replaces.
    ///
    /// <para>Each row is named by the id the screens know it by, under the
    /// <see cref="Block"/> block, so a screen maps a row onto its own setting
    /// with no table of its own.</para>
    /// </summary>
    public static class ConsoleSettings
    {
        public const string Block = "CONSOLE";

        public const string MissionHistoryEnabled = Block + "/mission.historyEnabled";
        public const string MissionRecordAllTopics = Block + "/mission.recordAllTopics";
        public const string MissionVideoRecordingEnabled = Block + "/mission.videoRecordingEnabled";
        public const string SoundEnabled = Block + "/sound.enabled";

        public static void Declare(SettingsStore settings)
        {
            settings.Declare(SettingsRow.Bool(
                MissionHistoryEnabled,
                true,
                "Record mission history",
                "Lets the Flight History panel record the live stream as a replayable mission. It captures only the topics the dashboard already carries, so it is cheap to leave on."));
            settings.Declare(SettingsRow.Bool(
                MissionRecordAllTopics,
                false,
                "Record every telemetry topic",
                "While recording, subscribes to every telemetry topic rather than only what the dashboard has open, so a replay can show any widget's history. Raises the mod's load and the recording's size. Has no effect while mission history is off."));
            settings.Declare(SettingsRow.Bool(
                MissionVideoRecordingEnabled,
                false,
                "Record camera video with missions",
                "Reserved for capturing the connected camera feed alongside telemetry. Nothing records video yet. Has no effect while mission history is off."));
            settings.Declare(SettingsRow.Bool(
                SoundEnabled,
                true,
                "Sound effects",
                "Plays the alarm chime, the launch countdown tones and the abort alert on the main screen. Station screens are always silent."));
        }
    }
}
