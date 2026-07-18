using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.ActionGroupsExtendedUplink.Tests
{
    /// <summary>
    /// The pure mapping logic of <see cref="AgxActionGroupsBackend"/>, unit
    /// tested against a fake <see cref="IAgxApi"/> — no KSP, no real AGExt
    /// assembly, exactly the TDD step
    /// docs/superpowers/specs/2026-07-17-agx-backend-design.md §5.2 calls out
    /// as AGX going one step further than <c>RaCommsBackend</c> (which RA
    /// leaves untested).
    /// </summary>
    public class AgxActionGroupsBackendTests
    {
        private sealed class FakeAgxApi : IAgxApi
        {
            public bool IsAvailable { get; set; } = true;
            public IReadOnlyList<AgxGroup>? Groups { get; set; }
            public bool ActivateResult { get; set; }
            public (int Index, bool On)? LastActivateCall { get; private set; }

            public IReadOnlyList<AgxGroup>? AssignedGroups() => Groups;

            public bool Activate(int index, bool on)
            {
                LastActivateCall = (index, on);
                return ActivateResult;
            }
        }

        [Fact]
        public void Groups_NullAssignedGroups_ReturnsNull_NotEmpty()
        {
            var fake = new FakeAgxApi { Groups = null };
            var backend = new AgxActionGroupsBackend(fake);

            Assert.Null(backend.Groups());
        }

        [Fact]
        public void Groups_OutOfOrderInput_ReturnsIndexAscendingWithCorrectFields()
        {
            var fake = new FakeAgxApi
            {
                Groups = new List<AgxGroup>
                {
                    new AgxGroup(5, "Science Bay", true),
                    new AgxGroup(1, "Solar Panels", false),
                    new AgxGroup(3, "Comms", true),
                },
            };
            var backend = new AgxActionGroupsBackend(fake);

            var result = backend.Groups();

            Assert.NotNull(result);
            var indices = result!.Select(g => g.Index).ToArray();
            Assert.Equal(new[] { 1, 3, 5 }, indices);

            var solar = result.Single(g => g.Index == 1);
            Assert.Equal("Solar Panels", solar.Name);
            Assert.False(solar.State);

            var science = result.Single(g => g.Index == 5);
            Assert.Equal("Science Bay", science.Name);
            Assert.True(science.State);
        }

        [Fact]
        public void Groups_MissingName_FallsBackToAGPrefixLabel()
        {
            var fake = new FakeAgxApi
            {
                Groups = new List<AgxGroup> { new AgxGroup(42, null, true) },
            };
            var backend = new AgxActionGroupsBackend(fake);

            var result = backend.Groups();

            Assert.NotNull(result);
            Assert.Equal("AG42", result!.Single().Name);
        }

        [Fact]
        public void SetGroup_DelegatesToActivate_AndReturnsTrueOnSuccess()
        {
            var fake = new FakeAgxApi { ActivateResult = true };
            var backend = new AgxActionGroupsBackend(fake);

            var result = backend.SetGroup(7, true);

            Assert.True(result);
            Assert.Equal((7, true), fake.LastActivateCall);
        }

        [Fact]
        public void SetGroup_DelegatesToActivate_AndReturnsFalseOnRejection()
        {
            var fake = new FakeAgxApi { ActivateResult = false };
            var backend = new AgxActionGroupsBackend(fake);

            var result = backend.SetGroup(999, false);

            Assert.False(result);
            Assert.Equal((999, false), fake.LastActivateCall);
        }
    }
}
