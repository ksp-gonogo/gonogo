import { spawnSync } from "node:child_process";

/**
 * The branch the checked-out repo is on, or "" when it is detached. The gate
 * runs another repository's checks, so it judges that repository by its own
 * branch rather than by the pull request that triggered the gonogo run.
 */
export function checkoutBranch(cwd) {
  const ran = spawnSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  return ran.status === 0 ? ran.stdout.trim() : "";
}

/** The environment for a child run inside the checked-out repo. */
export function checkoutEnv(base, branch) {
  return { ...base, GITHUB_BASE_REF: "", GITHUB_REF_NAME: branch };
}
