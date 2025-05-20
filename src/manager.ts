import { Element } from "@xmpp/xml";
import EventEmitter from "events";

/**
 * Manager is a way to store an immutable map
 * It simply does not provide functions for modifying the map
 */
export abstract class Manager<K, V> extends EventEmitter {
	protected map = new Map<K, V>();

	abstract handle(stanza: Element): void;

	protected set(key: K, value: V) {
		this.map.set(key, value);
	}

	get(key: K) {
		return this.map.get(key);
	}

	keys() {
		return this.map.keys();
	}

	values() {
		return this.map.values();
	}

	entries() {
		return this.map.entries();
	}
}