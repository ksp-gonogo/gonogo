using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host.Modes
{
    /// <summary>
    /// The modes that are declared, which of them the dashboard is in, and that
    /// mode's inputs and timeline. It holds no flight data: a mode's values are
    /// supplied by its source on the hosting screen, and a position here is a
    /// number.
    ///
    /// <para>Every method takes the one lock, so the game's thread can report a
    /// scene while the Courier thread answers a command.</para>
    /// </summary>
    internal sealed class ModeBoard
    {
        internal const string LiveId = "live";
        internal const string ActivationAlways = "always";
        internal const string ActivationScene = "scene";
        internal const string ActivationEntered = "entered";
        internal const string TimelineNone = "none";
        internal const string TimelineScrub = "scrub";
        internal const string TimelinePlayback = "playback";

        /// <summary>How long a playing timeline runs before its position is published again.</summary>
        internal const double ReanchorSeconds = 1.0;

        internal const string AnswersNothing = "nothing";
        internal const string AnswersCraft = "craft";

        private const int DefaultOrder = 50;
        private static readonly double[] DefaultRates = { 1, 10, 100, 1000 };

        private sealed class Declared
        {
            public ModeDeclaration Declaration = new ModeDeclaration();
            public string Owner = "";
            public List<ModeInput> Inputs = new List<ModeInput>();
        }

        private sealed class Timeline
        {
            public double StartUt;
            public double EndUt;
            public double AnchorUt;
            public double AnchorRealSec;
            public bool Playing;
            public double Rate = 1;
            public List<double> Rates = new List<double>();
            public List<ModeMark> Marks = new List<ModeMark>();
            public double? LaunchUt;
        }

        private readonly object _lock = new object();
        private readonly Func<double> _nowRealSec;
        private readonly Dictionary<string, Declared> _modes = new Dictionary<string, Declared>(StringComparer.Ordinal);
        private string _scene = "";
        private string? _entered;
        /// <summary>The scene and the active craft an entered mode was entered in: it ends when either changes.</summary>
        private string _enteredScene = "";
        private string? _enteredCraft;
        private string? _craft;
        private string _active = LiveId;
        private int _entry;
        private Timeline? _timeline;
        private string _noTimeline = "";

        internal ModeBoard(Func<double> nowRealSec)
        {
            _nowRealSec = nowRealSec;
            Declare(
                new ModeDeclaration
                {
                    Id = LiveId,
                    Name = "Live",
                    Order = 1000,
                    Activation = ActivationAlways,
                    Timeline = TimelineNone,
                },
                "gonogo");
        }

        /// <summary>
        /// Adds a mode, or replaces the one its own owner declared before.
        /// Returns why not when the declaration cannot stand, and null when it
        /// was taken.
        /// </summary>
        internal string? Declare(ModeDeclaration declaration, string owner)
        {
            if (string.IsNullOrEmpty(declaration.Id))
            {
                return "a mode needs an id";
            }
            if (declaration.Activation != ActivationAlways
                && declaration.Activation != ActivationScene
                && declaration.Activation != ActivationEntered)
            {
                return "mode \"" + declaration.Id + "\" has activation \"" + declaration.Activation
                    + "\", which is not \"always\", \"scene\" or \"entered\"";
            }
            var timeline = string.IsNullOrEmpty(declaration.Timeline) ? TimelineNone : declaration.Timeline;
            if (timeline != TimelineNone && timeline != TimelineScrub && timeline != TimelinePlayback)
            {
                return "mode \"" + declaration.Id + "\" has timeline \"" + declaration.Timeline
                    + "\", which is not \"none\", \"scrub\" or \"playback\"";
            }
            if (declaration.Activation == ActivationScene && declaration.Scenes.Count == 0)
            {
                return "mode \"" + declaration.Id + "\" is on by scene and names no scene";
            }
            var answers = string.IsNullOrEmpty(declaration.Answers) ? AnswersNothing : declaration.Answers;
            if (answers != AnswersNothing && answers != AnswersCraft)
            {
                return "mode \"" + declaration.Id + "\" answers \"" + declaration.Answers
                    + "\", which is not \"craft\" or \"nothing\"";
            }

            lock (_lock)
            {
                if (_modes.TryGetValue(declaration.Id, out var existing) && existing.Owner != owner)
                {
                    return "mode \"" + declaration.Id + "\" already belongs to \"" + existing.Owner + "\"";
                }
                var kept = existing?.Inputs ?? new List<ModeInput>();
                _modes[declaration.Id] = new Declared
                {
                    Declaration = new ModeDeclaration
                    {
                        Id = declaration.Id,
                        Name = string.IsNullOrEmpty(declaration.Name) ? declaration.Id : declaration.Name,
                        Order = declaration.Order == 0 ? DefaultOrder : declaration.Order,
                        Activation = declaration.Activation,
                        Scenes = new List<string>(declaration.Scenes),
                        Answers = answers,
                        Modelled = declaration.Modelled,
                        Timeline = timeline,
                    },
                    Owner = owner,
                    Inputs = kept,
                };
                Elect();
                return null;
            }
        }

        /// <summary>The scene the game is in, by KSP's name for it, or empty when there is no game.</summary>
        internal void SetScene(string scene)
        {
            lock (_lock)
            {
                _scene = scene ?? "";
                Elect();
            }
        }

        /// <summary>
        /// The craft the game has active, by its id, or null with none. An
        /// entered mode is about the craft it was entered with, so it ends
        /// when another takes its place or it goes.
        /// </summary>
        internal void SetActiveCraft(string? craft)
        {
            lock (_lock)
            {
                _craft = craft;
                Elect();
            }
        }

        /// <summary>
        /// The last screen has gone and none has come back: nobody is left
        /// watching an entered mode, so it ends, and the next screen to open
        /// starts in the live game.
        /// </summary>
        internal void LastScreenLeft()
        {
            lock (_lock)
            {
                if (_entered == null)
                {
                    return;
                }
                _entered = null;
                Elect();
            }
        }

        /// <summary>Whether an operator-entered mode is on.</summary>
        internal bool Entered
        {
            get
            {
                lock (_lock)
                {
                    return _entered != null;
                }
            }
        }

        internal string? Enter(string mode)
        {
            lock (_lock)
            {
                if (!_modes.TryGetValue(mode, out var declared))
                {
                    return "no mode \"" + mode + "\" is declared";
                }
                if (declared.Declaration.Activation != ActivationEntered)
                {
                    return "mode \"" + mode + "\" is not one an operator enters";
                }
                if (!SceneAllows(declared.Declaration))
                {
                    return "mode \"" + mode + "\" cannot be entered in this scene";
                }
                _entered = mode;
                _enteredScene = _scene;
                _enteredCraft = _craft;
                Elect();
                return null;
            }
        }

        internal string? Exit(string mode)
        {
            lock (_lock)
            {
                if (_entered != mode)
                {
                    return "mode \"" + mode + "\" is not entered";
                }
                _entered = null;
                Elect();
                return null;
            }
        }

        internal string? SetInput(string mode, string key, string value)
        {
            lock (_lock)
            {
                if (!_modes.TryGetValue(mode, out var declared))
                {
                    return "no mode \"" + mode + "\" is declared";
                }
                if (string.IsNullOrEmpty(key))
                {
                    return "an input needs a key";
                }
                if (string.IsNullOrEmpty(value))
                {
                    declared.Inputs.RemoveAll(i => i.Key == key);
                    return null;
                }
                var existing = declared.Inputs.FirstOrDefault(i => i.Key == key);
                if (existing != null)
                {
                    existing.Value = value;
                    return null;
                }
                declared.Inputs.Add(new ModeInput { Key = key, Value = value });
                return null;
            }
        }

        internal string? SetRange(ModeRangeArgs range)
        {
            lock (_lock)
            {
                var refusal = RefuseUnlessActive(range.Mode, needsTimeline: false);
                if (refusal != null)
                {
                    return refusal;
                }
                var kind = _modes[_active].Declaration.Timeline;
                if (kind == TimelineNone)
                {
                    return "mode \"" + range.Mode + "\" declares no timeline";
                }
                if (!(range.EndUt > range.StartUt))
                {
                    _timeline = null;
                    _noTimeline = range.NoTimeline ?? "";
                    return null;
                }

                var now = _nowRealSec();
                var at = _timeline == null ? range.StartUt : PositionAt(_timeline, now);
                var playing = _timeline?.Playing ?? false;
                if (at < range.StartUt || at > range.EndUt)
                {
                    at = range.StartUt;
                    playing = false;
                }
                var rates = kind != TimelinePlayback
                    ? new List<double>()
                    : range.Rates.Count > 0 ? new List<double>(range.Rates) : new List<double>(DefaultRates);
                var rate = _timeline?.Rate ?? 1;
                if (rates.Count > 0 && !rates.Contains(rate))
                {
                    rate = rates[0];
                }
                _timeline = new Timeline
                {
                    StartUt = range.StartUt,
                    EndUt = range.EndUt,
                    AnchorUt = at,
                    AnchorRealSec = now,
                    Playing = playing,
                    Rate = rate,
                    Rates = rates,
                    Marks = range.Marks
                        .Select(m => new ModeMark { Ut = m.Ut, Label = m.Label })
                        .OrderBy(m => m.Ut)
                        .ToList(),
                    LaunchUt = range.LaunchUt,
                };
                _noTimeline = "";
                return null;
            }
        }

        internal string? Seek(string mode, double ut)
        {
            lock (_lock)
            {
                var refusal = RefuseUnlessActive(mode, needsTimeline: true);
                if (refusal != null)
                {
                    return refusal;
                }
                if (double.IsNaN(ut) || double.IsInfinity(ut))
                {
                    return "a timeline moves to a finite moment";
                }
                var timeline = _timeline!;
                timeline.AnchorUt = Math.Max(timeline.StartUt, Math.Min(timeline.EndUt, ut));
                timeline.AnchorRealSec = _nowRealSec();
                return null;
            }
        }

        internal string? Play(string mode, double rate)
        {
            lock (_lock)
            {
                var refusal = RefuseUnlessActive(mode, needsTimeline: true);
                if (refusal != null)
                {
                    return refusal;
                }
                if (_modes[_active].Declaration.Timeline != TimelinePlayback)
                {
                    return "the timeline of mode \"" + mode + "\" does not play back";
                }
                var timeline = _timeline!;
                if (rate != 0 && !timeline.Rates.Contains(rate))
                {
                    return "the timeline of mode \"" + mode + "\" does not play at that rate";
                }
                var now = _nowRealSec();
                var at = PositionAt(timeline, now);
                timeline.AnchorUt = at >= timeline.EndUt ? timeline.StartUt : at;
                timeline.AnchorRealSec = now;
                timeline.Playing = true;
                if (rate != 0)
                {
                    timeline.Rate = rate;
                }
                return null;
            }
        }

        internal string? Pause(string mode, double rate = 0)
        {
            lock (_lock)
            {
                var refusal = RefuseUnlessActive(mode, needsTimeline: true);
                if (refusal != null)
                {
                    return refusal;
                }
                var timeline = _timeline!;
                if (rate != 0 && !timeline.Rates.Contains(rate))
                {
                    return "the timeline of mode \"" + mode + "\" does not play at that rate";
                }
                // Where it stands is worked out at the rate it was playing at, before the rate is changed.
                var now = _nowRealSec();
                timeline.AnchorUt = PositionAt(timeline, now);
                timeline.AnchorRealSec = now;
                timeline.Playing = false;
                if (rate != 0)
                {
                    timeline.Rate = rate;
                }
                return null;
            }
        }

        /// <summary>The mode the dashboard is in, as <c>mode.state</c> carries it.</summary>
        /// <summary>Whether the active mode's timeline is playing, which is when its state has to be said again as real time passes.</summary>
        internal bool Playing
        {
            get
            {
                lock (_lock)
                {
                    return _timeline?.Playing == true;
                }
            }
        }

        internal ModeStateModel State()
        {
            lock (_lock)
            {
                Advance();
                var declared = _modes[_active];
                return new ModeStateModel
                {
                    Mode = _active,
                    Name = declared.Declaration.Name,
                    Answers = declared.Declaration.Answers,
                    Modelled = declared.Declaration.Modelled,
                    Inputs = declared.Inputs.Select(i => new ModeInput { Key = i.Key, Value = i.Value }).ToList(),
                    Timeline = _timeline == null
                        ? null
                        : new ModeTimelineState
                        {
                            StartUt = _timeline.StartUt,
                            EndUt = _timeline.EndUt,
                            AtUt = _timeline.AnchorUt,
                            Playing = _timeline.Playing,
                            Rate = _timeline.Rate,
                            Rates = _timeline.Rates,
                            Marks = _timeline.Marks,
                            LaunchUt = _timeline.LaunchUt,
                        },
                    NoTimeline = _noTimeline,
                    Entry = _entry,
                };
            }
        }

        /// <summary>Every declared mode, lowest order first, as <c>system.modes</c> carries them.</summary>
        internal ModesModel Listing()
        {
            lock (_lock)
            {
                return new ModesModel
                {
                    Modes = _modes.Values
                        .OrderBy(m => m.Declaration.Order)
                        .ThenBy(m => m.Declaration.Id, StringComparer.Ordinal)
                        .Select(m => new ModeListing
                        {
                            Declaration = m.Declaration,
                            Owner = m.Owner,
                            Eligible = Eligible(m.Declaration),
                        })
                        .ToList(),
                };
            }
        }

        /*
         * A playing timeline's published position is where it was at its anchor,
         * and a screen carries it forward itself. The anchor is moved up here so
         * that a screen which subscribes late is handed a position at most
         * ReanchorSeconds old, and so that playing stops at the end.
         */
        private void Advance()
        {
            var timeline = _timeline;
            if (timeline == null || !timeline.Playing)
            {
                return;
            }
            var now = _nowRealSec();
            var at = PositionAt(timeline, now);
            if (at >= timeline.EndUt)
            {
                timeline.AnchorUt = timeline.EndUt;
                timeline.AnchorRealSec = now;
                timeline.Playing = false;
                return;
            }
            if (now - timeline.AnchorRealSec >= ReanchorSeconds)
            {
                timeline.AnchorUt = at;
                timeline.AnchorRealSec = now;
            }
        }

        private static double PositionAt(Timeline timeline, double nowRealSec) =>
            timeline.Playing
                ? Math.Min(timeline.EndUt, timeline.AnchorUt + (timeline.Rate * (nowRealSec - timeline.AnchorRealSec)))
                : timeline.AnchorUt;

        private string? RefuseUnlessActive(string mode, bool needsTimeline)
        {
            if (mode != _active)
            {
                return "mode \"" + mode + "\" is not the mode the dashboard is in";
            }
            if (needsTimeline && _timeline == null)
            {
                return "mode \"" + mode + "\" has no timeline";
            }
            return null;
        }

        private bool SceneAllows(ModeDeclaration declaration) =>
            declaration.Scenes.Count == 0 || declaration.Scenes.Contains(_scene, StringComparer.OrdinalIgnoreCase);

        private bool Eligible(ModeDeclaration declaration) => declaration.Activation switch
        {
            ActivationAlways => true,
            ActivationScene => SceneAllows(declaration),
            ActivationEntered => _entered == declaration.Id && SceneAllows(declaration),
            _ => false,
        };

        private void Elect()
        {
            // An entered mode is bounded: it ends with the scene it was entered in and with the craft it was entered with.
            if (_entered != null
                && (!_modes.TryGetValue(_entered, out var entered)
                    || !SceneAllows(entered.Declaration)
                    || !string.Equals(_scene, _enteredScene, StringComparison.OrdinalIgnoreCase)
                    || _craft != _enteredCraft))
            {
                _entered = null;
            }
            var next = _modes.Values
                .Where(m => Eligible(m.Declaration))
                .OrderBy(m => m.Declaration.Order)
                .ThenBy(m => m.Declaration.Id, StringComparer.Ordinal)
                .Select(m => m.Declaration.Id)
                .FirstOrDefault() ?? LiveId;
            if (next == _active)
            {
                return;
            }
            _active = next;
            _entry++;
            _timeline = null;
            _noTimeline = "";
        }
    }
}
