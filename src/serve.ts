import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { platform } from "node:os";

function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    void 0;
  }
}

export function serveReport(html: string, port: number): Promise<void> {
  const body = Buffer.from(html, "utf-8");
  const server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": body.length });
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  return new Promise((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is in use. Try: node dist/cli.js serve --port=<free port>`));
      } else {
        reject(err);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${port}/`;
      console.log(`cc-utility serving at ${url}`);
      console.log("Press Ctrl+C to stop.");
      openBrowser(url);
      const shutdown = () => { server.close(() => resolve()); };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
  });
}
