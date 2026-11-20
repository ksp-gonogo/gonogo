using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Modes;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>Which mode is on, and its timeline, with the real seconds supplied by the test.</summary>
    public class ModeBoardTests
    {
        private double _now;

        private ModeBoard Board()
        {
            var board = new ModeBoard(() => _now);
            Assert.Null(board.Declare(Preview(), "gonogo"));
            return board;
        }

        private static ModeDeclaration Preview() => new ModeDeclaration
        {
            Id = "preview",
            Name = "Preview",
            Order = 30,
            Activation = ModeBoard.ActivationEntered,
            Scenes = { "FLIGHT" },
            Answers = ModeBoard.AnswersCraft,
            Modelled = true,
            Timeline = ModeBoard.TimelinePlayback,
        };

        private static ModeRangeArgs Range(double start, double end) =>
            new ModeRangeArgs { Mode = "preview", StartUt = start, EndUt = end };

        [Fact]
        public void WithNothingElseOn_TheModeIsLive_AnsweringNothingWithNoTimeline()
        {
            var state = new ModeBoard(() => _now).State();

            Assert.Equal("live", state.Mode);
            Assert.Equal("Live", state.Name);
            Assert.Equal("nothing", state.Answers);
            Assert.Null(state.Timeline);
        }

        [Fact]
        public void AModeAnswersForTheCraftOrForNothing_AndNothingElseIsTaken()
        {
            var board = new ModeBoard(() => _now);
            var declaration = Preview();
            declaration.Answers = "vessel.orbit";

            Assert.Contains("\"craft\" or \"nothing\"", board.Declare(declaration, "gonogo"));
        }

        [Fact]
        public void AnEnteredModeEndsWhenTheCraftItWasEnteredWithChangesOrGoes()
        {
            var board = Board();
            board.SetScene("FLIGHT");
            board.SetActiveCraft("craft-a");
            Assert.Null(board.Enter("preview"));

            // The same craft said again changes nothing.
            board.SetActiveCraft("craft-a");
            Assert.Equal("preview", board.State().Mode);

            board.SetActiveCraft("craft-b");
            Assert.Equal("live", board.State().Mode);

            Assert.Null(board.Enter("preview"));
            board.SetActiveCraft(null);
            Assert.Equal("live", board.State().Mode);
        }

        [Fact]
        public void AnEnteredModeWithNoScenesNamedStillEndsWhenTheSceneItWasEnteredInChanges()
        {
            var board = new ModeBoard(() => _now);
            var anywhere = Preview();
            anywhere.Scenes.Clear();
            Assert.Null(board.Declare(anywhere, "gonogo"));

            // Entered with no game at all, as a recording is at the main menu.
            Assert.Null(board.Enter("preview"));
            Assert.Equal("preview", board.State().Mode);

            board.SetScene("FLIGHT");
            Assert.Equal("live", board.State().Mode);
        }

        [Fact]
        public void AnEnteredModeEndsWhenTheLastScreenHasGone()
        {
            var board = Board();
            board.SetScene("FLIGHT");
            Assert.Null(board.Enter("preview"));
            Assert.True(board.Entered);

            board.LastScreenLeft();

            Assert.False(board.Entered);
            Assert.Equal("live", board.State().Mode);
        }

        [Fact]
        public void AnEnteredModeIsOnOnlyInItsScenes_AndLeavingTheSceneTurnsItOff()
        {
            var board = Board();

            Assert.NotNull(board.Enter("preview"));

            board.SetScene("FLIGHT");
            Assert.Null(board.Enter("preview"));
            Assert.Equal("preview", board.State().Mode);
            Assert.Equal("craft", board.State().Answers);
            Assert.True(board.State().Modelled);

            board.SetScene("SPACECENTER");
            Assert.Equal("live", board.State().Mode);

            board.SetScene("FLIGHT");
            Assert.Equal("live", board.State().Mode);
        }

        [Fact]
        public void AModeOnBySceneNeedsNoCommand_AndTheLowestOrderWins()
        {
            var board = Board();
            Assert.Null(board.Declare(
                new ModeDeclaration
                {
                    Id = "design",
                    Order = 10,
                    Activation = ModeBoard.ActivationScene,
                    Scenes = { "EDITOR", "FLIGHT" },
                },
                "gonogo"));

            board.SetScene("FLIGHT");
            Assert.Null(board.Enter("preview"));

            Assert.Equal("design", board.State().Mode);
            Assert.Equal(
                new[] { "design", "preview", "live" },
                board.Listing().Modes.Select(m => m.Declaration.Id));
            Assert.All(board.Listing().Modes, m => Assert.True(m.Eligible));
        }

        [Fact]
        public void AModeAnotherOwnerDeclaredIsRefused_AndItsOwnOwnerMayDeclareItAgain()
        {
            var board = Board();

            Assert.NotNull(board.Declare(Preview(), "someone-else"));
            Assert.Null(board.Declare(Preview(), "gonogo"));
            Assert.NotNull(board.Declare(new ModeDeclaration { Id = "x", Activation = "sometimes" }, "x"));
            Assert.NotNull(board.Declare(new ModeDeclaration { Id = "x", Activation = ModeBoard.ActivationScene }, "x"));
        }

        [Fact]
        public void TheTimelineIsTheModesOwn_AndIsGoneWhenTheModeGoesOff()
        {
            var board = Board();
            board.SetScene("FLIGHT");

            Assert.NotNull(board.SetRange(Range(100, 200)));

            board.Enter("preview");
            var entry = board.State().Entry;
            Assert.Null(board.SetRange(Range(100, 200)));
            Assert.Equal(100, board.State().Timeline!.AtUt);

            board.Exit("preview");
            Assert.Null(board.State().Timeline);
            Assert.NotNull(board.Seek("preview", 150));

            board.Enter("preview");
            Assert.Null(board.State().Timeline);
            Assert.Equal(entry + 2, board.State().Entry);
        }

        [Fact]
        public void SeekIsHeldInsideTheRange()
        {
            var board = Board();
            board.SetScene("FLIGHT");
            board.Enter("preview");
            board.SetRange(Range(100, 200));

            board.Seek("preview", 150);
            Assert.Equal(150, board.State().Timeline!.AtUt);
            board.Seek("preview", 5);
            Assert.Equal(100, board.State().Timeline!.AtUt);
            board.Seek("preview", 500);
            Assert.Equal(200, board.State().Timeline!.AtUt);
            Assert.NotNull(board.Seek("preview", double.NaN));
        }

        [Fact]
        public void APlayingTimelineMovesAtItsRateInRealSeconds_IsPublishedAgainEachSecond_AndStopsAtTheEnd()
        {
            var board = Board();
            board.SetScene("FLIGHT");
            board.Enter("preview");
            board.SetRange(Range(100, 200));

            Assert.NotNull(board.Play("preview", 7));
            Assert.Null(board.Play("preview", 10));

            _now = 0.5;
            Assert.Equal(100, board.State().Timeline!.AtUt);
            Assert.True(board.State().Timeline!.Playing);

            _now = 1.5;
            Assert.Equal(115, board.State().Timeline!.AtUt);

            _now = 2.0;
            Assert.Null(board.Pause("preview"));
            Assert.Equal(120, board.State().Timeline!.AtUt);
            Assert.False(board.State().Timeline!.Playing);

            _now = 50;
            Assert.Equal(120, board.State().Timeline!.AtUt);

            board.Play("preview", 0);
            _now = 60;
            var ended = board.State().Timeline!;
            Assert.Equal(200, ended.AtUt);
            Assert.False(ended.Playing);

            board.Play("preview", 0);
            Assert.Equal(100, board.State().Timeline!.AtUt);
        }

        [Fact]
        public void ARateChosenOnAHeldTimelineIsKeptForTheNextPlay_AndTheTimelineDoesNotMove()
        {
            var board = Board();
            board.SetScene("FLIGHT");
            board.Enter("preview");
            board.SetRange(Range(100, 200));

            Assert.NotNull(board.Pause("preview", 7));
            Assert.Null(board.Pause("preview", 10));
            _now = 5;
            var held = board.State().Timeline!;
            Assert.False(held.Playing);
            Assert.Equal(100, held.AtUt);
            Assert.Equal(10, held.Rate);

            // Play with no rate plays at the one chosen while it was held.
            Assert.Null(board.Play("preview", 0));
            _now = 6;
            Assert.Equal(110, board.State().Timeline!.AtUt);

            // Held while playing with a new rate: it stands where the old rate had taken it.
            _now = 7;
            Assert.Null(board.Pause("preview", 1));
            Assert.Equal(120, board.State().Timeline!.AtUt);
            Assert.Equal(1, board.State().Timeline!.Rate);
        }

        [Fact]
        public void ANewRangeKeepsThePositionInsideIt_AndAnEmptyOneSaysWhyThereIsNoTimeline()
        {
            var board = Board();
            board.SetScene("FLIGHT");
            board.Enter("preview");
            board.SetRange(Range(100, 200));
            board.Seek("preview", 150);

            board.SetRange(Range(120, 400));
            Assert.Equal(150, board.State().Timeline!.AtUt);

            board.SetRange(Range(300, 400));
            Assert.Equal(300, board.State().Timeline!.AtUt);

            var none = Range(0, 0);
            none.NoTimeline = "No maneuver nodes";
            board.SetRange(none);
            Assert.Null(board.State().Timeline);
            Assert.Equal("No maneuver nodes", board.State().NoTimeline);
        }

        [Fact]
        public void AScrubTimelineDoesNotPlay_AndAModeWithNoTimelineTakesNoRange()
        {
            var board = new ModeBoard(() => _now);
            var scrub = Preview();
            scrub.Timeline = ModeBoard.TimelineScrub;
            scrub.Scenes = new List<string>();
            board.Declare(scrub, "gonogo");
            board.Enter("preview");
            board.SetRange(Range(0, 10));

            Assert.NotNull(board.Play("preview", 0));
            Assert.Empty(board.State().Timeline!.Rates);
            Assert.NotNull(board.SetRange(new ModeRangeArgs { Mode = "live", StartUt = 0, EndUt = 10 }));
        }

        [Fact]
        public void InputsAreKeptWhileTheModeIsOff_AndAnEmptyValueRemovesOne()
        {
            var board = Board();
            board.SetScene("FLIGHT");

            Assert.Null(board.SetInput("preview", "plan", "[1]"));
            Assert.Null(board.SetInput("preview", "plan", "[2]"));
            Assert.Null(board.SetInput("preview", "other", "x"));
            Assert.NotNull(board.SetInput("nothing", "plan", "[1]"));

            board.Enter("preview");
            Assert.Equal(new[] { "plan=[2]", "other=x" }, board.State().Inputs.Select(i => i.Key + "=" + i.Value));

            board.SetInput("preview", "plan", "");
            Assert.Equal("other", Assert.Single(board.State().Inputs).Key);
        }
    }
}
