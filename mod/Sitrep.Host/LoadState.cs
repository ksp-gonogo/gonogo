using System;

namespace Sitrep.Host
{
    /// <summary>What the game is doing, as far as a client reading its stream is concerned.</summary>
    public enum GamePhase
    {
        /// <summary>A scene stands and the game is running in it.</summary>
        Ready,

        /// <summary>A scene is being loaded, so nothing the game says is current.</summary>
        Loading,

        /// <summary>The main menu stands: there is no game, so there is nothing to read.</summary>
        NoGame,
    }

    /// <summary>
    /// Whether the game is loading a scene, from the game's own request and
    /// ready events, and never from a clock that stopped. A paused flight and
    /// an editor both stand still without loading anything.
    ///
    /// <para>A request names the target, and the latest request wins: a launch
    /// that fails bounces to the space centre while the flight is still
    /// loading, and the flight's scene standing afterwards must not end the
    /// load. A flight load outlasts its scene standing, because the vessels
    /// are built after it; only the flight-ready event ends it. Every other
    /// load ends when its scene stands.</para>
    ///
    /// <para>An event can be missed, and a state that never ends would hold a
    /// client for good, so <see cref="Watch"/> ends a load whose scene has been
    /// up for a whole second with no event.</para>
    /// </summary>
    public sealed class LoadState
    {
        /// <summary>Real seconds a scene must be up, with no event, before the load is taken as ended.</summary>
        public const double BackstopSeconds = 1.0;

        private const string Flight = "FLIGHT";
        private const string MainMenu = "MAINMENU";

        private double? _upSince;

        /// <summary>What the game is doing now.</summary>
        public GamePhase Phase { get; private set; } = GamePhase.Loading;

        /// <summary>The scene being loaded, or the scene that stands.</summary>
        public string Scene { get; private set; } = "LOADING";

        /// <summary>True when the last load was ended by <see cref="Watch"/> rather than by its event.</summary>
        public bool EndedWithoutItsEvent { get; private set; }

        /// <summary>Raised after <see cref="Phase"/> or <see cref="Scene"/> changes.</summary>
        public event Action? Changed;

        /// <summary>The scene the mod finds itself in when it starts, before any request has been heard.</summary>
        public void Seed(string scene)
        {
            Set(scene == MainMenu ? GamePhase.NoGame : scene == "LOADING" ? GamePhase.Loading : GamePhase.Ready, scene);
        }

        /// <summary>The game asked to load <paramref name="target"/>.</summary>
        public void LoadRequested(string target)
        {
            _upSince = null;
            EndedWithoutItsEvent = false;
            Set(GamePhase.Loading, target);
        }

        /// <summary>The game's UI is ready in <paramref name="scene"/>.</summary>
        public void SceneStood(string scene)
        {
            if (Phase != GamePhase.Loading || scene != Scene || scene == Flight)
            {
                return;
            }
            End(scene == MainMenu ? GamePhase.NoGame : GamePhase.Ready);
        }

        /// <summary>The flight has its vessels and is running.</summary>
        public void FlightReady()
        {
            if (Phase != GamePhase.Loading || Scene != Flight)
            {
                return;
            }
            End(GamePhase.Ready);
        }

        /// <summary>
        /// Called every frame. <paramref name="sceneIsUp"/> is whether the
        /// target scene's own objects exist and are ready.
        /// </summary>
        public void Watch(bool sceneIsUp, double realSeconds)
        {
            if (Phase != GamePhase.Loading)
            {
                return;
            }
            if (!sceneIsUp)
            {
                _upSince = null;
                return;
            }
            _upSince ??= realSeconds;
            if (realSeconds - _upSince.Value >= BackstopSeconds)
            {
                End(Scene == MainMenu ? GamePhase.NoGame : GamePhase.Ready);
                EndedWithoutItsEvent = true;
            }
        }

        private void End(GamePhase phase)
        {
            _upSince = null;
            EndedWithoutItsEvent = false;
            Set(phase, Scene);
        }

        private void Set(GamePhase phase, string scene)
        {
            if (phase == Phase && scene == Scene)
            {
                return;
            }
            Phase = phase;
            Scene = scene;
            Changed?.Invoke();
        }
    }
}
