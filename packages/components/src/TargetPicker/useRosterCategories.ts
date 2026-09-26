import { TargetKind, type TargetListEntry } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { SPACE_OBJECT_VESSEL_TYPE, sortByDistance } from "./entries";

/** The roster filtered by name and the asteroid toggle, split into its categories and the Suggested list. */
export function useRosterCategories(
  entries: readonly TargetListEntry[],
  filterText: string,
  showSpaceObjects: boolean,
) {
  const isFiltering = filterText.length > 0;

  const nameFiltered = useMemo(() => {
    if (!isFiltering) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(filterText));
  }, [entries, filterText, isFiltering]);

  const spaceObjectCount = useMemo(
    () =>
      nameFiltered.filter(
        (e) =>
          e.kind === TargetKind.Vessel &&
          e.vesselType === SPACE_OBJECT_VESSEL_TYPE,
      ).length,
    [nameFiltered],
  );

  // The asteroid/comet toggle applies to Vessel-kind entries only.
  const visible = useMemo(
    () =>
      nameFiltered.filter(
        (e) =>
          !(
            e.kind === TargetKind.Vessel &&
            e.vesselType === SPACE_OBJECT_VESSEL_TYPE &&
            !showSpaceObjects
          ),
      ),
    [nameFiltered, showSpaceObjects],
  );

  const bodiesList = useMemo(
    () => sortByDistance(visible.filter((e) => e.kind === TargetKind.Body)),
    [visible],
  );
  const vesselsList = useMemo(
    () => sortByDistance(visible.filter((e) => e.kind === TargetKind.Vessel)),
    [visible],
  );
  const partsList = useMemo(
    () => sortByDistance(visible.filter((e) => e.kind === TargetKind.Part)),
    [visible],
  );
  // Anything not a Body/Vessel/Part buckets here rather than rendering invisibly.
  const otherList = useMemo(
    () =>
      sortByDistance(
        visible.filter(
          (e) =>
            e.kind !== TargetKind.Body &&
            e.kind !== TargetKind.Vessel &&
            e.kind !== TargetKind.Part,
        ),
      ),
    [visible],
  );

  // Suggested: 2 closest Bodies, 2 closest Vessels and all Parts.
  const suggested = useMemo(
    () => [...bodiesList.slice(0, 2), ...vesselsList.slice(0, 2), ...partsList],
    [bodiesList, vesselsList, partsList],
  );

  const noCategoriesHaveEntries =
    bodiesList.length === 0 &&
    vesselsList.length === 0 &&
    partsList.length === 0 &&
    otherList.length === 0;

  return {
    isFiltering,
    spaceObjectCount,
    bodiesList,
    vesselsList,
    partsList,
    otherList,
    suggested,
    noCategoriesHaveEntries,
  };
}
