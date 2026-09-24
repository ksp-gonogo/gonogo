namespace Sitrep.Host.Settings
{
    /// <summary>
    /// A backing store that keeps the document in memory, for everything that
    /// is about the store rather than about the file: the change notification,
    /// the coercion, the seeding of declared defaults, and a consumer's
    /// reaction to a commit.
    ///
    /// <para>It also holds the mod's settings before the game supplies a real
    /// one, so a command that stages and commits is total and needs no
    /// null-store arm that would quietly stop applying the change.</para>
    ///
    /// <para>Lives here rather than in the shipped test-support assembly
    /// because that assembly reaches only <c>Sitrep.Contract</c>, and
    /// <c>ISettingsBackingStore</c> is declared here.</para>
    /// </summary>
    public sealed class InMemorySettingsStore : ISettingsBackingStore
    {
        private SettingsDocument _stored;
        private bool _changedElsewhere;

        public InMemorySettingsStore()
            : this(new SettingsDocument())
        {
        }

        public InMemorySettingsStore(SettingsDocument seed)
        {
            _stored = seed?.Copy() ?? new SettingsDocument();
        }

        public string Path => "(memory)";

        /// <summary>Set to make the next write fail with this reason, so a consumer's failure arm can be exercised.</summary>
        public string? FailWith { get; set; }

        /// <summary>How many times a document has been written, which is how a test sees one write per SAVE press rather than one per row.</summary>
        public int Writes { get; private set; }

        public SettingsDocument Read()
        {
            _changedElsewhere = false;
            return _stored.Copy();
        }

        public WriteOutcome Write(SettingsDocument document)
        {
            if (FailWith != null)
            {
                return WriteOutcome.Failed(Path, FailWith);
            }

            _stored = document?.Copy() ?? new SettingsDocument();
            _changedElsewhere = false;
            Writes++;
            return WriteOutcome.Written(Path);
        }

        public SettingsDocument? ReadIfChangedElsewhere()
        {
            if (!_changedElsewhere || _stored.IsEmpty)
            {
                return null;
            }

            return Read();
        }

        /// <summary>
        /// Replace what the medium holds as another process would, such as an
        /// operator editing the file while the game runs.
        /// </summary>
        public void EditElsewhere(SettingsDocument document)
        {
            _stored = document?.Copy() ?? new SettingsDocument();
            _changedElsewhere = true;
        }
    }
}
