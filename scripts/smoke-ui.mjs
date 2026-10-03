import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const app = fileURLToPath(new URL("../packages/nextjs/", import.meta.url));
const next = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);
const port = 3107;
const server = spawn(
  process.execPath,
  [next, "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: app,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
server.stdout.on("data", (data) => {
  output = (output + data).slice(-10000);
});
server.stderr.on("data", (data) => {
  output = (output + data).slice(-10000);
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/vault`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the production server to bind. */
    }
    await delay(1000);
  }
  if (!ready) throw new Error(`Server did not become ready: ${output}`);
  for (const route of [
    "/",
    "/vault",
    "/debug",
    "/blockexplorer",
    "/proof-lab",
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      signal: AbortSignal.timeout(10000),
    });
    const html = await response.text();
    if (!response.ok || !html.includes("<html"))
      throw new Error(`${route}: invalid response ${response.status}`);
    console.log(`${route}: ${response.status}, HTML served`);
  }
} finally {
  server.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) =>
      server.exitCode !== null
        ? resolve(true)
        : server.once("exit", () => resolve(true)),
    ),
    delay(3000).then(() => false),
  ]);
  if (!exited) server.kill("SIGKILL");
}
