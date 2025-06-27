import { APIError, createMiddleware } from "src";
import { createEndpoint } from "../src/endpoint";
import { createRouter } from "../src/router";
import { createClient } from "../src/client-http";
import { z } from "zod";

import stream from "stream";
import uWS from "uWebSockets.js";

const hello = createEndpoint(
	"/hello",
	{
		method: "POST",
		body: z.object({
			name: z.string(),
		}),
		metadata: {
			openapi: {
				responses: {
					"200": {
						description: "Welcome Page",
						content: {
							"text/plain": {
								schema: {
									type: "string",
								},
							},
						},
					},
				},
			},
		},
	},
	async (c) => {
		c.setCookie("hello", "world");
		c.setCookie("test", "value");
		return "hello from better-call!";
	},
);

const root = createEndpoint("/", { method: "GET" }, async (c) => {
  throw c.error(403, { arbitrary: true })
  return {
    body: "Hello world"
  };
})

function createTypedAuthRoutes<T extends string>(basePath: T) {
	const signIn = createEndpoint(`${basePath}/signin` as `${T}/signin`, {
		method: "GET",
		query: z.object({
			redirect: z.string().optional(),
		}),
	}, async (ctx) => {
		return { signIn: true };
	});
	const signOut = createEndpoint(`${basePath}/signout` as `${T}/signout`, { method: "POST" }, async (ctx) => {
		return { signOut: true };
	});
	const profile = createEndpoint(`${basePath}/profile` as `${T}/profile`, { method: "GET" }, async (ctx) => {
		return { profile: true };
	})
	return { signIn, signOut, profile };
}

const router = createRouter({
	hello,
	root,
	...createTypedAuthRoutes("/auth")
});

// Bun.serve({
// 	fetch: router.handler,
// 	port: 3000,
// });

const port = 3000;

function readBody(res: uWS.HttpResponse, cb: (buffer: Buffer) => void) {
	let chunks: any[] = [];
	res.onData((ab, isLast) => {
		let chunk = Buffer.from(ab);
		if (isLast) {
			chunks.push(chunk);
			cb(Buffer.concat(chunks));
		} else {
			chunks.push(chunk);
		}
	});
}

const app = uWS.App({}).any('/*', (uwsResponse, uwsRequest) => {
	// TODO: handle aborted requests
	let aborted = false;
	uwsResponse.onAborted(() => aborted = true);

	try {
		// Construct request URL
		const url = new URL(uwsRequest.getUrl(), `http://${uwsRequest.getHeader('host')}`);
		const method = uwsRequest.getMethod();

		const headers = new Headers();
		uwsRequest.forEach((key, value) => headers.append(key, value));

    const reqInit: RequestInit = { method, headers };

    readBody(uwsResponse, async (body) => {
      if (body.byteLength > 0) { reqInit.body = body; }

      // Create Fetch API-compatible request
      const req = new Request(url.toString(), reqInit);

			try {
				const response = await router.handler(req);
				uwsResponse.cork(async () => {
					uwsResponse.writeStatus(`${response.status} ${response.statusText}`);
					response.headers.forEach((value, key) => uwsResponse.writeHeader(key, value));
					uwsResponse.end(response.body ? await response.text() : undefined);
				});

			} catch (e: any) {
				console.log(e.stack);
				const error = e as APIError;
				uwsResponse.cork(() => {
					uwsResponse.writeStatus((error.statusCode || 500).toString());
					uwsResponse.end(JSON.stringify(error.body));
				});
			}
		});

	} catch (e: any) {
		console.log(e.stack);
		uwsResponse.cork(() => {
			uwsResponse.writeStatus('500');
			uwsResponse.end();
		});
	}

}).listen(port, async (token) => {
  if (token) {
    console.log('Listening to port ' + port);

	  const http = createClient<typeof router>({ baseURL: "http://localhost:3000" });
	  // http.get("/auth/profile")

	  console.log("RESPONSE DATA:", (await http.post("/hello", { body: { name: "Hello world!" } })).data);
	  // console.log((await http.get("/auth/profile")).data)

  } else {
    console.log('Failed to listen to port ' + port);
  }
});
