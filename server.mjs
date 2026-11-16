import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");
const port = Number(process.env.PORT ?? 3000);
const ollamaHost = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(
  /\/+$/,
  "",
);
const trainingHost = (process.env.TRAINING_HOST ?? "http://127.0.0.1:8765").replace(
  /\/+$/,
  "",
);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 50 * 1024 * 1024) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxyToService(req, res, requestUrl, target) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["transfer-encoding"];

  const hasBody = !["GET", "HEAD"].includes(req.method ?? "GET");
  const body = hasBody ? await readBody(req) : undefined;
  if (body) headers["content-length"] = String(body.length);

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body,
    signal: abort.signal,
  });

  const responseHeaders = {
    "content-type":
      upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  };

  res.writeHead(upstream.status, responseHeaders);

  if (!upstream.body) {
    res.end();
    return;
  }

  try {
    for await (const chunk of Readable.fromWeb(upstream.body)) {
      if (!res.write(chunk)) {
        await new Promise((resolve, reject) => {
          res.once("drain", resolve);
          res.once("error", reject);
        });
      }
    }
    res.end();
  } catch (error) {
    if (!abort.signal.aborted) {
      console.error("Proxy stream failed:", error);
    }
    res.end();
  }
}

async function proxyToOllama(req, res, requestUrl) {
  const target = `${ollamaHost}${requestUrl.pathname}${requestUrl.search}`;
  await proxyToService(req, res, requestUrl, target);
}

async function proxyToTraining(req, res, requestUrl) {
  const pathname = requestUrl.pathname.replace(/^\/training/, "") || "/";
  const target = `${trainingHost}${pathname}${requestUrl.search}`;
  await proxyToService(req, res, requestUrl, target);
}

async function serveStatic(req, res, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  const resolved = path.resolve(distDir, `.${pathname}`);
  if (
    resolved !== distDir &&
    !resolved.startsWith(`${distDir}${path.sep}`)
  ) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  let filePath = resolved;
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = path.join(filePath, "index.html");
    const finalStat = await stat(filePath);
    if (!finalStat.isFile()) throw new Error("Not a file");

    const ext = path.extname(filePath).toLowerCase();
    const isHashedAsset = pathname.startsWith("/assets/");
    res.writeHead(200, {
      "content-type": mimeTypes[ext] ?? "application/octet-stream",
      "content-length": finalStat.size,
      "cache-control": isHashedAsset
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    createReadStream(filePath).pipe(res);
  } catch {
    try {
      const indexStat = await stat(path.join(distDir, "index.html"));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": indexStat.size,
        "cache-control": "no-cache",
      });
      createReadStream(path.join(distDir, "index.html")).pipe(res);
    } catch {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end("The app has not been built yet. Run `npm run build` first.");
    }
  }
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);

  try {
    if (requestUrl.pathname.startsWith("/api/")) {
      await proxyToOllama(req, res, requestUrl);
      return;
    }
    if (requestUrl.pathname === "/training" || requestUrl.pathname.startsWith("/training/")) {
      await proxyToTraining(req, res, requestUrl);
      return;
    }
    await serveStatic(req, res, requestUrl);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : "Could not reach Ollama. Is it running?",
        }),
      );
    } else {
      res.end();
    }
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`\n  Local Chat  http://localhost:${port}`);
  console.log(`  Ollama      ${ollamaHost}`);
  console.log(`  Training    ${trainingHost}\n`);
});
