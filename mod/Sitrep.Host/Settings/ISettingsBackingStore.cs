namespace Sitrep.Host.Settings
{
    /// <summary>What became of a persist attempt.</summary>
    public sealed class WriteOutcome
    {
        private WriteOutcome(bool success, string path, string? reason)
        {
            Success = success;
            Path = path;
            Reason = reason;
        }

        /// <summary>Nothing has been committed yet, which is the state a store is in from boot until the first SAVE.</summary>
        public static readonly WriteOutcome NotAttempted = new WriteOutcome(false, string.Empty, null);

        public static WriteOutcome Written(string path) => new WriteOutcome(true, path ?? string.Empty, null);

        public static WriteOutcome Failed(string path, string reason) =>
            new WriteOutcome(false, path ?? string.Empty, reason ?? "no reason given");

        public bool Success { get; }

        /// <summary>Where the write went, or would have gone.</summary>
        public string Path { get; }

        /// <summary>Prose for a human, never parsed. Null on success.</summary>
        public string? Reason { get; }
    }

    /// <summary>
    /// The medium a <see cref="SettingsStore"/> reads from and writes to.
    ///
    /// <para>The path is the implementation's own, supplied at construction
    /// rather than resolved from the running game. That is not a convenience:
    /// a path derived from a live Unity player cannot be reached headlessly, so
    /// a write built on one can only ever be observed by hand, and a test over
    /// it asserts nothing about whether a file was written.</para>
    /// </summary>
    public interface ISettingsBackingStore
    {
        /// <summary>Where this store reads and writes, for reporting to an operator.</summary>
        string Path { get; }

        /// <summary>
        /// The document as it stands on the medium. An absent or unreadable
        /// medium yields an EMPTY document rather than throwing, so a first run
        /// and a damaged file take the same path through the store.
        /// </summary>
        SettingsDocument Read();

        /// <summary>
        /// Persist the whole document. Never throws: a settings change is
        /// already in force in memory by the time this is called, so a failure
        /// is reported rather than raised.
        /// </summary>
        WriteOutcome Write(SettingsDocument document);

        /// <summary>
        /// The document as the medium now holds it, when something other than
        /// this store has changed the medium since this store last read or
        /// wrote it; otherwise null.
        ///
        /// <para>Also null when the medium is now absent, unreadable or empty.
        /// None of those says what the settings are, only that the file cannot
        /// currently say, and a save that took one as the new content would
        /// delete every block it could not see.</para>
        /// </summary>
        SettingsDocument? ReadIfChangedElsewhere();
    }
}
