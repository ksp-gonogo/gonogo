using System;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The two Breaking Ground reads that could not express the null their own
    /// contract declares (<see cref="BreakingGroundReads"/>).
    ///
    /// <para>Both were reported as a definite <c>false</c> when the reflective
    /// read behind them failed: <c>robotics.available</c> said "No robotic
    /// parts on this vessel" about a craft that has them, and
    /// <c>controllerConnected</c> painted a deployed base red as
    /// <c>Unpowered</c>. The surrounding walks need a live <c>Vessel</c> and
    /// cannot be entered headlessly, which is why the decisions are carved out
    /// here, the same way <c>ServoCapture</c> was.</para>
    /// </summary>
    public class BreakingGroundReadsTests
    {
        private sealed class Subject
        {
            public string? Field = "from a field";

            public string? Property => "from a property";

            /// <summary>A member that is present and genuinely reads as null, which is NOT a failed read.</summary>
            public object? EmptyProperty => null;

            /// <summary>Breaking Ground's types are read reflectively because they are obfuscation-risky; a throwing member is a routine event, not an impossible one.</summary>
            public string? Throws => throw new InvalidOperationException("member read blew up");
        }

        [Fact]
        public void TryMemberReadsAField()
        {
            var subject = new Subject();

            var read = BreakingGroundReads.TryMember(
                typeof(Subject), subject, nameof(Subject.Field), out var value, out var failure);

            Assert.True(read);
            Assert.Null(failure);
            Assert.Equal("from a field", value);
        }

        [Fact]
        public void TryMemberReadsAProperty()
        {
            var subject = new Subject();

            var read = BreakingGroundReads.TryMember(
                typeof(Subject), subject, nameof(Subject.Property), out var value, out var failure);

            Assert.True(read);
            Assert.Null(failure);
            Assert.Equal("from a property", value);
        }

        [Fact]
        public void TryMemberSaysTheReadSUCCEEDEDWhenTheMemberIsGenuinelyNull()
        {
            /*
             * The distinction the whole fix rests on. A member that reads as
             * null has answered: this experiment has no cluster. Reporting that
             * as a failed read would throw away a fact we hold.
             */
            var subject = new Subject();

            var read = BreakingGroundReads.TryMember(
                typeof(Subject), subject, nameof(Subject.EmptyProperty), out var value, out var failure);

            Assert.True(read);
            Assert.Null(failure);
            Assert.Null(value);
        }

        [Fact]
        public void TryMemberSaysTheReadFAILEDWhenTheMemberThrows()
        {
            var subject = new Subject();

            var read = BreakingGroundReads.TryMember(
                typeof(Subject), subject, nameof(Subject.Throws), out var value, out var failure);

            Assert.False(read);
            Assert.Null(value);
            Assert.NotNull(failure);
        }

        [Fact]
        public void TryMemberSaysTheReadFAILEDWhenTheMemberIsAbsent()
        {
            // A renamed or obfuscated member across KSP versions: we did not
            // ask the question, so we have no answer to report.
            var subject = new Subject();

            var read = BreakingGroundReads.TryMember(
                typeof(Subject), subject, "NoSuchMember", out var value, out var failure);

            Assert.False(read);
            Assert.Null(value);
            Assert.NotNull(failure);
        }

        [Fact]
        public void RoboticsAvailableIsTrueWhenAServoWasFound()
        {
            Assert.True(
                BreakingGroundReads.RoboticsAvailable(
                    partListRead: true, anyServoFound: true, anyPartUnreadable: false));
        }

        [Fact]
        public void RoboticsAvailableIsTrueEvenIfAnotherPartCouldNotBeRead()
        {
            // One proven robotic part is proof, whatever the neighbours did.
            Assert.True(
                BreakingGroundReads.RoboticsAvailable(
                    partListRead: true, anyServoFound: true, anyPartUnreadable: true));
        }

        [Fact]
        public void RoboticsAvailableIsFalseOnlyWhenEveryPartWasRead()
        {
            Assert.False(
                BreakingGroundReads.RoboticsAvailable(
                    partListRead: true, anyServoFound: false, anyPartUnreadable: false));
        }

        [Fact]
        public void RoboticsAvailableIsNullWhenAPartCouldNotBeRead()
        {
            /*
             * The defect. "No robotic parts" is a claim about EVERY part, and
             * one of them did not answer, so the craft is unsurveyed rather
             * than bare. This used to fall through to false and both robotics
             * widgets rendered "No robotic parts on this vessel".
             */
            Assert.Null(
                BreakingGroundReads.RoboticsAvailable(
                    partListRead: true, anyServoFound: false, anyPartUnreadable: true));
        }

        [Fact]
        public void RoboticsAvailableIsNullWhenThePartListItselfCouldNotBeRead()
        {
            // Distinct from an EMPTY part list, which is a definite false.
            Assert.Null(
                BreakingGroundReads.RoboticsAvailable(
                    partListRead: false, anyServoFound: false, anyPartUnreadable: false));
        }

        [Fact]
        public void ControllerConnectedIsFalseWhenTheClusterReadFineAndWasNull()
        {
            // An experiment genuinely sitting unattached: a real answer.
            Assert.False(BreakingGroundReads.ControllerConnected(clusterRead: true, cluster: null));
        }

        [Fact]
        public void ControllerConnectedIsTrueWhenAClusterWasRead()
        {
            Assert.True(
                BreakingGroundReads.ControllerConnected(clusterRead: true, cluster: new object()));
        }

        [Fact]
        public void ControllerConnectedIsNullWhenTheClusterReadFAILED()
        {
            /*
             * The defect: `cluster != null` answered a definite "not connected"
             * for a read that never happened, and DerivePowerState's first
             * branch turned that into NotConnected, so a powered base rendered
             * red.
             */
            Assert.Null(BreakingGroundReads.ControllerConnected(clusterRead: false, cluster: null));
        }
    }
}
