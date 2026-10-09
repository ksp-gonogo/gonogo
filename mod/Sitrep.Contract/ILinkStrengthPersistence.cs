using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// A link strength model that can say what it is made of as plain data, so a
    /// game saved with it can build it again on load.
    ///
    /// <para>A command centre's strength models arrive inside the craft states it
    /// hears. A save keeps what each centre has heard, so the models it holds go
    /// with it, or every centre would know less after a load than before it until
    /// each craft was heard from again, one light-time later.</para>
    /// </summary>
    /// <category>Comms models</category>
    public interface IPersistableLinkStrength : IContactLinkStrength
    {
        /// <summary>Names the kind of model and the layout of <see cref="Describe"/>, so a later build can tell a model it still reads from one it does not.</summary>
        string ModelId { get; }

        /// <summary>
        /// Everything the model needs to answer as it does now, as nested
        /// dictionaries, lists, strings, numbers, booleans and nulls only: the
        /// shapes a save writes and reads back.
        /// </summary>
        Dictionary<string, object?> Describe();
    }

    /// <summary>
    /// A comms backend that can build again a strength model it described.
    ///
    /// <para><b>Pure, and called from any thread.</b> It reads nothing from the
    /// game: the model is made from the data alone, so a load can rebuild every
    /// model a save carries before the game's own state has settled.</para>
    /// </summary>
    /// <category>Comms models</category>
    public interface ILinkStrengthRestorer
    {
        /// <summary>
        /// The model <paramref name="modelId"/> described by <paramref name="data"/>,
        /// or <c>null</c> when this backend does not know that id or the data is not
        /// one it wrote, in which case the centre states no strength for the pair
        /// until it hears the craft again.
        /// </summary>
        /// <param name="modelId">The <see cref="IPersistableLinkStrength.ModelId"/> the model was saved under.</param>
        /// <param name="data">What <see cref="IPersistableLinkStrength.Describe"/> returned, as a save reads it back.</param>
        IContactLinkStrength? RestoreLinkStrength(string modelId, IReadOnlyDictionary<string, object?> data);
    }
}
