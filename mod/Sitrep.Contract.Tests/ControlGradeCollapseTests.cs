using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Contract.Tests
{
    /// <summary>
    /// <see cref="CommsBackendBase"/>'s collapse of a backend's
    /// <see cref="CommsControlGrade"/> onto <c>comms.connectivity</c> and
    /// <c>comms.control</c>. A grade the backend could not name has to arrive as
    /// unknown on both, never as the measured "no control source" a craft with
    /// nothing aboard to command it reports.
    /// </summary>
    public class ControlGradeCollapseTests
    {
        private sealed class GradedBackend : CommsBackendBase
        {
            private readonly CommsControlGrade _grade;

            public GradedBackend(CommsControlGrade grade) => _grade = grade;

            public override string ProviderId => "graded";

            public override IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to) => null;

            public override ICommsReachModel ReachModel(object? from, object? to) => CommsReachModels.Unknown;

            public override ICommsOcclusionModel OcclusionModel() => CommsOcclusionModels.Unknown;

            public override ICommsDegradeModel DegradeModel() => CommsDegradeModels.Unknown;

            protected override CommsSubject Subject() => new CommsSubject("craft", true);

            protected override CommsLinkState? LinkState() => new CommsLinkState(true, _grade, 1.0);

            protected override IReadOnlyList<CommsLinkView>? ControlPath() => null;
        }

        [Theory]
        [InlineData(CommsControlGrade.None, CommsControlSource.None, CommsControlStateKind.None, false)]
        [InlineData(CommsControlGrade.PartialUnmanned, CommsControlSource.Partial, CommsControlStateKind.PartialManoeuvre, false)]
        [InlineData(CommsControlGrade.PartialManned, CommsControlSource.Partial, CommsControlStateKind.PartialManoeuvre, true)]
        [InlineData(CommsControlGrade.Full, CommsControlSource.Full, CommsControlStateKind.Full, true)]
        public void CollapsesEachNamedGrade(
            CommsControlGrade grade,
            CommsControlSource source,
            CommsControlStateKind kind,
            bool localControl)
        {
            var backend = new GradedBackend(grade);

            Assert.Equal(source, backend.Connectivity().ControlSource);
            Assert.Equal(localControl, backend.Connectivity().HasLocalControl);
            Assert.Equal(kind, backend.ControlState().Level);
        }

        [Fact]
        public void AGradeTheBackendCouldNotNameReadsAsUnknownAndNotAsNoControl()
        {
            var backend = new GradedBackend(CommsControlGrade.Unknown);

            Assert.Equal(CommsControlSource.Unknown, backend.Connectivity().ControlSource);
            Assert.Equal(CommsControlStateKind.Unknown, backend.ControlState().Level);
        }

        /// <summary>
        /// An ordinal the enum does not declare has no honest member to map to,
        /// so it fails the read, which drops the tick and leaves last-known
        /// standing.
        /// </summary>
        [Fact]
        public void AnUndeclaredGradeFailsTheReadRatherThanReportingOne()
        {
            var backend = new GradedBackend((CommsControlGrade)(Enum.GetValues(typeof(CommsControlGrade)).Length + 1));

            Assert.ThrowsAny<InvalidOperationException>(() => backend.Connectivity());
            Assert.ThrowsAny<InvalidOperationException>(() => backend.ControlState());
        }
    }
}
