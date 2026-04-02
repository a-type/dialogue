import { ILogger } from './Logger.ts';
import { type ReconnectingWebsocket } from './ReconnectingWebsocket.ts';

export interface HeartbeatConfig {
	/**
	 * Provide your own "ping" message for automatic ping-pong
	 * heartbeats. You must stringify it yourself if it's JSON.
	 *
	 * @default {"{\"type\":\"ping\"}"}
	 */
	getPing?(): string;
	/**
	 * Provide your own test to check if a message is a pong.
	 * If not provided, any incoming message is considered a valid
	 * pong. This is usually sufficient (it means we're still connected).
	 */
	isPong?(message: string): boolean;
	/**
	 * How often to send pings, in milliseconds.
	 *
	 * @default 5000
	 */
	interval?: number;
	/**
	 * How long to wait for a pong before considering the connection dead, in milliseconds.
	 *
	 * @default 2000
	 */
	pongTimeout?: number;
}

export class Heartbeat {
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private lastPongAt = Date.now();

	constructor(
		private socket: ReconnectingWebsocket,
		private logger?: ILogger,
		private config: HeartbeatConfig = {},
	) {
		socket.onMessage((message) => {
			if (!(message instanceof MessageEvent)) {
				return;
			}

			if (!config.isPong) {
				this.lastPongAt = Date.now();
			} else if (config.isPong(message.data)) {
				this.lastPongAt = Date.now();
			}
		});
	}

	#getPing() {
		return this.config.getPing?.() ?? JSON.stringify({ type: 'ping' });
	}

	/**
	 * Begin a heartbeat interval.
	 */
	start = () => {
		if (this.intervalId) {
			return;
		}
		this.intervalId = setInterval(() => {
			this.ping();
		}, this.config.interval ?? 5000);
	};

	/**
	 * Manually send a ping and await a pong.
	 * Will trigger the same timeout logic as the interval
	 * if the pong is missed.
	 */
	ping = () => {
		if (this.socket.status !== 'open') {
			return;
		}
		this.socket.send(this.#getPing());
		const timeout = this.config.pongTimeout ?? 2000;
		setTimeout(() => {
			if (Date.now() - this.lastPongAt > timeout) {
				this.logger?.warn('No pong received, reconnecting socket');
				this.socket.reconnect();
			}
		}, timeout);
	};

	/**
	 * Stop the heartbeat interval.
	 */
	stop = () => {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	};
}
