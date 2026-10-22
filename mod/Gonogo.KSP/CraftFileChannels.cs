using System;
using System.Collections.Generic;
using System.IO;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>spaceCenter.craft.&lt;facility&gt;.&lt;file&gt;.parts</c> dynamic
    /// namespace: one saved craft file's part tree, read from the file's own
    /// <c>PART</c> nodes (<see cref="CraftFileTopology"/>) and published while
    /// something subscribes to that craft's topic. Nothing is instantiated and no
    /// craft is loaded.
    ///
    /// <para>Also records every launch into <see cref="CraftLaunchLog"/>. KSP's
    /// own Launch button and the console both end in the rollout event, so one
    /// hook sees both.</para>
    ///
    /// <para><b>Not an Uplink discovered by attribute scan, deliberately.</b> It
    /// ships inside <c>Gonogo.dll</c> and is registered directly by
    /// <see cref="GonogoAddon"/>, the way <see cref="FleetChannels"/> is.</para>
    /// </summary>
    public sealed class CraftFileChannels : ISitrepUplink
    {
        /// <summary>
        /// How long a listing of the craft folders is reused. The folders are
        /// walked only while some craft topic is subscribed, and a file the
        /// player has just saved is picked up within this long.
        /// </summary>
        private const double ListSeconds = 2.0;

        private static readonly PerfBudget CraftBuildBudget = new PerfBudget(
            "CraftFileChannels crafts read", threshold: 20, windowSec: 1.0, unit: "crafts");

        private IUplinkHost? _host;
        private IDynamicChannelSource? _source;

        /* Main thread only, from here down. */
        private readonly List<CraftFile> _files = new List<CraftFile>();
        private double _listedAt = double.NegativeInfinity;
        private string? _listedSave;
        private readonly Dictionary<string, CachedRows> _rows = new Dictionary<string, CachedRows>(StringComparer.Ordinal);
        /* The file version each watched topic was last captured at, forgotten when nobody watches it, so a subscriber arriving later is sent the tree again. */
        private readonly Dictionary<string, long> _captured = new Dictionary<string, long>(StringComparer.Ordinal);

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "craftFiles",
            Bundled = true,
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>(),
        };

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            _host = host;
            _source = host.RegisterDynamicNamespace(CraftFileTopic.Prefix, new ChannelDeclaration
            {
                Kind = SampleKind.Discrete,
                Requires = Requirement.None,
                Delivery = Delivery.LossyLatest,
                /* A craft file is a record in the save, held at the home command like the craft list it is picked from, so each command centre reads it after its own delay home and a blackout never freezes it. */
                Delay = DelayRole.Delayed,
                HeldAtHome = true,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            });
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, CraftFileTopic.Prefix);
            /* The hook lives for the whole process: this registers once, before the main menu, and launches span every save. */
            GameEvents.OnVesselRollout.Add(OnRollout);
        }

        /* An instance method on purpose: EventData.Add reads the handler's Target, which is null for a static method and throws. */
        private void OnRollout(ShipConstruct ship)
        {
            try
            {
                var path = FlightDriver.newShipToLoadPath;
                if (ship == null || string.IsNullOrEmpty(path))
                {
                    return;
                }

                CraftLaunchLog.Current.RecordLaunch(
                    ship.shipFacility.ToString(),
                    Path.GetFileNameWithoutExtension(path),
                    ship.shipName,
                    Planetarium.GetUniversalTime());
            }
            catch (Exception ex)
            {
                GonogoLog.WarnLimited("recording a craft launch failed", ex);
            }
        }

        /// <summary>MAIN-THREAD: the part rows of every watched craft file whose version has not been sent to its current watchers.</summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var save = HighLogic.SaveFolder;
            if (_host == null || string.IsNullOrEmpty(save))
            {
                return null;
            }

            RefreshListing(save);
            var watched = new HashSet<string>(StringComparer.Ordinal);
            var captures = new List<CraftCapture>();
            var built = 0;
            foreach (var file in _files)
            {
                var key = CraftFileTopic.Key(file.Facility, file.Name);
                if (!_host.IsAnyTopicSubscribed(CraftFileTopic.Prefix + key))
                {
                    continue;
                }

                watched.Add(key);
                if (_captured.TryGetValue(key, out var sent) && sent == file.Modified)
                {
                    continue;
                }

                var hit = _rows.TryGetValue(file.Path, out var cached) && cached.Modified == file.Modified;
                if (!hit && built > 0)
                {
                    /* One craft is read per tick, so opening a long list of crafts does not stall a frame. */
                    continue;
                }

                if (!hit)
                {
                    CraftBuildBudget.Record(1, snapshot != null ? snapshot.Ut : 0.0);
                    built++;
                    cached = new CachedRows(file.Modified, ReadRows(file.Path));
                    _rows[file.Path] = cached;
                }

                _captured[key] = file.Modified;
                if (cached.Rows != null)
                {
                    captures.Add(new CraftCapture { Key = key, Rows = cached.Rows });
                }
            }

            foreach (var key in new List<string>(_captured.Keys))
            {
                if (!watched.Contains(key))
                {
                    _captured.Remove(key);
                }
            }

            return captures.Count == 0 ? null : new CraftFileCapture { Ut = snapshot != null ? snapshot.Ut : 0.0, Crafts = captures };
        }

        /// <summary>COURIER-THREAD: publish each captured craft's part tree on its own topic.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not CraftFileCapture capture || _source == null)
            {
                return;
            }

            foreach (var craft in capture.Crafts)
            {
                if (VesselPartsViewProvider.BuildCraftFilePartsWire(craft.Rows) is { } wire)
                {
                    _source.Publisher(craft.Key).Publish(wire, capture.Ut);
                }
            }
        }

        private static List<object?>? ReadRows(string path)
        {
            try
            {
                return CraftFileTopology.Build(ConfigNode.Load(path));
            }
            catch (Exception ex)
            {
                GonogoLog.WarnLimited("craft file part read failed for " + path + ", omitting", ex);
                return null;
            }
        }

        private void RefreshListing(string save)
        {
            var now = Time.realtimeSinceStartup;
            if (_listedSave == save && now >= _listedAt && now - _listedAt < ListSeconds)
            {
                return;
            }

            if (_listedSave != save)
            {
                _rows.Clear();
                _captured.Clear();
            }

            _files.Clear();
            foreach (var facility in new[] { EditorFacility.VAB, EditorFacility.SPH })
            {
                string folder;
                try
                {
                    folder = ShipConstruction.GetShipsPathFor(save, facility);
                }
                catch (Exception ex)
                {
                    GonogoLog.WarnLimited("craft path lookup failed for " + facility + ", skipping", ex);
                    continue;
                }

                if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder))
                {
                    continue;
                }

                foreach (var path in Directory.GetFiles(folder, "*.craft"))
                {
                    _files.Add(new CraftFile
                    {
                        Facility = facility.ToString(),
                        Name = Path.GetFileNameWithoutExtension(path),
                        Path = path,
                        Modified = File.GetLastWriteTimeUtc(path).Ticks,
                    });
                }
            }

            _listedAt = now;
            _listedSave = save;
        }

        private sealed class CraftFile
        {
            public string Facility = "";
            public string Name = "";
            public string Path = "";
            public long Modified;
        }

        private sealed class CachedRows
        {
            public CachedRows(long modified, List<object?>? rows)
            {
                Modified = modified;
                Rows = rows;
            }

            public long Modified { get; }

            public List<object?>? Rows { get; }
        }

        private sealed class CraftCapture
        {
            public string Key = "";
            public List<object?> Rows = new List<object?>();
        }

        private sealed class CraftFileCapture
        {
            public double Ut;
            public List<CraftCapture> Crafts = new List<CraftCapture>();
        }
    }
}
