using System;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Feeds the game's scene-load events to <see cref="LoadState"/> and tells the
    /// engine each time it changes, so a connection hears of a load while no
    /// tick runs. Every handler runs on the Unity main thread.
    /// </summary>
    internal sealed class GameLoadReporter : IDisposable
    {
        /// <summary>Real seconds a ready waits for a tick before it is released without one.</summary>
        private static readonly TimeSpan ReadyWaitsForATick = TimeSpan.FromSeconds(2);

        private readonly ChannelEngine _engine;
        private readonly LoadState _state = new LoadState();
        private object? _rootAtRequest;

        public GameLoadReporter(ChannelEngine engine)
        {
            _engine = engine;
            _state.Changed += Announce;

            GameEvents.onGameSceneLoadRequested.Add(OnLoadRequested);
            GameEvents.onLevelWasLoadedGUIReady.Add(OnSceneStood);
            GameEvents.onFlightReady.Add(OnFlightReady);

            _state.Seed(HighLogic.LoadedScene.ToString());
            Announce();
        }

        /// <summary>Called every frame, including while the game is paused and while it loads.</summary>
        public void Update()
        {
            if (_state.Phase == GamePhase.Loading)
            {
                _state.Watch(TargetSceneIsUp(), Time.realtimeSinceStartup);
                if (_state.EndedWithoutItsEvent)
                {
                    Debug.LogWarning("[Gonogo] load of " + _state.Scene + " ended without its event");
                }
            }
            _engine.ReleaseGameStateWaitingLongerThan(ReadyWaitsForATick);
        }

        public void Dispose()
        {
            GameEvents.onGameSceneLoadRequested.Remove(OnLoadRequested);
            GameEvents.onLevelWasLoadedGUIReady.Remove(OnSceneStood);
            GameEvents.onFlightReady.Remove(OnFlightReady);
        }

        private void OnLoadRequested(GameScenes target)
        {
            _rootAtRequest = RootOf(target);
            _state.LoadRequested(target.ToString());
        }

        private void OnSceneStood(GameScenes scene) => _state.SceneStood(scene.ToString());

        private void OnFlightReady() => _state.FlightReady();

        private void Announce() => _engine.SetGameState(_state.Phase, _state.Scene);

        /// <summary>
        /// Whether the scene being loaded has its own objects up. The old scene's
        /// objects can outlive the request, so the root has to be a different one
        /// from the root the request found.
        /// </summary>
        private bool TargetSceneIsUp()
        {
            if (!Enum.TryParse(_state.Scene, out GameScenes target))
            {
                return false;
            }
            var root = RootOf(target);
            if (root == null || ReferenceEquals(root, _rootAtRequest))
            {
                return false;
            }
            return target != GameScenes.FLIGHT || FlightGlobals.ready;
        }

        private static object? RootOf(GameScenes scene)
        {
            switch (scene)
            {
                case GameScenes.FLIGHT:
                    return FlightGlobals.fetch;
                case GameScenes.SPACECENTER:
                    return SpaceCenter.Instance;
                case GameScenes.EDITOR:
                    return EditorLogic.fetch;
                case GameScenes.TRACKSTATION:
                    return PlanetariumCamera.fetch;
                case GameScenes.MAINMENU:
                    return UnityEngine.Object.FindObjectOfType<MainMenu>();
                default:
                    return null;
            }
        }
    }
}
