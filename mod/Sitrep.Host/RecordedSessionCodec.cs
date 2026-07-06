using System;
using System.Collections.Generic;
using System.Text;
using Sitrep.Core.Serialization;

namespace Sitrep.Host
{
    /// <summary>
    /// Hand-rolled JSON codec for <see cref="RecordedSession"/> — REUSES
    /// <c>Sitrep.Core</c>'s zero-external-dep <c>JsonWriter</c>/<c>JsonReader</c>
    /// (and, transitively through them, the NaN/Infinity sentinel policy in
    /// <c>NanPolicy</c>) rather than hand-rolling a second JSON
    /// parser/writer in this assembly. Those types are <c>internal</c> to
    /// <c>Sitrep.Core</c>; <c>Sitrep.Core.csproj</c> grants this assembly
    /// friend-assembly visibility via <c>&lt;InternalsVisibleTo Include="Sitrep.Host" /&gt;</c>
    /// — the same pattern <c>Sitrep.Skeleton</c> already uses for its own
    /// Tests project. Field shape follows the M5b plan's record-format spec
    /// exactly: <c>{ schemaVersion, startUt, entries: [{ t, kind, snapshot? | event? }] }</c>.
    /// </summary>
    public static class RecordedSessionCodec
    {
        /// <summary>The only <see cref="RecordedSession.SchemaVersion"/> this codec understands. <see cref="Parse"/> rejects anything else rather than silently misreading a future/incompatible format.</summary>
        public const int CurrentSchemaVersion = 1;

        public static string Write(RecordedSession session)
        {
            if (session == null)
            {
                throw new ArgumentNullException(nameof(session));
            }

            var sb = new StringBuilder();
            AppendSession(sb, session);
            return sb.ToString();
        }

        public static RecordedSession Parse(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));

            var schemaVersion = (int)RequireDouble(raw, "schemaVersion");
            if (schemaVersion != CurrentSchemaVersion)
            {
                throw new FormatException(
                    $"Unsupported RecordedSession schemaVersion {schemaVersion} — this build only understands schemaVersion {CurrentSchemaVersion}.");
            }

            return new RecordedSession
            {
                SchemaVersion = schemaVersion,
                StartUt = RequireDouble(raw, "startUt"),
                Entries = ParseEntries(RequireArray(raw, "entries")),
            };
        }

        // ----- write -----

        private static void AppendSession(StringBuilder sb, RecordedSession session)
        {
            sb.Append('{');
            AppendField(sb, "schemaVersion", first: true);
            JsonWriter.AppendInteger(sb, session.SchemaVersion);

            AppendField(sb, "startUt");
            JsonWriter.AppendNumber(sb, session.StartUt);

            AppendField(sb, "entries");
            sb.Append('[');
            for (var i = 0; i < session.Entries.Count; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }
                AppendEntry(sb, session.Entries[i]);
            }
            sb.Append(']');
            sb.Append('}');
        }

        private static void AppendEntry(StringBuilder sb, RecordedEntry entry)
        {
            sb.Append('{');
            AppendField(sb, "t", first: true);
            JsonWriter.AppendNumber(sb, entry.T);

            AppendField(sb, "kind");
            JsonWriter.AppendString(sb, entry.Kind);

            if (entry.Kind == "snapshot" && entry.Snapshot != null)
            {
                AppendField(sb, "snapshot");
                sb.Append('{');
                JsonWriter.AppendString(sb, "values");
                sb.Append(':');
                JsonWriter.AppendValue(sb, entry.Snapshot.Values);
                sb.Append('}');
            }
            else if (entry.Kind == "event" && entry.Event != null)
            {
                AppendField(sb, "event");
                sb.Append('{');
                JsonWriter.AppendString(sb, "eventKind");
                sb.Append(':');
                JsonWriter.AppendString(sb, entry.Event.EventKind);
                sb.Append(',');
                JsonWriter.AppendString(sb, "args");
                sb.Append(':');
                JsonWriter.AppendValue(sb, entry.Event.Args);
                sb.Append('}');
            }

            sb.Append('}');
        }

        private static void AppendField(StringBuilder sb, string name, bool first = false)
        {
            if (!first)
            {
                sb.Append(',');
            }
            JsonWriter.AppendString(sb, name);
            sb.Append(':');
        }

        // ----- read -----

        private static List<RecordedEntry> ParseEntries(List<object?> raw)
        {
            var entries = new List<RecordedEntry>(raw.Count);
            foreach (var item in raw)
            {
                var obj = ExpectObject(item);
                var kind = RequireString(obj, "kind");
                if (kind != "snapshot" && kind != "event")
                {
                    throw new FormatException($"Unknown RecordedEntry \"kind\" \"{kind}\" — expected \"snapshot\" or \"event\".");
                }

                var snapshotObj = obj.TryGetValue("snapshot", out var snapshotRaw) ? snapshotRaw as Dictionary<string, object?> : null;
                var eventObj = obj.TryGetValue("event", out var eventRaw) ? eventRaw as Dictionary<string, object?> : null;

                var entry = new RecordedEntry
                {
                    T = RequireDouble(obj, "t"),
                    Kind = kind,
                };

                if (kind == "snapshot")
                {
                    if (snapshotObj == null)
                    {
                        throw new FormatException("RecordedEntry with kind \"snapshot\" is missing its \"snapshot\" payload.");
                    }
                    if (eventObj != null)
                    {
                        throw new FormatException("RecordedEntry with kind \"snapshot\" must not carry an \"event\" payload.");
                    }
                    entry.Snapshot = new RecordedSnapshotPayload
                    {
                        Values = RequireDictionary(snapshotObj, "values"),
                    };
                }
                else // kind == "event"
                {
                    if (eventObj == null)
                    {
                        throw new FormatException("RecordedEntry with kind \"event\" is missing its \"event\" payload.");
                    }
                    if (snapshotObj != null)
                    {
                        throw new FormatException("RecordedEntry with kind \"event\" must not carry a \"snapshot\" payload.");
                    }
                    entry.Event = new RecordedEventPayload
                    {
                        EventKind = RequireString(eventObj, "eventKind"),
                        Args = RequireDictionary(eventObj, "args"),
                    };
                }

                entries.Add(entry);
            }
            return entries;
        }

        private static Dictionary<string, object?> ExpectObject(object? value)
        {
            if (value is Dictionary<string, object?> dict)
            {
                return dict;
            }
            throw new FormatException("Expected a JSON object in a RecordedSession document.");
        }

        private static List<object?> RequireArray(Dictionary<string, object?> raw, string key)
        {
            if (raw.TryGetValue(key, out var value) && value is List<object?> list)
            {
                return list;
            }
            throw new FormatException($"Missing or non-array required field \"{key}\".");
        }

        private static string RequireString(Dictionary<string, object?> raw, string key)
        {
            if (raw.TryGetValue(key, out var value) && value is string s)
            {
                return s;
            }
            throw new FormatException($"Missing or non-string required field \"{key}\".");
        }

        private static double RequireDouble(Dictionary<string, object?> raw, string key)
        {
            if (raw.TryGetValue(key, out var value) && value is double d)
            {
                return d;
            }
            throw new FormatException($"Missing or non-numeric required field \"{key}\".");
        }

        private static Dictionary<string, object?> RequireDictionary(Dictionary<string, object?> raw, string key)
        {
            if (raw.TryGetValue(key, out var value) && value is Dictionary<string, object?> dict)
            {
                return dict;
            }
            throw new FormatException($"Missing or non-object required field \"{key}\".");
        }
    }
}
