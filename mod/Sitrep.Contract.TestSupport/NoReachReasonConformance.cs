using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="ICommsNoReachReason"/> promises, for an implementer to run
    /// against their own reach model.
    /// </summary>
    public static class NoReachReasonConformance
    {
        /// <summary>
        /// Asserts the contract for one model the backend built: a reason is
        /// absent or a non-blank id, it reads the same on every call, and a model
        /// that gives one also says nothing reaches (a maximum range of 0), since a
        /// reason explains an absence of reach and has no meaning beside a range.
        /// </summary>
        /// <param name="model">A reach model that also says why nothing reaches, built for a pair that has no reach.</param>
        public static void AssertReasonContract(ICommsNoReachReason model)
        {
            Assert.NotNull(model);
            var name = model.GetType().Name;

            var reason = model.NoReachReason;
            Assert.True(
                reason == null || reason.Trim().Length > 0,
                name + ": a reason is null or a non-blank id, not an empty string.");
            Assert.True(
                Equals(reason, model.NoReachReason),
                name + ": a reason must read the same on every call.");

            if (reason != null && model is ICommsReachModel reach)
            {
                Assert.True(
                    reach.MaxRangeMeters == 0.0,
                    name + ": it gives the reason '" + reason + "' but its maximum range is "
                    + (reach.MaxRangeMeters?.ToString() ?? "absent") + " rather than 0.");
            }
        }
    }
}
