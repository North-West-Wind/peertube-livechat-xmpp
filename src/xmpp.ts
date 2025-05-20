import { Client, client, Options } from "@xmpp/client";
import { JID } from "@xmpp/jid";
import xml, { Element } from "@xmpp/xml";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import fetch from "node-fetch";

import { PeerTubeAuthenticator } from "./auth";
import { Message, MessageManager } from "./manager/message";
import { User, UserManager } from "./manager/user";

export interface PeerTubeXMPPClient {
	once(event: `result:${string}`, listener: (stanza: Element) => void): this;
	on(event: "ready", listener: () => void): this;
	on(event: "message", listener: (message: Message) => void): this;
	on(event: "presence", listener: (oldUser: User | undefined, newUser: User) => void): this;
}

export type PeerTubeXMPPClientOptions = {
	/**
	 * PeerTube account refresh token. Has higher priority over credentials
	 */
	refreshToken?: string;
	/**
	 * PeerTube account login details
	 */
	credentials?: { username: string, password: string };
	/**
	 * Explicit nickname
	 */
	nickname?: string;
	/**
	 * Use the insecure protocol (http://)
	 */
	httpOnly?: boolean;
	/**
	 * The file path to write the new refresh token to
	 */
	refreshTokenFile?: string;
}

export class PeerTubeXMPPClient extends EventEmitter {
	instance: string;
	roomId: string;
	isAnonymous: boolean;
	// Runtime properties
	xmpp!: Client;
	roomAddress!: string;
	jid!: JID;
	waiting = new Set<string>(); // request ids waiting for responses
	ready = false;
	customEmojis = new Map<string, string>(); // short name -> url
	users = new UserManager();
	messages = new MessageManager();

	/**
	 * Creates a PeerTubeXMPPClient instance, which handles a bunch of interaction with PeerTube chat
	 * @param instance PeerTube instance URL without protocol
	 * @param roomId UUID of the chat room
	 * @param options Additional options
	 */
	constructor(instance: string, roomId: string, options?: PeerTubeXMPPClientOptions) {
		super();
		this.instance = instance;
		this.roomId = roomId;
		// Store state of anonymous
		this.isAnonymous = !options?.refreshToken && !options?.credentials;
		// Some function calls require async, so init is deferred
		this.init(options);
	}

	private async init(options?: PeerTubeXMPPClientOptions) {
		// Extract data from the chat room HTML
		let res = await fetch(`${options?.httpOnly ? "http" : "https"}://${this.instance}/plugins/livechat/router/webchat/room/${this.roomId}`);
		if (!res.ok) throw new Error("Failed to get chat room. " + res.status);
		const html = await res.text();
		const match = html.match(/initConverse\(\s*({.*}),/);
		if (!match || !match[1]) throw new Error("Failed to extract data from chat room");
		const { localAnonymousJID, localWebsocketServiceUrl, authenticationUrl, customEmojisUrl, room } = JSON.parse(match[1]);
		this.roomAddress = room;

		const xmppOptions: Options = {
			service: `${options?.httpOnly ? "ws" : "wss"}://${this.instance}${localWebsocketServiceUrl}`,
			domain: this.isAnonymous ? localAnonymousJID : this.instance
		};

		let nickname: string | undefined;
		// Login using PeerTube livechat auth
		let accessToken: string | undefined;
		let tokenType: string | undefined;
		if (options?.refreshToken || options?.credentials) {
			const auth = new PeerTubeAuthenticator(this.instance, options.httpOnly ? "http" : "https", (options.refreshToken ?? options.credentials)!, options.refreshTokenFile);
			const result = await auth.getAccessToken();
			accessToken = result.accessToken;
			tokenType = result.tokenType;
		}

		if (accessToken && tokenType) {
			res = await fetch(authenticationUrl, { headers: { authorization: `${tokenType} ${accessToken}` } });
			if (!res.ok) throw new Error("Failed to authorize using the access token. " + res.status);
			const auth = await res.json();
			// Trim domain from JID
			xmppOptions.username = (auth.jid as string).replace(`@${this.instance}`, "");
			xmppOptions.password = auth.password;
			nickname = auth.nickname;
		}
		
		// Create nickname from: explicit nickname > peertube nickname > random anon name
		if (options?.nickname) nickname = options.nickname;
		else if (!nickname) nickname = `Anonymous ${Math.floor(Math.random() * 10000)}`;

		// Fetch custom emojis
		res = await fetch(customEmojisUrl);
		if (!res.ok) throw new Error("Failed to fetch custom emojis. " + res.status);
		((await res.json()).customEmojis as { sn: string, url: string }[]).forEach(({ sn, url }) => {
			this.customEmojis.set(sn, url);
		});

		// Initialize the client
		this.xmpp = client(xmppOptions);
		this.xmpp.on("stanza", stanza => {
			// Check if this is a response to a waiting request
			const id = stanza.getAttr("id");
			if (this.waiting.has(id)) {
				this.waiting.delete(id);
				this.emit(`result:${id}`, stanza);
			}

			// Handle events
			switch (stanza.getName()) {
				case "presence": {
					this.users.handle(stanza);
					break;
				}
				case "message": {
					this.messages.handle(stanza);
					break;
				}
			}
		});

		// Wrap manager events
		this.users.on("presence", (oldUser, newUser) => this.emit("presence", oldUser, newUser));
		this.messages.on("message", message => this.emit("message", message));

		await this.start(nickname);
		this.ready = true;
		this.emit("ready");
	}

	/**
	 * Wrapper of xmpp.start(), but also automatically send a presence object to join the room
	 */
	private async start(nickname: string) {
		this.jid = await this.xmpp.start();
		const res = await this.send(xml(
			"presence",
			{ from: this.jid, to: this.roomAddress + "/" + nickname },
			xml("x", { xmlns: "http://jabber.org/protocol/muc" })
		));
		const affRole = res.getChild("x")?.getChild("item");
		const user: User = {
			jid: this.jid,
			occupantId: res.getChild("occupant-id")?.getAttr("id"),
			nickname: (res.getAttr("from") as string).split("/").pop()!,
			affiliation: affRole?.getAttr("affiliation"),
			role: affRole?.getAttr("role"),
			online: true
		};
		this.users.self = user;
	}

	/**
	 * Sends and wait for a response by applying an ID
	 * @param element An XML element to send to the XMPP websocket
	 * @returns A response to the request
	 */
	private async send(element: Element) {
		const id = randomUUID();
		this.waiting.add(id);

		const waitForResult = new Promise<Element>(res => {
			this.once(`result:${id}`, res);
		});
		await this.xmpp.send(element.attr("id", id));
		return await waitForResult;
	}

	async message(body: string) {
		const result = await this.send(xml(
			"message",
			{ from: this.jid, to: this.roomAddress, type: "groupchat" },
			xml("body", {}, body)
		));
		const error = result.getChild("error");
		if (error) throw new Error(error.getChildText("text") || "Unknown error");
		return this.messages.parse(result).message;
	}
}