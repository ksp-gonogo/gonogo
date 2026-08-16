using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace Sitrep.CaptureAnalysis;

/// <summary>
/// One line of a capture: whatever the Sitrep host put on the wire, plus the
/// line number so a complaint about it can be traced back.
/// </summary>
public sealed class CaptureRecord
{
    public CaptureRecord(int lineNumber, string type, string topic, double? validAtUt, JsonElement? payload)
    {
        LineNumber = lineNumber;
        Type = type;
        Topic = topic;
        ValidAtUt = validAtUt;
        Payload = payload;
    }

    public int LineNumber { get; }

    /// <summary><c>stream-data</c> for a sample, <c>event</c> for subscription acknowledgements and the like.</summary>
    public string Type { get; }

    public string Topic { get; }

    /// <summary>The frame's <c>meta.validAt</c>, which is a KSP UT and not a wall clock.</summary>
    public double? ValidAtUt { get; }

    /// <summary>Null for a frame that carried no payload at all, which is a fact worth keeping rather than skipping.</summary>
    public JsonElement? Payload { get; }

    public bool IsSample => Type == "stream-data" && Payload.HasValue && Payload.Value.ValueKind == JsonValueKind.Object;

    /// <summary>
    /// A sample the game had actually started for. The host stamps
    /// <c>validAt = 0</c> on the frames it emits before there is a universe to
    /// timestamp against, and a capture opened at the main menu or during a scene
    /// load begins with a handful of them. Left in, that single zero sits 146,000
    /// seconds from its neighbour and wrecks every interval derived from the
    /// series, which is exactly the kind of artefact that gets read as a warp
    /// change.
    /// </summary>
    public bool IsTimestampedSample => IsSample && ValidAtUt.HasValue && ValidAtUt.Value > 0.0;
}

/// <summary>A parsed capture file, including what could not be parsed.</summary>
public sealed class Capture
{
    public Capture(string path, IReadOnlyList<CaptureRecord> records, int unparseableLines, int totalLines)
    {
        Path = path;
        Records = records;
        UnparseableLines = unparseableLines;
        TotalLines = totalLines;
    }

    public string Path { get; }

    public IReadOnlyList<CaptureRecord> Records { get; }

    /// <summary>
    /// Lines that were not JSON. Reported rather than swallowed: a capture cut
    /// off mid-frame by a killed harness ends in a partial line, and a tool that
    /// hid that would be hiding the reason its last sample looks odd.
    /// </summary>
    public int UnparseableLines { get; }

    public int TotalLines { get; }

    public IReadOnlyList<string> TopicsPresent
    {
        get
        {
            var topics = new SortedSet<string>(StringComparer.Ordinal);
            foreach (CaptureRecord record in Records)
            {
                if (record.Topic.Length > 0)
                {
                    topics.Add(record.Topic);
                }
            }

            return new List<string>(topics);
        }
    }

    public int SampleCount(string topic)
    {
        int count = 0;
        foreach (CaptureRecord record in Records)
        {
            if (record.Topic == topic && record.IsSample)
            {
                count++;
            }
        }

        return count;
    }

    public IReadOnlyList<CaptureRecord> Samples(string topic)
    {
        var samples = new List<CaptureRecord>();
        foreach (CaptureRecord record in Records)
        {
            if (record.Topic == topic && record.IsSample)
            {
                samples.Add(record);
            }
        }

        return samples;
    }

    /// <summary>Samples on <paramref name="topic"/> that carry a real UT; see <see cref="CaptureRecord.IsTimestampedSample"/>.</summary>
    public IReadOnlyList<CaptureRecord> TimestampedSamples(string topic)
    {
        var samples = new List<CaptureRecord>();
        foreach (CaptureRecord record in Records)
        {
            if (record.Topic == topic && record.IsTimestampedSample)
            {
                samples.Add(record);
            }
        }

        return samples;
    }

    /// <summary>How many samples were dropped for carrying no game time, across all topics.</summary>
    public int PreGameSampleCount
    {
        get
        {
            int count = 0;
            foreach (CaptureRecord record in Records)
            {
                if (record.IsSample && !record.IsTimestampedSample)
                {
                    count++;
                }
            }

            return count;
        }
    }
}

/// <summary>
/// Reads the newline-delimited JSON that <c>capture-sitrep-ws.mjs</c> writes:
/// one raw server frame per line, no envelope, no trailer.
/// </summary>
public static class CaptureReader
{
    public static Capture ReadFile(string path)
    {
        return Read(path, File.ReadLines(path));
    }

    public static Capture Read(string path, IEnumerable<string> lines)
    {
        var records = new List<CaptureRecord>();
        int lineNumber = 0;
        int unparseable = 0;

        foreach (string line in lines)
        {
            lineNumber++;
            if (line.Length == 0)
            {
                continue;
            }

            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(line);
            }
            catch (JsonException)
            {
                unparseable++;
                continue;
            }

            using (document)
            {
                JsonElement root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object)
                {
                    unparseable++;
                    continue;
                }

                records.Add(new CaptureRecord(
                    lineNumber,
                    ReadString(root, "type"),
                    ReadString(root, "topic"),
                    ReadValidAt(root),
                    // Cloned because the JsonDocument that owns the buffer is
                    // disposed at the end of this block; a JsonElement outliving
                    // its document reads freed memory.
                    root.TryGetProperty("payload", out JsonElement payload) && payload.ValueKind != JsonValueKind.Null
                        ? payload.Clone()
                        : (JsonElement?)null));
            }
        }

        return new Capture(path, records, unparseable, lineNumber);
    }

    private static string ReadString(JsonElement element, string name)
    {
        return element.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";
    }

    private static double? ReadValidAt(JsonElement root)
    {
        if (root.TryGetProperty("meta", out JsonElement meta)
            && meta.ValueKind == JsonValueKind.Object
            && meta.TryGetProperty("validAt", out JsonElement validAt)
            && validAt.ValueKind == JsonValueKind.Number)
        {
            return validAt.GetDouble();
        }

        return null;
    }
}
