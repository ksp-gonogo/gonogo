namespace Gonogo.KSP
{
    internal static class PartTreeRules
    {
        /// <summary>
        /// The index of the part a saved part hangs from, or -1 for a root. A saved
        /// root names itself as its own parent, which is no parent: a root reads as
        /// parentless, as a loaded one does.
        /// </summary>
        public static int ParentIndex(int index, int savedParentIndex, int partCount) =>
            savedParentIndex < 0 || savedParentIndex >= partCount || savedParentIndex == index
                ? -1
                : savedParentIndex;
    }
}
