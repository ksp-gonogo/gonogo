using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A skippable snapshot group is left out of a sample whenever none of its listed
    /// readers is due, so a reader missing from <see cref="SnapshotGroups.Readers"/>
    /// would be handed a sample without its group and publish the absence as a value.
    /// These hold the list to every reader there is.
    /// </summary>
    public class SnapshotGroupReadersTests
    {
        /// <summary>
        /// Every source file that names a skippable group, and why it may. A reader in
        /// any other file fails the scan until it is listed in <see cref="SnapshotGroups.Readers"/>
        /// and here.
        /// </summary>
        private static readonly Dictionary<string, string> Audited = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Gonogo.KSP/KspHost.cs"] = "builds the groups",
            ["Sitrep.Host/SnapshotGroups.cs"] = "the reader list",
            ["Sitrep.Host/CareerViewProvider.cs"] = "builders of the career Uplink's Topics, listed by owner",
            ["Sitrep.Host/SpaceCenterViewProvider.cs"] = "builders of the Space Center Uplink's Topics, listed by owner",
            ["Sitrep.Host/PartsViewProvider.cs"] = "parts.power, listed by Topic",
            ["Sitrep.Host/VesselPartsViewProvider.cs"] = "vessel.parts, listed by Topic",
            ["Sitrep.Host/Alarms/ScetThresholdSources.cs"] = "an alarm reads the career through career.status's builder and treats an unbuilt payload as not observable",
            ["Gonogo.KSP/CareerUplink.cs"] = "the Uplink id and its doc comment",
            ["Gonogo.KSP/SpaceCenterUplink.cs"] = "the Uplink id and its doc comment",
            ["Sitrep.Contract/CareerPayloads.cs"] = "a doc comment",
        };

        private static readonly string[] Names = { SnapshotGroups.Career, SnapshotGroups.SpaceCenter, SnapshotGroups.Topology };

        private static readonly string[] Projects = { "Sitrep.Host", "Sitrep.Core", "Sitrep.Contract", "Sitrep.Transport", "Sitrep.Propagation", "Gonogo.KSP" };

        private static string ModRoot([CallerFilePath] string here = "") =>
            Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, ".."));

        [Fact]
        public void EveryFileThatNamesASkippableGroupHasBeenAudited()
        {
            var root = ModRoot();
            var found = new SortedSet<string>(StringComparer.Ordinal);
            foreach (var project in Projects)
            {
                foreach (var file in Directory.EnumerateFiles(Path.Combine(root, project), "*.cs", SearchOption.AllDirectories))
                {
                    var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                    if (relative.Contains("/obj/") || relative.Contains("/bin/"))
                    {
                        continue;
                    }
                    var text = File.ReadAllText(file);
                    if (Names.Any(name => text.Contains("\"" + name + "\"", StringComparison.Ordinal))
                        || text.Contains("SnapshotGroups.", StringComparison.Ordinal))
                    {
                        found.Add(relative);
                    }
                }
            }

            var unaudited = found.Where(file => !Audited.ContainsKey(file) && file != "Gonogo.KSP/GonogoAddon.cs").ToList();
            Assert.True(
                unaudited.Count == 0,
                "these files name a skippable snapshot group: list each reader in SnapshotGroups.Readers and audit the file here: "
                + string.Join(", ", unaudited));
            Assert.Contains("Gonogo.KSP/KspHost.cs", found);
            Assert.Contains("Sitrep.Host/CareerViewProvider.cs", found);
        }

        /// <summary>Every touch of a tripwire group, by the builder that made it.</summary>
        private sealed class Touches
        {
            public string? Builder;
            public readonly Dictionary<string, HashSet<string>> ByGroup = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

            public void Touch(string group)
            {
                if (Builder == null)
                {
                    return;
                }
                if (!ByGroup.TryGetValue(group, out var builders))
                {
                    ByGroup[group] = builders = new HashSet<string>(StringComparer.Ordinal);
                }
                builders.Add(Builder);
            }
        }

        /// <summary>An empty group that notes every read of it.</summary>
        private sealed class TripwireGroup : IDictionary<string, object?>, IList<object?>
        {
            private readonly Dictionary<string, object?> _empty = new Dictionary<string, object?>();
            private readonly Touches _touches;
            private readonly string _group;

            public TripwireGroup(Touches touches, string group)
            {
                _touches = touches;
                _group = group;
            }

            private T Read<T>(T value)
            {
                _touches.Touch(_group);
                return value;
            }

            public object? this[string key] { get => Read<object?>(null); set => Read(0); }
            public object? this[int index] { get => Read<object?>(null); set => Read(0); }
            public ICollection<string> Keys => Read(_empty.Keys);
            public ICollection<object?> Values => Read(_empty.Values);
            public int Count => Read(0);
            public bool IsReadOnly => Read(true);
            public void Add(string key, object? value) => Read(0);
            public void Add(KeyValuePair<string, object?> item) => Read(0);
            public void Add(object? item) => Read(0);
            public void Clear() => Read(0);
            public bool Contains(KeyValuePair<string, object?> item) => Read(false);
            public bool Contains(object? item) => Read(false);
            public bool ContainsKey(string key) => Read(false);
            public void CopyTo(KeyValuePair<string, object?>[] array, int arrayIndex) => Read(0);
            public void CopyTo(object?[] array, int arrayIndex) => Read(0);
            public bool Remove(string key) => Read(false);
            public bool Remove(KeyValuePair<string, object?> item) => Read(false);
            public bool Remove(object? item) => Read(false);
            public int IndexOf(object? item) => Read(-1);
            public void Insert(int index, object? item) => Read(0);
            public void RemoveAt(int index) => Read(0);

            public bool TryGetValue(string key, out object? value)
            {
                value = null;
                return Read(false);
            }

            IEnumerator<KeyValuePair<string, object?>> IEnumerable<KeyValuePair<string, object?>>.GetEnumerator() => Read(_empty.GetEnumerator());
            IEnumerator<object?> IEnumerable<object?>.GetEnumerator() => Read(new List<object?>().GetEnumerator());
            IEnumerator IEnumerable.GetEnumerator() => Read(_empty.GetEnumerator());
        }

        private static KspSnapshot Tripwired(Touches touches) => new KspSnapshot
        {
            Ut = 100.0,
            Values = new Dictionary<string, object?>
            {
                [SnapshotGroups.Career] = new TripwireGroup(touches, SnapshotGroups.Career),
                [SnapshotGroups.SpaceCenter] = new TripwireGroup(touches, SnapshotGroups.SpaceCenter),
                ["gameMode"] = new Dictionary<string, object?> { ["mode"] = "CAREER" },
                ["scene"] = "SPACECENTER",
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = "11111111-1111-1111-1111-111111111111", ["name"] = "Probe" },
                    [SnapshotGroups.Topology] = new TripwireGroup(touches, SnapshotGroups.Topology),
                },
            },
        };

        /// <summary>The Sitrep.Host types each group's listed readers are built by.</summary>
        private static readonly Dictionary<string, Type[]> ReaderTypes = new Dictionary<string, Type[]>(StringComparer.Ordinal)
        {
            [SnapshotGroups.Career] = new[] { typeof(CareerViewProvider) },
            [SnapshotGroups.SpaceCenter] = new[] { typeof(SpaceCenterViewProvider) },
            [SnapshotGroups.Topology] = new[] { typeof(PartsViewProvider), typeof(VesselPartsViewProvider) },
        };

        [Fact]
        public void OnlyTheListedReadersBuildersReadEachGroup()
        {
            var touches = new Touches();
            var snapshot = Tripwired(touches);
            var builders = typeof(ChannelEngine).Assembly.GetTypes()
                .SelectMany(type => type.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly))
                .Where(method => !method.IsGenericMethodDefinition
                    && method.GetParameters() is { Length: 1 } parameters
                    && parameters[0].ParameterType == typeof(KspSnapshot))
                .ToList();
            Assert.True(builders.Count > 20, "the scan found only " + builders.Count + " snapshot builders");

            foreach (var builder in builders)
            {
                touches.Builder = builder.DeclaringType!.FullName + "." + builder.Name;
                try
                {
                    builder.Invoke(null, new object?[] { snapshot });
                }
                catch (TargetInvocationException)
                {
                    // A builder that throws on this snapshot still counts the reads it made first.
                }
            }
            touches.Builder = null;

            foreach (var group in Names)
            {
                var allowed = ReaderTypes[group].Select(type => type.FullName + ".").ToArray();
                var readers = touches.ByGroup.TryGetValue(group, out var found) ? found : new HashSet<string>();
                var unlisted = readers.Where(reader => !allowed.Any(prefix => reader.StartsWith(prefix, StringComparison.Ordinal))).ToList();
                Assert.True(unlisted.Count == 0, "unlisted readers of " + group + ": " + string.Join(", ", unlisted));
            }
            Assert.Contains(SnapshotGroups.Career, touches.ByGroup.Keys);
            Assert.Contains(SnapshotGroups.Topology, touches.ByGroup.Keys);
        }

        [Fact]
        public void EachReadersBuilderIsRegisteredOnlyWhereTheListSaysItIs()
        {
            var registrations = new List<(string File, string Line)>();
            foreach (var file in Directory.EnumerateFiles(Path.Combine(ModRoot(), "Gonogo.KSP"), "*.cs", SearchOption.AllDirectories))
            {
                foreach (var line in File.ReadAllLines(file))
                {
                    if (line.Contains("AddChannelSource(", StringComparison.Ordinal))
                    {
                        registrations.Add((Path.GetFileName(file), line.Trim()));
                    }
                }
            }

            foreach (var (file, line) in registrations)
            {
                if (line.Contains("CareerViewProvider.", StringComparison.Ordinal))
                {
                    Assert.True(file == "CareerUplink.cs", "a career builder is registered outside the career Uplink: " + line);
                }
                if (line.Contains("SpaceCenterViewProvider.", StringComparison.Ordinal))
                {
                    Assert.True(file == "SpaceCenterUplink.cs", "a Space Center builder is registered outside the Space Center Uplink: " + line);
                }
                if (line.Contains("PartsViewProvider.", StringComparison.Ordinal))
                {
                    Assert.True(
                        line.Contains("VesselPartsViewProvider.PartsTopic", StringComparison.Ordinal) || line.Contains("PartsViewProvider.PowerTopic", StringComparison.Ordinal),
                        "a part-tree builder is registered under a Topic the topology readers do not list: " + line);
                }
            }
            Assert.Contains(registrations, r => r.File == "CareerUplink.cs");
        }

        [Fact]
        public void TheListedReadersAreTheTopicsTheirBuildersPublish()
        {
            var career = SnapshotGroups.Readers[SnapshotGroups.Career];
            Assert.Contains(CareerViewProvider.Topic, career.Topics);
            Assert.Contains("career", career.Owners);
            Assert.Contains("spaceCenter", SnapshotGroups.Readers[SnapshotGroups.SpaceCenter].Owners);
            var topology = SnapshotGroups.Readers[SnapshotGroups.Topology];
            Assert.Contains(VesselPartsViewProvider.PartsTopic, topology.Topics);
            Assert.Contains(PartsViewProvider.PowerTopic, topology.Topics);
        }
    }
}
