export interface SystemViewConfig {
  /** Body the diagram centres on: "auto" follows the vessel's body, "root" walks to the topmost parent, a name pins it. */
  frame?: "auto" | "root" | string;
  /** The id of the `system-view.projection` entry the whole picture is drawn in; absent is the inertial entry for the centred body. */
  projection?: string;
}
