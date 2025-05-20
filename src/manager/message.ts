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
	id: string;
	authorId: string;
	originId: string;
	time: number;
	body: string;
	mentions: MessageMention[];

	constructor(client: PeerTubeXMPPClient, id: string, authorId: string, originId: string, time: number, body: string, mentions: MessageMention[]) {
		this.client = client;
		this.id = id;
		this.authorId = authorId;
		this.originId = originId;
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
	NEW
}

export interface MessageManager {
	on(event: "message", listener: (message: Message) => void): this;
}

export class MessageManager extends Manager<string, Message> {
	server = "";

	parse(stanza: Element, client: PeerTubeXMPPClient): { type: ParsedType, message: Partial<Message> } {
		// Construct a Message object
		const message = new Message(
			client,
			stanza.getChild("stanza-id")?.getAttr("id"),
			stanza.getChild("occupant-id")?.getAttr("id"),
			stanza.getChild("origin-id")?.getAttr("id"),
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

		if (!message.id && message.body) return { type: ParsedType.SERVER, message };
		if (!message.id || !message.authorId || !message.originId || !message.body) return { type: ParsedType.INVALID, message };
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
			case ParsedType.OLD: {
				const msg = message as Message;
				this.set(msg.id!, msg);
				break;
			}
		}
	}
}