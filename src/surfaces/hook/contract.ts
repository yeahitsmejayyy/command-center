/**
 * The hook contract version.
 *
 * `hooks/hooks.json` passes the version it was written against; this file holds
 * the version the code understands. They are shipped together, so a mismatch
 * means a half-updated install — a plugin from one version talking to code from
 * another.
 *
 * The failure mode this prevents is the bad one: a hook that silently does
 * nothing, leaving someone to conclude the tool is broken with no clue why.
 * Bump this whenever the arguments, stdin shape, or output contract change.
 */
export const HOOK_CONTRACT_VERSION = 1;

export function contractMismatchMessage(declared: number): string {
  return (
    `command-center: the plugin declares hook contract v${declared}, but this code speaks v${HOOK_CONTRACT_VERSION}. ` +
    `The plugin and its code are out of step — update the plugin with \`/plugin update command-center\` ` +
    `(or reinstall it) so both sides match. The board is inactive until then.`
  );
}
