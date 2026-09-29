import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { ensurePackagedRendererServer } from "./rendererServer";

describe("ensurePackagedRendererServer", () => {
	it("falls back to a random port when the stable one is taken", async () => {
		const blocker = createServer();
		// If something else already holds the port, the scenario under test is already set up.
		const blockerListening = await new Promise<boolean>((resolve, reject) => {
			blocker.once("listening", () => resolve(true));
			blocker.once("error", (error: NodeJS.ErrnoException) =>
				error.code === "EADDRINUSE" ? resolve(false) : reject(error),
			);
			blocker.listen(43823, "127.0.0.1");
		});
		try {
			const url = await ensurePackagedRendererServer(__dirname);
			expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
			expect(url).not.toBe("http://127.0.0.1:43823");
		} finally {
			if (blockerListening) blocker.close();
		}
	});
});
