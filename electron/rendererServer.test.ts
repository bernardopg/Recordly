import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { ensurePackagedRendererServer } from "./rendererServer";

describe("ensurePackagedRendererServer", () => {
	it("falls back to a random port when the stable one is taken", async () => {
		const blocker = createServer();
		await new Promise<void>((resolve) => blocker.listen(43823, "127.0.0.1", resolve));
		try {
			const url = await ensurePackagedRendererServer(__dirname);
			expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
			expect(url).not.toBe("http://127.0.0.1:43823");
		} finally {
			blocker.close();
		}
	});
});
