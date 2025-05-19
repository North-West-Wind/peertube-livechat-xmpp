import { Element } from "@xmpp/xml";
import EventEmitter from "events";

export abstract class Manager<K, V> extends EventEmitter {
	protected map = new Map<K, V>();

	abstract handle(stanza: Element): void;

	set(key: K, value: V) {
		this.map.set(key, value);
	}

	get(key: K) {
		return this.map.get(key);
	}
}