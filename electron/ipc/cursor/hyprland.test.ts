import { describe, expect, it } from "vitest";
import { startHyprlandClickCapture } from "./hyprland";

describe("startHyprlandClickCapture", () => {
	it("parses only this process's click events", async () => {
		// Outside Hyprland the capture must be a no-op.
		if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
			expect(await startHyprlandClickCapture(() => {}, () => {})).toBeNull();
			return;
		}
		const stop = await startHyprlandClickCapture(() => {}, () => {});
		expect(stop).toBeTypeOf("function");
		stop?.();
	});
});
