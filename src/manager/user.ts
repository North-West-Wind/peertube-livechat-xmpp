import jid, { JID } from "@xmpp/jid";
import { Element } from "@xmpp/xml";

import { Manager } from "../manager";
import { PeerTubeXMPPClient } from "../xmpp";

export type User = {
	client: PeerTubeXMPPClient;
	/**
	 * Jabber ID is only available when the account is an admin
	 */
	jid?: JID;
	occupantId: string;
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

	handle(stanza: Element, client: PeerTubeXMPPClient) {
		// Parse presence stanza of others
		if ((stanza.getAttr("from") as string).split("/").pop()! == this.self?.nickname) return;
		const affRole = stanza.getChild("x")?.getChild("item");
		const jidAttr = affRole?.getAttr("jid");
		const user: User = {
			client,
			jid: jidAttr ? jid.parse(affRole?.getAttr("jid")) : undefined,
			occupantId: stanza.getChild("occupant-id")?.getAttr("id"),
			nickname: (stanza.getAttr("from") as string).split("/").pop()!,
			affiliation: affRole?.getAttr("affiliation"),
			role: affRole?.getAttr("role"),
			online: stanza.getAttr("type") != "unavailable"
		};
		this.emit("presence", this.get(user.occupantId), user);
		this.set(user.occupantId, user);
	}
}