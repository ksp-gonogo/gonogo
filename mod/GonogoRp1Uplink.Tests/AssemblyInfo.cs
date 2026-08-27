using Xunit;

// RP-1's model is reached through STATICS: SpaceCenterManagement.Instance,
// Confidence.Instance, Funding.Instance, and RP-1's own settings singletons.
// That is not a stand-in convenience, it is how RP-1 is shaped, so every test
// class here builds its centre by assigning the same static and xUnit's default
// per-class parallelism has them overwriting each other's world mid-assertion.
//
// It stayed invisible while the timing happened to work out, and surfaced the
// moment a second class started writing SpaceCenterManagement.Instance: two
// launch-gate cases began failing on a change that touched neither. Serialising
// is the fix rather than a per-pair [Collection], because the collision is
// between the STATICS and any class that writes them, not between two classes
// somebody has noticed. The whole assembly runs in about a tenth of a second.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
