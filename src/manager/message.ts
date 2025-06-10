import { Element } from "@xmpp/xml";

import { Manager } from "../manager";
import { PeerTubeXMPPClient } from "../xmpp";

export type MessageMention = {
	uri: string;
	begin: number;
	end: number;
	nickname: string;
}

export class Message {
	client: PeerTubeXMPPClient;
	originId: string;
	authorId: string;
	time: number;
	body: string;
	mentions: MessageMention[];

	constructor(client: PeerTubeXMPPClient, originId: string, authorId: string, time: number, body: string, mentions: MessageMention[]) {
		this.client = client;
		this.originId = originId;
		this.authorId = authorId;
		this.time = time;
		this.body = body;
		this.mentions = mentions;
	}

	async reply(body: string) {
		const quote = this.body.split("\n").map(line => `> ${line}`).join("\n");
		const author = this.author();
		return await this.client.message(quote + "\n" + (author ? `@${encodeURIComponent(author.nickname)} `: "") + body);
	}

	author() {
		return this.client.users.get(this.authorId);
	}
}

enum ParsedType {
	INVALID,
	SERVER,
	OLD,
	NEW,
	REMOVE
}

export interface MessageManager {
	on(event: "oldMessage", listener: (message: Message) => void): this;
	on(event: "message", listener: (message: Message) => void): this;
	on(event: "messageRemove", listener: (message?: Message) => void): this;
}

export class MessageManager extends Manager<string, Message> {
	server = "";
	private list: Message[] = [];

	parse(stanza: Element, client: PeerTubeXMPPClient): { type: ParsedType, message: Partial<Message> } {
		let applied = stanza.getChild("apply-to");
		if (applied) {
			if (applied.getChild("retract")?.getAttr("xmlns") == "urn:xmpp:message-retract:0") {
				// Message retracted
				const originId = applied.getAttr("id");
				if (!originId) return { type: ParsedType.INVALID, message: {} };
				return { type: ParsedType.REMOVE, message: { originId } };
			}
			return { type: ParsedType.INVALID, message: {} };
		}
		// Construct a Message object
		const message = new Message(
			client,
			stanza.getChild("origin-id")?.getAttr("id"),
			stanza.getChild("occupant-id")?.getAttr("id"),
			0,
			stanza.getChildText("body") || "",
			[]
		);
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
				end: parseInt(reference.getAttr("end")),
				nickname: decodeURIComponent((reference.getAttr("uri") as string)?.split("/").pop() || "")
			};
			message.mentions?.push(mention);
		}

		if (!stanza.getChild("stanza-id")?.getAttr("id") && message.body) return { type: ParsedType.SERVER, message };
		if (!message.originId || !message.authorId || !message.originId || !message.body) return { type: ParsedType.INVALID, message };
		return { type: delay ? ParsedType.OLD : ParsedType.NEW, message };
	}

	handle(stanza: Element, client: PeerTubeXMPPClient) {
		const { type, message } = this.parse(stanza, client);
		switch (type) {
			case ParsedType.SERVER:
				this.server = message.body!;
				break;
			case ParsedType.NEW:
				this.emit("message", message);
				this.set(message.originId!, message as Message);
				this.list.push(message as Message);
				break;
			case ParsedType.OLD: {
				this.emit("oldMessage", message);
				this.set(message.originId!, message as Message);
				this.list.push(message as Message);
				break;
			}
			case ParsedType.REMOVE:
				this.emit("messageRemove", this.get(message.originId!));
				this.delete(message.originId!);
				const index = this.list.findIndex(msg => msg.originId == message.originId);
				if (index >= 0)
					this.list.splice(index, 1);
				break;
		}
	}

	all() {
		return Array.from(this.list);
	}
}