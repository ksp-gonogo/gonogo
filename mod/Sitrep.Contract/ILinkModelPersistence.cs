using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// A contact link model that can say what it is made of as plain data, so a
    /// game saved with it can build it again on load.
    ///
    /// <para>A command centre plans each pair from the link model inside the
    /// craft state it heard. A craft the centre cannot hear from keeps the state
    /// it was last heard with, so a model that does not survive a load leaves
    /// that pair planned on range alone, where the backend's pointing, aim and
    /// noise no longer apply, until the craft is heard again.</para>
    /// </summary>
    /// <category>Comms models</category>
    public interface IPersistableContactLinkModel : IContactLinkModel
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
    /// A comms backend that can build again a contact link model it described.
    ///
    /// <para><b>Pure, and called from any thread.</b> It reads nothing from the
    /// game: the model is made from the data alone, so a load can rebuild every
    /// model a save carries before the game's own state has settled.</para>
    /// </summary>
    /// <category>Comms models</category>
    public interface ILinkModelRestorer
    {
        /// <summary>
        /// The model <paramref name="modelId"/> described by <paramref name="data"/>,
        /// or <c>null</c> when this backend does not know that id or the data is not
        /// one it wrote, in which case the centre plans the pair on range alone
        /// until it hears the craft again.
        /// </summary>
        /// <param name="modelId">The <see cref="IPersistableContactLinkModel.ModelId"/> the model was saved under.</param>
        /// <param name="data">What <see cref="IPersistableContactLinkModel.Describe"/> returned, as a save reads it back.</param>
        IContactLinkModel? RestoreLinkModel(string modelId, IReadOnlyDictionary<string, object?> data);
    }
}
