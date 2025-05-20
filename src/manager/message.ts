import { Element } from "@xmpp/xml";

import { Manager } from "../manager";

export type MessageMention = {
	uri: string;
	begin: number;
	end: number;
}

export type Message = {
	id: string;
	authorId: string;
	originId: string;
	time: number;
	body: string;
	mentions: MessageMention[];
}

enum ParsedType {
	INVALID,
	SERVER,
	OLD,
	NEW
}

export interface MessageManager {
	on(event: "message", listener: (message: Message) => void): this;
}

export class MessageManager extends Manager<string, Message> {
	server = "";

	parse(stanza: Element): { type: ParsedType, message: Partial<Message> } {
		// Construct a Message object
		const message: Partial<Message> = {
			id: stanza.getChild("stanza-id")?.getAttr("id"),
			authorId: stanza.getChild("occupant-id")?.getAttr("id"),
			originId: stanza.getChild("origin-id")?.getAttr("id"),
			body: stanza.getChildText("body") || undefined,
			mentions: []
		};
		const delay = stanza.getChild("delay");
		if (delay) // Old message
			message.time = new Date(delay.getAttr("stamp")).getTime();
		else // New message
			message.time = Date.now();

		for (const reference of stanza.getChildren("reference")) {
			if (reference.getAttr("type") != "mention") continue;
			const mention: MessageMention = {
				uri: reference.getAttr("uri"),
				begin: parseInt(reference.getAttr("begin")),
				end: parseInt(reference.getAttr("end"))
			};
			message.mentions?.push(mention);
		}

		if (!message.id && message.body) return { type: ParsedType.SERVER, message };
		if (!message.id || !message.authorId || !message.originId || !message.body) return { type: ParsedType.INVALID, message };
		return { type: delay ? ParsedType.OLD : ParsedType.NEW, message };
	}

	handle(stanza: Element) {
		const { type, message } = this.parse(stanza);
		switch (type) {
			case ParsedType.SERVER:
				this.server = message.body!;
				break;
			case ParsedType.NEW:
				this.emit("message", message);
			case ParsedType.OLD: {
				const msg = message as Message;
				this.set(msg.id!, msg);
				break;
			}
		}
	}
}