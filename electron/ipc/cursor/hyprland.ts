import net from "node:net";
import path from "node:path";

// Hyprland-only input capture. On Wayland neither uiohook (X11) nor Electron can see the
// pointer or clicks outside Recordly's own windows, but Hyprland exposes both through its
// IPC sockets: `cursorpos` for the position, and non-consuming mouse binds that emit
// `custom>>` events on socket2 for clicks.

const hyprlandDir =
	process.platform === "linux" &&
	process.env.XDG_RUNTIME_DIR &&
	process.env.HYPRLAND_INSTANCE_SIGNATURE
		? path.join(process.env.XDG_RUNTIME_DIR, "hypr", process.env.HYPRLAND_INSTANCE_SIGNATURE)
		: null;

export function isHyprlandSession() {
	return hyprlandDir !== null;
}

export function hyprlandRequest(command: string): Promise<string> {
	return new Promise((resolve, reject) => {
		if (!hyprlandDir) {
			reject(new Error("Not a Hyprland session"));
			return;
		}
		let data = "";
		const socket = net.createConnection(path.join(hyprlandDir, ".socket.sock"), () =>
			socket.end(command),
		);
		socket.setEncoding("utf8");
		socket.on("data", (chunk) => {
			data += chunk;
		});
		socket.on("end", () => resolve(data));
		socket.on("error", reject);
	});
}

export async function getHyprlandCursorPos(): Promise<{ x: number; y: number }> {
	return JSON.parse(await hyprlandRequest("j/cursorpos")) as { x: number; y: number };
}

// linux input button code -> Recordly button (1 left, 2 right, 3 middle)
const HYPRLAND_MOUSE_BUTTONS = [
	{ key: "mouse:272", button: 1 },
	{ key: "mouse:273", button: 2 },
	{ key: "mouse:274", button: 3 },
] as const;

// Lua configs (Hyprland 0.55+) reject `keyword`; older hyprlang configs have no `eval`.
async function registerClickBinds(eventPrefix: string): Promise<(() => Promise<void>) | null> {
	const luaBinds = HYPRLAND_MOUSE_BUTTONS.map(
		({ key, button }) =>
			`hl.bind("${key}", hl.dsp.event("${eventPrefix}down-${button}"), { non_consuming = true }) ` +
			`hl.bind("${key}", hl.dsp.event("${eventPrefix}up-${button}"), { non_consuming = true, release = true })`,
	).join(" ");
	if ((await hyprlandRequest(`eval ${luaBinds}`)).trim() === "ok") {
		const luaUnbinds = HYPRLAND_MOUSE_BUTTONS.map(({ key }) => `hl.unbind("${key}")`).join(" ");
		return async () => {
			await hyprlandRequest(`eval ${luaUnbinds}`);
		};
	}

	const legacyBinds = HYPRLAND_MOUSE_BUTTONS.flatMap(({ key, button }) => [
		`keyword bindn ,${key},event,${eventPrefix}down-${button}`,
		`keyword bindrn ,${key},event,${eventPrefix}up-${button}`,
	]).join(";");
	const response = await hyprlandRequest(`[[BATCH]]${legacyBinds}`);
	if (!/^(ok\s*)+$/.test(response.trim())) {
		return null;
	}
	const legacyUnbinds = HYPRLAND_MOUSE_BUTTONS.map(({ key }) => `keyword unbind ,${key}`).join(
		";",
	);
	return async () => {
		await hyprlandRequest(`[[BATCH]]${legacyUnbinds}`);
	};
}

/**
 * Registers temporary click binds and streams them to the callbacks. Resolves to a cleanup
 * function, or null when Hyprland refused the binds.
 * ponytail: unbinding removes every modifier-less bind on these buttons, so a user's own
 * plain `mouse:27x` bind is dropped until the next config reload.
 */
export async function startHyprlandClickCapture(
	onMouseDown: (button: 1 | 2 | 3) => void,
	onMouseUp: () => void,
): Promise<(() => void) | null> {
	if (!hyprlandDir) {
		return null;
	}

	const eventPrefix = `recordly-${process.pid}-`;
	const unregister = await registerClickBinds(eventPrefix);
	if (!unregister) {
		return null;
	}

	const events = net.createConnection(path.join(hyprlandDir, ".socket2.sock"));
	events.setEncoding("utf8");
	let buffered = "";
	events.on("data", (chunk: string) => {
		buffered += chunk;
		const lines = buffered.split("\n");
		buffered = lines.pop() ?? "";
		for (const line of lines) {
			const match = /^custom>>(.+)-(down|up)-([123])$/.exec(line);
			if (!match || `${match[1]}-` !== eventPrefix) continue;
			if (match[2] === "down") {
				onMouseDown(Number(match[3]) as 1 | 2 | 3);
			} else {
				onMouseUp();
			}
		}
	});
	events.on("error", (error) => {
		console.warn("[CursorTelemetry] Hyprland event socket error:", error);
	});

	return () => {
		events.destroy();
		void unregister().catch((error) => {
			console.warn("[CursorTelemetry] Failed to remove Hyprland click binds:", error);
		});
	};
}
