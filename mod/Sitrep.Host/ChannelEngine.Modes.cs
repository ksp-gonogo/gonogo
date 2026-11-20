using System;
using Sitrep.Contract;
using Sitrep.Host.Modes;

namespace Sitrep.Host
{
    /// <summary>
    /// Modes: what the dashboard shows other than the live game. The engine
    /// decides which declared mode is on and holds its timeline; the values a
    /// mode answers with are supplied by its source on the hosting screen.
    /// </summary>
    public sealed partial class ChannelEngine
    {
        /// <summary>The <c>system.modes</c> channel topic; see <see cref="ModesModel"/>.</summary>
        public const string ModesTopic = "system.modes";

        /// <summary>The <c>mode.state</c> channel topic; see <see cref="ModeStateModel"/>.</summary>
        public const string ModeStateTopic = "mode.state";

        internal const string ModeDeclareCommand = "mode.declare";
        internal const string ModeEnterCommand = "mode.enter";
        internal const string ModeExitCommand = "mode.exit";
        internal const string ModeSetInputCommand = "mode.setInput";
        internal const string ModeSeekCommand = "mode.timeline.seek";
        internal const string ModePlayCommand = "mode.timeline.play";
        internal const string ModePauseCommand = "mode.timeline.pause";
        internal const string ModeSetRangeCommand = "mode.timeline.setRange";

        /// <summary>The owner <c>system.modes</c> names for a mode declared with <c>mode.declare</c>.</summary>
        internal const string ClientModeOwner = "client";

        private ModeBoard? _modeBoard;

        /// <summary>Built on first use, since registration reads it before the constructor's own declarations run.</summary>
        private ModeBoard ModeBoard => _modeBoard ??= NewModeBoard();

        /// <summary>Test-only: the board the engine keeps.</summary>
        internal ModeBoard ModeBoardForTests => ModeBoard;

        private ModeBoard NewModeBoard()
        {
            var board = new ModeBoard(() => _nowRealSec());
            // A recorded flight played back. Entered in any scene, the main menu included, and it answers for the whole craft with what was observed then.
            board.Declare(
                new ModeDeclaration
                {
                    Id = "replay",
                    Name = "Replay",
                    Order = 20,
                    Activation = ModeBoard.ActivationEntered,
                    Answers = ModeBoard.AnswersCraft,
                    Timeline = ModeBoard.TimelinePlayback,
                },
                "gonogo");
            return board;
        }

        private void DeclareModes()
        {
            _channelDeclarations[ModesTopic] = new ChannelDeclaration
            {
                Kind = SampleKind.Discrete,
                Requires = Requirement.None,
                Topic = ModesTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.TrueNow,
            };
            _channelSources[ModesTopic] = _ => ModeWire.BuildModesModel(ModeBoard.Listing());
            _engineStateTopics.Add(ModesTopic);

            _channelDeclarations[ModeStateTopic] = new ChannelDeclaration
            {
                Kind = SampleKind.Discrete,
                Requires = Requirement.None,
                Topic = ModeStateTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.TrueNow,
            };
            _channelSources[ModeStateTopic] = _ => ModeWire.BuildModeStateModel(ModeBoard.State());
            _engineStateTopics.Add(ModeStateTopic);

            Declare(ModeDeclareCommand, typeof(ModeDeclaration));
            Declare(ModeEnterCommand, typeof(ModeRefArgs));
            Declare(ModeExitCommand, typeof(ModeRefArgs));
            Declare(ModePauseCommand, typeof(ModePauseArgs));
            Declare(ModeSetInputCommand, typeof(ModeInputArgs));
            Declare(ModeSeekCommand, typeof(ModeSeekArgs));
            Declare(ModePlayCommand, typeof(ModePlayArgs));
            Declare(ModeSetRangeCommand, typeof(ModeRangeArgs));

            void Declare(string command, Type argsType)
            {
                _commandDeclarations[command] = new CommandDeclaration { Command = command };
                _commandArgTypes[command] = argsType;
            }
        }

        private static bool IsModeTopic(string topic) => topic == ModesTopic || topic == ModeStateTopic;

        private double _modesLastSaidRealSec = double.NegativeInfinity;

        /*
         * The mode and its timeline are the dashboard's, not the game's: an
         * operator moves a replay's Timeline at the main menu and while a save
         * loads, where no tick runs and the game's clock stands still. So they
         * are said from here, on the Courier thread, the moment they change,
         * and a tick's own pass over these two Topics then finds nothing new
         * to send. The moment each is stamped with is the clock's, which does
         * not move without a tick; a screen orders two at the same moment by
         * their sequence numbers.
         */
        private void SayModes()
        {
            _modesLastSaidRealSec = _nowRealSec();
            var ut = _clock.Now();
            ProcessPublish(new PublishJob(ModeStateTopic, ModeWire.BuildModeStateModel(ModeBoard.State()), ut), ut);
            ProcessPublish(new PublishJob(ModesTopic, ModeWire.BuildModesModel(ModeBoard.Listing()), ut), ut);
            // What was just recorded is due at this same moment, and the clock hands over what is due only when it is advanced: a tick does that, so with none this does.
            if (!_clockBehind)
            {
                AdvanceClock(ut);
            }
        }

        /// <summary>Says the modes from the Courier thread, for a caller on any other.</summary>
        private void SayModesSoon() => EnqueueJob(new CourierActionJob(SayModes));

        /// <summary>
        /// Courier-thread-only, each pass of its loop: says a playing timeline's
        /// position again once it is <see cref="ModeBoard.ReanchorSeconds"/> old,
        /// so a screen that joins late is close and playing stops at the end
        /// with no tick to do either.
        /// </summary>
        /// <summary>How long the mod waits with no screen connected before it ends an entered mode: longer than a page takes to reload.</summary>
        internal double LastScreenGraceSeconds { get; set; } = 30;

        private double _noScreenSinceRealSec = double.NaN;

        /// <summary>
        /// Courier-thread-only, each pass of its loop: ends an entered mode
        /// once no screen has been connected for
        /// <see cref="LastScreenGraceSeconds"/>.
        /// </summary>
        private void EndEnteredModeWithLastScreen()
        {
            if (_modeBoard == null || !_modeBoard.Entered || AScreenIsConnected())
            {
                _noScreenSinceRealSec = double.NaN;
                return;
            }
            var now = _nowRealSec();
            if (double.IsNaN(_noScreenSinceRealSec))
            {
                _noScreenSinceRealSec = now;
                return;
            }
            if (now - _noScreenSinceRealSec >= LastScreenGraceSeconds)
            {
                _modeBoard.LastScreenLeft();
                _noScreenSinceRealSec = double.NaN;
            }
        }

        /// <summary>
        /// Whether any connected client is a screen. A screen is a client
        /// subscribed to <c>mode.state</c>: every screen reads it to know the
        /// mode it is in, and a client that does not read it, such as one that
        /// only records, cannot be showing the mode.
        /// </summary>
        private bool AScreenIsConnected()
        {
            foreach (var session in _sessions.Values)
            {
                if (session.Unsubscribers.ContainsKey(ModeStateTopic))
                {
                    return true;
                }
            }
            return false;
        }

        private void SayPlayingModeTimeline()
        {
            if (_modeBoard == null || !_modeBoard.Playing)
            {
                return;
            }
            if (_nowRealSec() - _modesLastSaidRealSec >= ModeBoard.ReanchorSeconds)
            {
                SayModes();
            }
        }

        private static Type? ModeCommandArgsType(string command) => command switch
        {
            ModeDeclareCommand => typeof(ModeDeclaration),
            ModeEnterCommand or ModeExitCommand => typeof(ModeRefArgs),
            ModePauseCommand => typeof(ModePauseArgs),
            ModeSetInputCommand => typeof(ModeInputArgs),
            ModeSeekCommand => typeof(ModeSeekArgs),
            ModePlayCommand => typeof(ModePlayArgs),
            ModeSetRangeCommand => typeof(ModeRangeArgs),
            _ => null,
        };

        /// <summary>
        /// Answers a mode command on the Courier thread, ahead of the handler
        /// stores, so one is answered in a scene where the game's main thread
        /// runs no handler.
        /// </summary>
        private bool TryHandleModeCommand(DispatchCommandJob job)
        {
            var argsType = ModeCommandArgsType(job.Command);
            if (argsType == null)
            {
                return false;
            }

            job.OnResult(AnswerModeCommand(job.Command, BindCommandArgs(job.Args, argsType)));
            job.Done?.Set();
            SayModes();
            return true;
        }

        private object AnswerModeCommand(string command, object? args)
        {
            var board = ModeBoard;
            string? refusal;
            switch (command)
            {
                case ModeDeclareCommand when args is ModeDeclaration declaration:
                    refusal = board.Declare(declaration, ClientModeOwner);
                    break;
                case ModeEnterCommand when args is ModeRefArgs enter:
                    refusal = board.Enter(enter.Mode);
                    break;
                case ModeExitCommand when args is ModeRefArgs exit:
                    refusal = board.Exit(exit.Mode);
                    break;
                case ModePauseCommand when args is ModePauseArgs pause:
                    refusal = board.Pause(pause.Mode, pause.Rate);
                    break;
                case ModeSetInputCommand when args is ModeInputArgs input:
                    refusal = board.SetInput(input.Mode, input.Key, input.Value);
                    break;
                case ModeSeekCommand when args is ModeSeekArgs seek:
                    refusal = board.Seek(seek.Mode, seek.Ut);
                    break;
                case ModePlayCommand when args is ModePlayArgs play:
                    refusal = board.Play(play.Mode, play.Rate);
                    break;
                case ModeSetRangeCommand when args is ModeRangeArgs range:
                    refusal = board.SetRange(range);
                    break;
                default:
                    refusal = "\"" + command + "\" needs its arguments";
                    break;
            }
            return refusal == null ? CommandResult.Ok() : CommandResult.Fail(CommandErrorCode.WrongState, refusal);
        }

        /// <summary>
        /// Takes the modes an Uplink's manifest declares. Returns why not when
        /// one cannot stand, which refuses the Uplink.
        /// </summary>
        private string? DeclareUplinkModes(string id, UplinkManifest manifest)
        {
            foreach (var mode in manifest.Modes)
            {
                var refusal = ModeBoard.Declare(mode, id);
                if (refusal != null)
                {
                    return refusal;
                }
            }
            return null;
        }
    }
}
