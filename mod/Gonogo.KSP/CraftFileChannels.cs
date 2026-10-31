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

        /// <summary>How long a craft file that gave no parts waits before it is read again, so one that never reads is not tried every tick.</summary>
        private const double RetrySeconds = 5.0;

        private static readonly PerfBudget CraftBuildBudget = new PerfBudget(
            "CraftFileChannels crafts read", threshold: 20, windowSec: 1.0, unit: "crafts");

        private IUplinkHost? _host;
        private IDynamicChannelSource? _source;

        /* Main thread only, from here down. */
        private readonly List<CraftFile> _files = new List<CraftFile>();
        private double _listedAt = double.NegativeInfinity;
        private string? _listedSave;
        private readonly CraftReadCache _reads = new CraftReadCache(RetrySeconds);
        /* The file version each watched topic was last captured at, forgotten when nobody watches it, so a subscriber arriving later is sent the tree again. */
        private readonly Dictionary<string, long> _captured = new Dictionary<string, long>(StringComparer.Ordinal);
        /* The reason each watched topic was last sent as unreadable, forgotten with it, so each reason is sent once and a later subscriber is sent it again. */
        private readonly Dictionary<string, string> _failed = new Dictionary<string, string>(StringComparer.Ordinal);

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

                var file = Path.GetFileNameWithoutExtension(path);
                CraftLaunchLog.Current.RecordLaunch(
                    ship.shipFacility.ToString(),
                    file,
                    GameWords.CraftName(ship.shipName, file),
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
            var now = Time.realtimeSinceStartup;
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

                var hit = _reads.TryGet(file.Path, file.Modified, now, out var read);
                if (hit && read.Rows == null)
                {
                    /* A failed read waits out its retry time, and the file is not marked sent, so the retry that succeeds is published. */
                    continue;
                }

                if (!hit && built > 0)
                {
                    /* One craft is read per tick, so opening a long list of crafts does not stall a frame. */
                    continue;
                }

                if (!hit)
                {
                    CraftBuildBudget.Record(1, CraftCaptureStamp.Ut(snapshot?.Ut, Planetarium.GetUniversalTime));
                    built++;
                    read = ReadRows(file.Path);
                    if (_reads.Store(file.Path, file.Modified, now, read))
                    {
                        GonogoLog.Warn("craftFiles", "the " + file.Facility + " craft " + file.Name + " cannot be drawn: " + read.Failure);
                    }
                }

                if (read.Rows == null)
                {
                    var failure = read.Failure ?? "the file could not be read";
                    if (!_failed.TryGetValue(key, out var told) || told != failure)
                    {
                        _failed[key] = failure;
                        captures.Add(new CraftCapture { Key = key, Failure = failure });
                    }

                    continue;
                }

                _failed.Remove(key);
                _captured[key] = file.Modified;
                captures.Add(new CraftCapture { Key = key, Rows = read.Rows });
            }

            foreach (var key in new List<string>(_captured.Keys))
            {
                if (!watched.Contains(key))
                {
                    _captured.Remove(key);
                }
            }

            foreach (var key in new List<string>(_failed.Keys))
            {
                if (!watched.Contains(key))
                {
                    _failed.Remove(key);
                }
            }

            return captures.Count == 0 ? null : new CraftFileCapture { Ut = CraftCaptureStamp.Ut(snapshot?.Ut, Planetarium.GetUniversalTime), Crafts = captures };
        }

        /// <summary>COURIER-THREAD: publish each captured craft's part tree on its own topic, or an empty one carrying why the file gave none.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not CraftFileCapture capture || _source == null)
            {
                return;
            }

            foreach (var craft in capture.Crafts)
            {
                _source.Publisher(craft.Key).Publish(VesselPartsViewProvider.BuildCraftFilePartsWire(craft.Rows, craft.Failure), capture.Ut);
            }
        }

        private static CraftRead ReadRows(string path)
        {
            try
            {
                var node = ConfigNode.Load(path);
                if (node == null)
                {
                    return CraftRead.Failed("the file could not be read");
                }

                var rows = CraftFileTopology.Build(node, out var failure);
                return rows != null ? CraftRead.Of(rows) : CraftRead.Failed(failure ?? "it has no parts");
            }
            catch (Exception ex)
            {
                return CraftRead.Failed("the file could not be read (" + ex.GetType().Name + ")");
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
                _reads.Clear();
                _captured.Clear();
                _failed.Clear();
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

        private sealed class CraftCapture
        {
            public string Key = "";
            public List<object?>? Rows;
            public string? Failure;
        }

        private sealed class CraftFileCapture
        {
            public double Ut;
            public List<CraftCapture> Crafts = new List<CraftCapture>();
        }
    }
}
