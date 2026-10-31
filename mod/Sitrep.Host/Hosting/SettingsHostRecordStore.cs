using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Sitrep.Host.Settings;

namespace Sitrep.Host.Hosting
{
    /// <summary>
    /// Keeps the host record in the mod's own settings file, beside the
    /// operator's settings and never in the save, so loading another save does
    /// not change the join code or forget an approved station.
    ///
    /// <para>The three rows are never declared. <see cref="SettingsPublisher"/>
    /// publishes declared rows only, so the last holder's token and the stations'
    /// credentials never reach <c>settings.gonogo</c>, and no settings save can
    /// name them either.</para>
    /// </summary>
    public sealed class SettingsHostRecordStore : IHostRecordStore
    {
        internal const string CodePath = "Host/JoinCode";
        internal const string LastHolderPath = "Host/LastHolder";
        internal const string StationsPath = "Host/Stations";

        private readonly SettingsStore _settings;

        public SettingsHostRecordStore(SettingsStore settings)
        {
            _settings = settings ?? throw new ArgumentNullException(nameof(settings));
        }

        public HostRecordSaved Load()
        {
            var saved = new HostRecordSaved
            {
                Code = Blank(_settings.Text(CodePath)),
                LastHolderToken = Blank(_settings.Text(LastHolderPath)),
            };
            foreach (var entry in (_settings.Text(StationsPath) ?? string.Empty).Split(';'))
            {
                var fields = entry.Split(',');
                if (fields.Length == 3
                    && long.TryParse(fields[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out var at)
                    && Uri.UnescapeDataString(fields[0]).Length > 0)
                {
                    saved.Stations.Add(new ApprovedStationRecord(
                        Uri.UnescapeDataString(fields[0]), Uri.UnescapeDataString(fields[1]), at));
                }
            }

            return saved;
        }

        public void Save(HostRecordSaved saved)
        {
            _settings.Stage(CodePath, saved.Code ?? string.Empty);
            _settings.Stage(LastHolderPath, saved.LastHolderToken ?? string.Empty);
            _settings.Stage(StationsPath, Encode(saved.Stations));
            _settings.Commit();
        }

        /*
         * Percent-encoded so a name holding a comma, a semicolon, a slash pair
         * or a brace can neither split the list nor be read by KSP's file
         * format as a comment.
         */
        private static string Encode(IReadOnlyList<ApprovedStationRecord> stations)
        {
            var sb = new StringBuilder();
            foreach (var s in stations)
            {
                if (sb.Length > 0)
                {
                    sb.Append(';');
                }

                sb.Append(Uri.EscapeDataString(s.Credential)).Append(',')
                    .Append(Uri.EscapeDataString(s.Name)).Append(',')
                    .Append(s.ApprovedAtUnixMs.ToString(CultureInfo.InvariantCulture));
            }

            return sb.ToString();
        }

        private static string? Blank(string? text) => string.IsNullOrEmpty(text) ? null : text;
    }
}
