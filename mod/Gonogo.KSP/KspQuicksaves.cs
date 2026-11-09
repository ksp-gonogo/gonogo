using System;
using System.Collections;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using SaveUpgradePipeline;
using Sitrep.Contract;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Quicksave and quickload from mission control. Mirrors the checks and calls of
    /// stock's <c>QuickSaveLoad</c> rather than invoking it, because its entry points
    /// return void and report only by screen message, and a screen in mission control
    /// needs the outcome.
    /// </summary>
    internal static class KspQuicksaves
    {
        private const string LockId = "gonogo.quickload";
        private const float HoldSeconds = 1f;
        private const float ResetWaitSeconds = 60f;

        /// <summary>The publisher of <c>ksp.gameLoaded</c>.</summary>
        internal static IChannelPublisher? Publisher;

        /// <summary>Where the Uplinks' save guards are registered.</summary>
        internal static Kernel? Kernel;

        private sealed class PendingLoad
        {
            public string LoadId = "";
            public string Folder = "";
            public string Name = "";
            public double SaveUt;
            public double FromUt;
            public string RequestedBy = "";
        }

        private static PendingLoad? _scheduled;

        internal static bool LoadScheduled => _scheduled != null;

        /// <summary>
        /// Stock's rule, as <c>QuickSaveLoad.quickSave</c> and
        /// <c>QuickSaveClearToSave</c> apply it. Narrower than
        /// <c>ClearToSave() == CLEAR</c>: stock refuses a quicksave only on a ladder,
        /// moving over the surface or about to crash, and not at all with
        /// <c>CAN_ALWAYS_QUICKSAVE</c> set.
        /// </summary>
        internal static bool QuicksaveAllowedNow()
        {
            var game = HighLogic.CurrentGame;
            if (game == null || game.Mode == Game.Modes.MISSION || LoadScheduled)
            {
                return false;
            }
            if (!HighLogic.LoadedSceneIsFlight
                || !game.Parameters.Flight.CanQuickSave
                || !InputLockManager.IsUnlocked(ControlTypes.QUICKSAVE))
            {
                return false;
            }
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || vessel.state == Vessel.State.DEAD)
            {
                return false;
            }
            if (Kernel != null && SaveGuards.AnyForbids(Kernel))
            {
                return false;
            }
            var clear = FlightGlobals.ClearToSave(false);
            return clear == ClearToSaveStatus.CLEAR
                || GameSettings.CAN_ALWAYS_QUICKSAVE
                || (clear != ClearToSaveStatus.NOT_WHILE_ON_A_LADDER
                    && clear != ClearToSaveStatus.NOT_WHILE_MOVING_OVER_SURFACE
                    && clear != ClearToSaveStatus.NOT_WHILE_ABOUT_TO_CRASH);
        }

        /// <summary>Why the game would not take a quickload now, or null when it would.</summary>
        internal static string? QuickloadRefusal()
        {
            var game = HighLogic.CurrentGame;
            if (game == null)
            {
                return "no game is loaded";
            }
            if (game.Mode == Game.Modes.MISSION)
            {
                return "not in a mission";
            }
            if (LoadScheduled)
            {
                return "a quickload is running";
            }
            if (!game.Parameters.Flight.CanQuickLoad || !InputLockManager.IsUnlocked(ControlTypes.QUICKLOAD))
            {
                return "this game does not permit quickloading now";
            }
            return _slots?.Quicksave == null ? "there is no quicksave" : null;
        }

        internal static CommandResult<SaveWritten> Quicksave()
        {
            if (!QuicksaveAllowedNow())
            {
                return CommandResult<SaveWritten>.Fail(CommandErrorCode.NotClearToProceed, GameWords.CantSaveNow);
            }
            var folder = HighLogic.SaveFolder;
            KeepPreviousQuicksave(folder);
            GameEvents.onGameAboutToQuicksave.Fire();
            var game = HighLogic.CurrentGame.Updated();
            game.startScene = GameScenes.FLIGHT;
            var written = GamePersistence.SaveGame(game, SaveFiles.Quicksave, folder, SaveMode.BACKUP);
            game.startScene = GameScenes.SPACECENTER;
            if (string.IsNullOrEmpty(written))
            {
                return CommandResult<SaveWritten>.Fail(CommandErrorCode.NotClearToProceed, GameWords.CantSaveNow);
            }
            ScreenMessages.PostScreenMessage(GameWords.Sentence("#autoLOC_174669", "Quicksaved"), 2f, ScreenMessageStyle.UPPER_CENTER);
            if (QuickSaveLoad.fetch != null
                && QuickSaveLoad.fetch.AutoSaveOnQuickSave
                && FlightGlobals.ClearToSave() == ClearToSaveStatus.CLEAR)
            {
                GamePersistence.SaveGame(game, "persistent", folder, SaveMode.OVERWRITE);
            }
            var saved = new FileInfo(SlotPath(folder, SaveFiles.Quicksave));
            _slotsDirty = true;
            return CommandResult<SaveWritten>.Ok(new SaveWritten
            {
                SaveId = SaveFiles.IdOf(folder, SaveFiles.Quicksave, saved.Length, saved.LastWriteTimeUtc),
                Ut = Planetarium.GetUniversalTime(),
            });
        }

        internal static CommandResult<LoadScheduled> Quickload(string saveId, string requestedBy)
        {
            var refusal = QuickloadRefusal();
            if (refusal != null)
            {
                return CommandResult<LoadScheduled>.Fail(CommandErrorCode.NotClearToProceed, refusal);
            }
            var folder = HighLogic.SaveFolder;
            var (chosen, name) = FindSlot(_slots, saveId);
            if (chosen == null || !StillOnDisk(folder, name, saveId))
            {
                return CommandResult<LoadScheduled>.Fail(CommandErrorCode.WrongState, "that save has been rewritten");
            }
            var addon = GonogoAddon.Instance;
            if (addon == null)
            {
                return CommandResult<LoadScheduled>.Fail(CommandErrorCode.WrongState, "the game is not ready");
            }
            var pending = new PendingLoad
            {
                LoadId = Guid.NewGuid().ToString("N"),
                Folder = folder,
                Name = name,
                SaveUt = chosen.Ut,
                FromUt = Planetarium.GetUniversalTime(),
                RequestedBy = requestedBy,
            };
            InputLockManager.SetControlLock(ControlTypes.QUICKSAVE | ControlTypes.QUICKLOAD, LockId);
            GameEvents.onGameSceneLoadRequested.Add(Watch.Overtaken);
            _scheduled = pending;
            ScreenMessages.PostScreenMessage("Quickload from mission control", HoldSeconds + 1f, ScreenMessageStyle.UPPER_CENTER);
            addon.StartCoroutine(RunAfterHold(pending));
            return CommandResult<LoadScheduled>.Ok(new LoadScheduled { SaveId = saveId, SaveUt = chosen.Ut, LoadId = pending.LoadId });
        }

        private static (SaveSummary? Summary, string Name) FindSlot(SaveSlots? slots, string saveId)
        {
            if (slots?.Quicksave?.SaveId == saveId)
            {
                return (slots!.Quicksave, SaveFiles.Quicksave);
            }
            return slots?.PreviousQuicksave?.SaveId == saveId
                ? (slots!.PreviousQuicksave, SaveFiles.PreviousQuicksave)
                : (null, "");
        }

        private static bool StillOnDisk(string folder, string name, string saveId)
        {
            var info = new FileInfo(SlotPath(folder, name));
            return info.Exists && SaveFiles.IdOf(folder, name, info.Length, info.LastWriteTimeUtc) == saveId;
        }

        private static IEnumerator RunAfterHold(PendingLoad pending)
        {
            yield return new WaitForSecondsRealtime(HoldSeconds);
            if (_scheduled != pending)
            {
                yield break;
            }
            try
            {
                RunLoad(pending);
            }
            catch (Exception ex)
            {
                GonogoLog.Error("quickload failed", ex);
                Finish(pending, GameLoaded.Failed, ex.Message);
            }
        }

        /// <summary>A scene change overtaking the hold cancels it. An instance, because a GameEvents subscription reads its delegate's target and a static method has none.</summary>
        private sealed class SceneChangeWatch
        {
            public void Overtaken(GameScenes _)
            {
                if (_scheduled != null)
                {
                    Finish(_scheduled, GameLoaded.Cancelled, null);
                }
            }
        }

        private static readonly SceneChangeWatch Watch = new SceneChangeWatch();

        private static void RunLoad(PendingLoad pending)
        {
            GameEvents.onGameSceneLoadRequested.Remove(Watch.Overtaken);
            if (ROCManager.Instance != null)
            {
                ROCManager.Instance.ClearROCsCache();
            }
            var node = GamePersistence.LoadSFSFile(pending.Name, pending.Folder);
            if (node == null)
            {
                Finish(pending, GameLoaded.Failed, "the save could not be read");
                return;
            }
            var originalVersion = NodeUtil.GetCfgVersion(node, LoadContext.SFS);
            KSPUpgradePipeline.Process(
                node,
                pending.Folder,
                LoadContext.SFS,
                loaded => Complete(pending, loaded, originalVersion),
                (option, loaded) =>
                {
                    if (option == KSPUpgradePipeline.UpgradeFailOption.LoadAnyway)
                    {
                        Complete(pending, loaded, originalVersion);
                        return;
                    }
                    Finish(pending, GameLoaded.Failed, "the save could not be upgraded");
                });
        }

        private static void Complete(PendingLoad pending, ConfigNode node, Version originalVersion)
        {
            var game = GamePersistence.LoadGameCfg(node, pending.Folder, nullIfIncompatible: true, suppressIncompatibleMessage: false);
            if (game == null || game.flightState == null || !game.compatible)
            {
                Finish(pending, GameLoaded.Failed, "the save is not compatible");
                return;
            }
            GamePersistence.UpdateScenarioModules(game);
            GameEvents.onGameStatePostLoad.Fire(node);
            InputLockManager.RemoveControlLock(LockId);
            _scheduled = null;
            _slotsDirty = true;
            Volatile.Write(ref _loadedAwaitingReset, pending);
            _loadedAt = Time.realtimeSinceStartup;
            if (game.startScene != GameScenes.FLIGHT && originalVersion >= new Version(0, 24, 0))
            {
                GamePersistence.SaveGame(game, "persistent", pending.Folder, SaveMode.OVERWRITE);
                HighLogic.LoadScene(GameScenes.SPACECENTER);
                return;
            }
            FlightDriver.StartAndFocusVessel(game, game.flightState.activeVesselIdx);
        }

        private static PendingLoad? _loadedAwaitingReset;
        private static float _loadedAt;

        /// <summary>
        /// Runs once the new timeline exists, on the courier thread. A frame published
        /// any earlier belongs to the old timeline and the reset discards it, so a
        /// finished load is announced here and the slots are read again, which a game
        /// just loaded needs even though its files have not changed.
        /// </summary>
        internal static void OnTimelineReset()
        {
            _slotsDirty = true;
            AnnounceLoaded();
        }

        private static void AnnounceLoaded()
        {
            var loaded = Interlocked.Exchange(ref _loadedAwaitingReset, null);
            if (loaded != null)
            {
                Publish(loaded, GameLoaded.Loaded, null, loaded.SaveUt);
            }
        }

        private static void Finish(PendingLoad pending, string outcome, string? failReason)
        {
            GameEvents.onGameSceneLoadRequested.Remove(Watch.Overtaken);
            InputLockManager.RemoveControlLock(LockId);
            _scheduled = null;
            var ut = Planetarium.GetUniversalTime();
            Publish(pending, outcome, failReason, ut);
        }

        private static void Publish(PendingLoad pending, string outcome, string? failReason, double ut) =>
            Publisher?.Publish(
                new GameLoaded
                {
                    LoadId = pending.LoadId,
                    Outcome = outcome,
                    FailReason = failReason,
                    SaveUt = pending.SaveUt,
                    FromUt = pending.FromUt,
                    RequestedBy = pending.RequestedBy,
                },
                ut);

        private static void KeepPreviousQuicksave(string folder)
        {
            try
            {
                var existing = SlotPath(folder, SaveFiles.Quicksave);
                if (!File.Exists(existing))
                {
                    return;
                }
                var previous = SlotPath(folder, SaveFiles.PreviousQuicksave);
                Directory.CreateDirectory(Path.GetDirectoryName(previous)!);
                File.Copy(existing, previous, overwrite: true);
            }
            catch (Exception ex)
            {
                // A failed copy must not cost the operator the save they asked for.
                GonogoLog.Error("could not keep the previous quicksave", ex);
            }
        }

        private static string SlotPath(string folder, string name) =>
            Path.Combine(KSPUtil.ApplicationRootPath, "saves", folder, name + ".sfs");

        private static (long Size, DateTime Written)? _slotStat;
        private static (long Size, DateTime Written)? _previousStat;
        private static SaveSlots? _slots;
        private static string? _slotsFolder;
        private static volatile bool _slotsDirty = true;
        private static float _nextCheck;
        private static Task<SaveSlots?>? _reading;

        /// <summary>Checks once a second whether the slots changed, reads the files off the main thread, and publishes when they did.</summary>
        internal static void PublishSlotsIfChanged(IChannelPublisher publisher)
        {
            // A load that started no reset, so the screens still hear how it ended.
            if (Volatile.Read(ref _loadedAwaitingReset) != null && Time.realtimeSinceStartup - _loadedAt > ResetWaitSeconds)
            {
                AnnounceLoaded();
            }
            if (_reading != null)
            {
                if (!_reading.IsCompleted)
                {
                    return;
                }
                _slots = _reading.Status == TaskStatus.RanToCompletion ? _reading.Result : null;
                _reading = null;
                var readAtUt = Planetarium.GetUniversalTime();
                publisher.Publish(_slots, readAtUt);
                return;
            }
            if (!_slotsDirty && Time.realtimeSinceStartup < _nextCheck)
            {
                return;
            }
            _nextCheck = Time.realtimeSinceStartup + 1f;
            var folder = HighLogic.CurrentGame == null ? null : HighLogic.SaveFolder;
            if (folder == null)
            {
                if (_slotsFolder != null)
                {
                    _slotsFolder = null;
                    _slots = null;
                    var clearedAtUt = Planetarium.GetUniversalTime();
                    publisher.Publish(null, clearedAtUt);
                }
                return;
            }
            var slotStat = StatOf(SlotPath(folder, SaveFiles.Quicksave));
            var previousStat = StatOf(SlotPath(folder, SaveFiles.PreviousQuicksave));
            if (!_slotsDirty && folder == _slotsFolder && slotStat == _slotStat && previousStat == _previousStat)
            {
                // The emitter sends an unchanged value only to a connection that has just subscribed, and only when one is offered.
                var offeredAtUt = Planetarium.GetUniversalTime();
                publisher.Publish(_slots, offeredAtUt);
                return;
            }
            _slotsDirty = false;
            _slotsFolder = folder;
            _slotStat = slotStat;
            _previousStat = previousStat;
            _reading = Task.Run(() => ReadSlotsFromDisk(folder));
        }

        private static (long Size, DateTime Written)? StatOf(string path)
        {
            var info = new FileInfo(path);
            return info.Exists ? (info.Length, info.LastWriteTimeUtc) : ((long, DateTime)?)null;
        }

        private static SaveSlots? ReadSlotsFromDisk(string folder) => new SaveSlots
        {
            Quicksave = Summarise(folder, SaveFiles.Quicksave),
            PreviousQuicksave = Summarise(folder, SaveFiles.PreviousQuicksave),
        };

        private static SaveSummary? Summarise(string folder, string name)
        {
            var info = new FileInfo(SlotPath(folder, name));
            if (!info.Exists)
            {
                return null;
            }
            double? ut;
            using (var reader = new StreamReader(info.FullName))
            {
                ut = SaveFiles.ReadFlightStateUt(reader);
            }
            if (ut == null)
            {
                return null;
            }
            return new SaveSummary
            {
                SaveId = SaveFiles.IdOf(folder, name, info.Length, info.LastWriteTimeUtc),
                Ut = ut.Value,
            };
        }
    }
}
