using System;
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
    /// </summary>
    [KSPScenario(ScenarioCreationOptions.AddToAllGames, GameScenes.FLIGHT, GameScenes.SPACECENTER, GameScenes.TRACKSTATION)]
    public sealed class CommandDeliveryScenario : ScenarioModule
    {
        private const string DeliveryKey = "delivery";
        private const string TokenKey = "token";
        private const string HeardKey = "heard";

        private static string? _lastSavedToken;

        public override void OnLoad(ConfigNode node)
        {
            base.OnLoad(node);
            try
            {
                var token = node.GetValue(TokenKey);
                var carried = DeliverySnapshotCodec.Decode(node.GetValue(DeliveryKey));
                var heard = HeardSnapshotCodec.Decode(node.GetValue(HeardKey));
                if (token != null && string.Equals(token, _lastSavedToken, StringComparison.Ordinal))
                {
                    GonogoAddon.SharedEngine?.NoteSaveReloaded(carried, heard);
                    return;
                }
                GonogoAddon.SharedEngine?.NoteGameLoaded(carried, heard);
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
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] CommandDeliveryScenario.OnSave failed: " + ex);
            }
        }
    }
}
