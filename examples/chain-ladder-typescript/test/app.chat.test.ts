import { afterAll, describe, expect, it } from "vitest";
import { request } from "node:http";
import { startAppServer, type ChatAdvisor } from "../app/server.js";

// A separate file from app.test.ts: that file boots its server with
// advisorEnabled: false, which short-circuits /api/chat to 503 before the
// busy check is ever reached, so it can never exercise CHAT_BUSY. This file
// boots its own server with a scripted ChatAdvisor (see the seam in
// app/server.ts) so a chat "turn" is under test control — no network, no key.

// A scripted advisor whose single turn pends until released, so a turn's
// duration is under test control and no network or key is involved.
let release!: () => void;
const gate = new Promise<void>((r) => (release = r));
const fakeAdvisor: ChatAdvisor = {
  stream: async () => ({
    fullStream: (async function* () {
      await gate;
    })(),
  }),
};
const app = await startAppServer({ port: 0, advisor: fakeAdvisor });
const base = `http://127.0.0.1:${app.port}`;
afterAll(() => app.close());

/** POST /api/chat flushing headers + 1 body byte now, the rest after delayMs —
 * widens the guard→body-read window the way a fragmented upload does. */
function slowChatPost(delayMs: number): Promise<number> {
  const body = JSON.stringify({ message: "hello" });
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: app.port,
        path: "/api/chat",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.write(body.slice(0, 1));
    setTimeout(() => req.end(body.slice(1)), delayMs);
  });
}

describe("chat mutual exclusion (CHAT_BUSY)", () => {
  it("admits exactly one of two overlapping chats even when bodies lag their headers", async () => {
    const a = slowChatPost(60);
    const b = slowChatPost(60);
    setTimeout(release, 250); // end the winning turn after both bodies have landed
    const statuses = (await Promise.all([a, b])).sort((x, y) => x - y);
    expect(statuses).toEqual([200, 429]);
  });

  it("releases the claim after a malformed body and after a completed turn", async () => {
    const bad = await fetch(`${base}/api/chat`, { method: "POST", body: "not json" });
    expect(bad.status).toBe(400);
    const ok = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi again" }),
    }); // gate already released, so this turn completes immediately
    expect(ok.status).toBe(200);
    await ok.text(); // drain the SSE stream
  });
});
