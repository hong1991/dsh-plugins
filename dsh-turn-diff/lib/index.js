/**
 * dsh-turn-diff, node half.
 *
 * The feature is entirely a browser surface: it reads `meta.diffs` off the Chat
 * snapshot the client already holds, so the Host needs no service, no route,
 * and no filesystem access. This half exists only because a browser plugin must
 * be reachable from an enabled Loader entry — that entry loads this module,
 * which declares nothing and injects nothing.
 *
 * The browser half ships via `exports["./client"]`, discovered through the
 * package.json `dsh.client` declaration.
 *
 * @module dsh-turn-diff
 */

/** No Host service is required. */
const inject = [];

/**
 * Host plugin body: nothing to register.
 */
function apply() {}

export { apply, inject };
