/**
 * Like Omit, but works on unions which don't all include the
 * specified properties. Helpful when not every message
 * conforms to the same structure.
 *
 * @example
 * ```ts
 * type Message = { id: string; type: 'request' } | { type: 'ping' };
 * type MessageWithoutId = OmitMessageProperty<Message, 'id'>;
 * // Result: { type: 'request' } | { type: 'ping' }
 * ```
 */
export type OmitMessageProperty<TMessage, K extends keyof any> =
	TMessage extends any ? Omit<TMessage, K> : never;
