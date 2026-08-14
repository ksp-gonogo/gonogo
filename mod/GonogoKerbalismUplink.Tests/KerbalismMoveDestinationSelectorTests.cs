using System.Collections.Generic;
using Gonogo.KerbalismUplink;
using Xunit;

namespace GonogoKerbalismUplink.Tests
{
    /// <summary>
    /// Unit tests for <see cref="KerbalismMoveDestinationSelector"/>: the pure
    /// "which drive gets the sample" decision behind
    /// <c>kerbalism.sample.moveToLab</c>, pulled out of
    /// <see cref="KerbalismFileActuator"/>'s live reflection glue precisely so
    /// it is testable without a vessel.
    /// </summary>
    public class KerbalismMoveDestinationSelectorTests
    {
        [Fact]
        public void Select_NoCandidates_ReturnsNull()
        {
            Assert.Null(KerbalismMoveDestinationSelector.Select(new List<MoveDestinationCandidate>(), 10));
        }

        [Fact]
        public void Select_SkipsTheSourceDriveEvenWhenItIsLabAdjacentAndHasRoom()
        {
            var candidates = new List<MoveDestinationCandidate>
            {
                new(labAdjacent: true, isSource: true, availableCapacity: 1000),
            };

            Assert.Null(KerbalismMoveDestinationSelector.Select(candidates, 10));
        }

        [Fact]
        public void Select_SkipsANonLabDriveEvenWithRoom()
        {
            var candidates = new List<MoveDestinationCandidate>
            {
                new(labAdjacent: false, isSource: false, availableCapacity: 1000),
            };

            Assert.Null(KerbalismMoveDestinationSelector.Select(candidates, 10));
        }

        [Fact]
        public void Select_SkipsALabDriveWithoutEnoughRoomForTheWholeSample()
        {
            var candidates = new List<MoveDestinationCandidate>
            {
                new(labAdjacent: true, isSource: false, availableCapacity: 5),
            };

            Assert.Null(KerbalismMoveDestinationSelector.Select(candidates, 10));
        }

        [Fact]
        public void Select_SkipsACandidateWhoseCapacityReadFailed()
        {
            var candidates = new List<MoveDestinationCandidate>
            {
                new(labAdjacent: true, isSource: false, availableCapacity: null),
            };

            Assert.Null(KerbalismMoveDestinationSelector.Select(candidates, 10));
        }

        [Fact]
        public void Select_OneQualifyingCandidate_ReturnsItsIndex()
        {
            var candidates = new List<MoveDestinationCandidate>
            {
                new(labAdjacent: false, isSource: false, availableCapacity: 1000), // not lab-adjacent
                new(labAdjacent: true, isSource: true, availableCapacity: 1000),   // is the source
                new(labAdjacent: true, isSource: false, availableCapacity: 50),    // qualifies
            };

            Assert.Equal(2, KerbalismMoveDestinationSelector.Select(candidates, 10));
        }

        [Fact]
        public void Select_MultipleQualifyingCandidates_PicksTheMostAvailableCapacity()
        {
            var candidates = new List<MoveDestinationCandidate>
            {
                new(labAdjacent: true, isSource: false, availableCapacity: 20),
                new(labAdjacent: true, isSource: false, availableCapacity: 80),
                new(labAdjacent: true, isSource: false, availableCapacity: 50),
            };

            Assert.Equal(1, KerbalismMoveDestinationSelector.Select(candidates, 10));
        }

        [Fact]
        public void Select_ExactCapacityMatch_Qualifies()
        {
            var candidates = new List<MoveDestinationCandidate>
            {
                new(labAdjacent: true, isSource: false, availableCapacity: 10),
            };

            Assert.Equal(0, KerbalismMoveDestinationSelector.Select(candidates, 10));
        }
    }
}
