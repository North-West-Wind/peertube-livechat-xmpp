import { Element } from "@xmpp/xml";

import { Manager } from "../manager";

export type User = {
	id: string;
	nickname: string;
	affiliation: string;
	role: string;
	online: boolean;
}

export interface UserManager {
	on(event: "presence", listener: (oldUser: User | undefined, newUser: User) => void): this;
}

export class UserManager extends Manager<string, User> {
	self?: User;

	handle(stanza: Element) {
		// Parse presence stanza of others
		if ((stanza.getAttr("from") as string).split("/").pop()! == this.self?.nickname) return;
		const affRole = stanza.getChild("x")?.getChild("item");
		const user: User = {
			id: stanza.getChild("occupantId")?.getAttr("id"),
			nickname: (stanza.getAttr("from") as string).split("/").pop()!,
			affiliation: affRole?.getAttr("affiliation"),
			role: affRole?.getAttr("role"),
			online: stanza.getAttr("type") == "unavailable"
		};
		this.emit("presence", this.get(user.id), user);
		this.set(user.id, user);
	}
}