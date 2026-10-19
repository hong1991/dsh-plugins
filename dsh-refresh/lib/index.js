/**
 * dsh-refresh, node half.
 *
 * The refresh surface is a browser feature, but one Host fact is needed for the
 * in-place mode: the current client-plugin graph. The graph is owned by
 * `clientModules`, so this half exposes it at a small read-only route and lets
 * the browser hand it to the module system's own `entries.sync()` — the same
 * reconciliation path the HMR transport uses.
 *
 * The route is deliberately document-relative on the client side
 * (`dsh-refresh/graph`) so it resolves under whichever mount served the page.
 * It carries no secrets: the graph lists plugin ids, bundle URLs, revisions,
 * and the Host release, all of which the page already received in its boot
 * manifest.
 *
 * @module dsh-refresh
 */

/** Exact route carrying the live client-plugin graph. */
const GRAPH_ROUTE = "/dsh-refresh/graph";

/** Required Host services: the graph owner and the route registry. */
const inject = ["clientModules", "webServer"];

/**
 * Host plugin body: publish the live client-plugin graph for the browser half.
 * @param ctx - Host context with `clientModules` and `webServer`.
 */
function apply(ctx) {
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: "exact",
				path: GRAPH_ROUTE,
				handler: (req, res) => {
					if (req.method !== "GET" && req.method !== "HEAD") {
						res.writeHead(405, { allow: "GET, HEAD" });
						res.end();
						return;
					}
					try {
						const body = JSON.stringify({ graph: ctx.clientModules.graph() });
						res.writeHead(200, {
							"content-type": "application/json; charset=utf-8",
							"cache-control": "no-store"
						});
						res.end(req.method === "HEAD" ? undefined : body);
					} catch (error) {
						ctx.logger.warn(error);
						res.writeHead(500, {
							"content-type": "application/json; charset=utf-8",
							"cache-control": "no-store"
						});
						res.end(req.method === "HEAD" ? undefined : JSON.stringify({ error: "graph-unavailable" }));
					}
				}
			}),
		"dsh-refresh: graph route"
	);
}

export { apply, inject };
