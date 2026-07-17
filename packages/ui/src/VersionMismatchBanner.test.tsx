import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { VersionMismatchBanner } from "./VersionMismatchBanner";

describe("VersionMismatchBanner", () => {
  it("renders RELOAD REQUIRED with role='alert' on a major mismatch", () => {
    const { getByRole, getByText } = render(
      <VersionMismatchBanner kind="major" local="1.2.3" remote="2.0.0" />,
    );
    const pill = getByRole("alert");
    expect(pill.getAttribute("aria-live")).toBe("assertive");
    expect(getByText("RELOAD REQUIRED")).not.toBeNull();
    expect(getByText(/Peer v2\.0\.0 ↔ this v1\.2\.3/)).not.toBeNull();
  });

  it("renders VERSION MISMATCH with role='status' on a minor mismatch", () => {
    const { getByRole, getByText } = render(
      <VersionMismatchBanner kind="minor" local="1.2.3" remote="1.3.0" />,
    );
    const pill = getByRole("status");
    expect(pill.getAttribute("aria-live")).toBe("polite");
    expect(getByText("VERSION MISMATCH")).not.toBeNull();
  });

  it("renders 'didn't report a version' for unknown", () => {
    const { getByText } = render(
      <VersionMismatchBanner
        kind="unknown"
        local="1.2.3"
        remote={null}
        remoteLabel="Mission Control"
      />,
    );
    expect(getByText("VERSION UNKNOWN")).not.toBeNull();
    expect(getByText(/Mission Control didn't report a version/)).not.toBeNull();
  });
});
