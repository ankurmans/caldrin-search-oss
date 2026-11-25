import assert from "node:assert/strict";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:4328");
assert.equal(origin.protocol, "http:");
assert.equal(origin.hostname, "127.0.0.1");

const expectedRoutes = [
  ["GET", "/", 200],
  ["GET", "/api/health", 200],
  ["GET", "/.well-known/openai-apps-challenge", 404],
  ["POST", "/api/polar-webhook", 404],
  ["GET", "/api/standalone/admin", 404],
];

for (const [method, path, status] of expectedRoutes) {
  const response = await fetch(new URL(path, origin), {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, status, `${method} ${path}`);
  if (path === "/api/health") {
    const info = await response.json();
    assert.equal(info.checks.database.status, "ok");
  }
  console.log(`${method} ${path} ${status}`);
}
