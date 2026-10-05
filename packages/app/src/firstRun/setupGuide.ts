/*
 * The facts every setup surface repeats: the command that starts Gonogo, the
 * commands that check on it, and the pages a failed check sends the operator
 * to. One module, because the deployed landing, the wizard and the static home
 * page (`docs/homepage/index.html`) all print them and a second spelling of a
 * run command is a second command to keep working. `setupGuide.test.ts` holds
 * the static page and the README to this one.
 */

/** The name the run command gives the container, which every follow-up command addresses. */
export const CONTAINER_NAME = "gonogo";

/**
 * Starts the app and the relay in one container, one entry per line it is
 * printed on. Every surface that prints the command renders these lines, so
 * the README, the home page and the app cannot drift.
 */
export const RUN_COMMAND_LINES = [
  `docker run -d --name ${CONTAINER_NAME} --restart unless-stopped`,
  "--add-host=host.docker.internal:host-gateway",
  "-e KSP_HOST=host.docker.internal",
  "-p 8080:8080 -p 3002:3002",
  "-p 3478:3478/tcp -p 3478:3478/udp",
  "-p 49160-49170:49160-49170/udp",
  "ghcr.io/ksp-gonogo/gonogo:latest",
] as const;

/** The run command as the single line it runs as, with no continuation of any shell's. */
export const RUN_COMMAND = RUN_COMMAND_LINES.join(" ");

/** The shell a command is written for: the default terminal's on Windows, and sh, bash and zsh everywhere else. */
export type CommandShell = "posix" | "powershell";

/**
 * What ends a line that carries on to the next. A backslash continues a line
 * only in sh, bash and zsh; PowerShell takes a backtick. Command Prompt takes
 * neither (its own is `^`), and a browser cannot tell it from PowerShell, so
 * the surfaces that print the PowerShell form say so beside it, in the copy
 * table's `container.powershellNote`.
 */
const LINE_CONTINUATION: Record<CommandShell, string> = {
  posix: "\\",
  powershell: "`",
};

/** The run command broken between flags, each line but the last ending in `shell`'s continuation, so the text pastes and runs as printed. */
export function runCommandFor(shell: CommandShell): string {
  return RUN_COMMAND_LINES.join(` ${LINE_CONTINUATION[shell]}\n  `);
}

/** Lists the container when it is running, and prints only a header row when it is not. */
export const CONTAINER_STATUS_COMMAND = `docker ps --filter name=${CONTAINER_NAME}`;

/** The container's recent output, which is where a relay that failed to start says why. */
export const CONTAINER_LOGS_COMMAND = `docker logs --tail 50 ${CONTAINER_NAME}`;

/** Where the running app is opened, once the container is up. */
export const LOCAL_APP_URL = "http://localhost:8080";

/** The line the mod writes to `KSP.log` once its server is up, found from the KSP install folder. */
export const MOD_LOG_COMMAND = {
  posix: 'grep "\\[Gonogo\\]" KSP.log',
  windows: 'findstr /C:"[Gonogo]" KSP.log',
} as const;

/** The CKAN identifier every Uplink depends on, and so the one a search for Uplinks names. */
export const CKAN_CORE_IDENTIFIER = "GonogoCore";

/** Typed into CKAN's search box, this lists every mod that depends on Gonogo: the Uplinks. */
export const CKAN_UPLINK_FILTER = `dep:${CKAN_CORE_IDENTIFIER}`;

const DOCS = "https://github.com/ksp-gonogo/gonogo/blob/main/docs";

export const SETUP_LINKS = {
  docker: "https://docs.docker.com/get-started/get-docker/",
  ckanInstall: "https://github.com/KSP-CKAN/CKAN/wiki/Installing-CKAN",
  ckanUserGuide: "https://github.com/KSP-CKAN/CKAN/wiki/User-guide",
  kspSetup: `${DOCS}/KSP-SETUP.md`,
  telemetryChecks: `${DOCS}/KSP-SETUP.md#checking-telemetry-is-arriving`,
  networking: `${DOCS}/NETWORKING.md`,
  deployment: `${DOCS}/DEPLOYMENT.md`,
  source: "https://github.com/ksp-gonogo/gonogo",
  uplinkDocs: "https://ksp-gonogo.github.io/uplink-dev-docs/",
} as const;

/** True on a Windows browser, where the log check is `findstr` rather than `grep` and a command is written for PowerShell. */
export function isWindows(): boolean {
  return /Windows/.test(globalThis.navigator?.userAgent ?? "");
}

/** The shell this browser's operating system opens by default. */
export function browserShell(): CommandShell {
  return isWindows() ? "powershell" : "posix";
}
