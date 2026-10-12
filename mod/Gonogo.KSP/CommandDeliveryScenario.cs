using System;
using System.Globalization;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Saves what store-and-forward delivery holds (held commands, light in
    /// flight, lanes, stored cancels) and what each command centre has heard of
    /// each craft with the game, and starts a new timeline restored from them
    /// when a game is loaded.
    ///
    /// <para>A scenario is saved and loaded again on every scene change, which is
    /// not a new timeline. Each save stamps a token, and a load carrying the token
    /// of this process's latest save is that round trip, so it changes nothing. A
    /// load from disk carries an older token, or none, and starts a new
    /// timeline. A quickload of the latest save carries its token too, so the
    /// round trip still hands the engine what it held, for the rewind that
    /// load starts.</para>
    ///
    /// <para>Each save also tells the engine what it has just written and at
    /// what UT. A quickload turns the clock back before this module is loaded
    /// again, so the engine restores from what it was told at the save, not
    /// from a record that has yet to arrive.</para>
    /// </summary>
    [KSPScenario(ScenarioCreationOptions.AddToAllGames, GameScenes.FLIGHT, GameScenes.SPACECENTER, GameScenes.TRACKSTATION)]
    public sealed class CommandDeliveryScenario : ScenarioModule
    {
        private const string DeliveryKey = "delivery";
        private const string TokenKey = "token";
        private const string HeardKey = "heard";
        private const string UtKey = "ut";

        private static string? _lastSavedToken;

        public override void OnLoad(ConfigNode node)
        {
            base.OnLoad(node);
            try
            {
                var token = node.GetValue(TokenKey);
                var carried = DeliverySnapshotCodec.Decode(node.GetValue(DeliveryKey));
                var encodedHeard = node.GetValue(HeardKey);
                var kernel = GonogoAddon.SharedEngine?.Kernel;
                var heard = HeardSnapshotCodec.Decode(encodedHeard, (model, data) => CommsElection.RestoreLinkStrength(kernel, model, data));
                var savedUt = double.TryParse(node.GetValue(UtKey), NumberStyles.Float, CultureInfo.InvariantCulture, out var ut)
                    ? ut
                    : double.NegativeInfinity;
                var ownLatest = token != null && string.Equals(token, _lastSavedToken, StringComparison.Ordinal);
                Debug.Log("[Gonogo] CommandDeliveryScenario loaded a save of UT " + savedUt.ToString("F2", CultureInfo.InvariantCulture)
                    + (ownLatest ? ", this process's own latest" : ", not this process's latest, so a new timeline")
                    + ", heard " + (encodedHeard?.Length ?? 0) + " chars" + (heard == null ? " (none read)" : ""));
                if (ownLatest)
                {
                    GonogoAddon.SharedEngine?.NoteSaveReloaded(carried, heard, savedUt, HighLogic.SaveFolder);
                    return;
                }
                GonogoAddon.SharedEngine?.NoteGameLoaded(carried, heard, savedUt, HighLogic.SaveFolder);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] CommandDeliveryScenario.OnLoad failed: " + ex);
            }
        }

        public override void OnSave(ConfigNode node)
        {
            base.OnSave(node);
            try
            {
                var token = Guid.NewGuid().ToString("N");
                node.SetValue(TokenKey, token, true);
                _lastSavedToken = token;
                var ut = Planetarium.GetUniversalTime();
                node.SetValue(UtKey, ut.ToString("R", CultureInfo.InvariantCulture), true);
                var snapshot = GonogoAddon.SharedEngine?.DeliverySnapshotNow();
                if (snapshot != null)
                {
                    node.SetValue(DeliveryKey, DeliverySnapshotCodec.Encode(snapshot), true);
                }
                var heard = GonogoAddon.SharedEngine?.HeardSnapshotNow();
                if (heard != null)
                {
                    node.SetValue(HeardKey, HeardSnapshotCodec.Encode(heard), true);
                }
                GonogoAddon.SharedEngine?.NoteSaved(snapshot, heard, ut, HighLogic.SaveFolder);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] CommandDeliveryScenario.OnSave failed: " + ex);
            }
        }
    }
}
