import { Client, client, Options } from "@xmpp/client";
import { JID } from "@xmpp/jid";
import xml, { Element } from "@xmpp/xml";
import { EventEmitter } from "events";

import { PeerTubeAuthenticator } from "./auth";
import { Message, MessageManager, MessageMention } from "./manager/message";
import { User, UserManager } from "./manager/user";

export interface PeerTubeXMPPClient {
	once(event: `result:${string}`, listener: (stanza: Element) => void): this;
	on(event: "ready", listener: () => void): this;
	on(event: "oldMessage", listener: (message: Message) => void): this;
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

export type PeerTubeData = {
	peertubeVideoOriginalUrl: string;
	peertubeVideoUUID: string;
	staticBaseUrl: string;
	assetsPath: string;
	isRemoteChat: boolean;
	localAnonymousJID: string;
	remoteAnonymousJID: string | null;
	remoteAnonymousXMPPServer: boolean;
	remoteAuthenticatedXMPPServer: boolean;
	room: string;
	localBoshServiceUrl: string;
	localWebsocketServiceUrl: string;
	remoteBoshServiceUrl: string | null;
	remoteWebsocketServiceUrl: string | null;
	authenticationUrl: string;
	autoViewerMode: boolean;
	theme: string;
	forceReadonly: boolean;
	transparent: boolean;
	forceDefaultHideMucParticipants: boolean;
	customEmojisUrl: string;
}

export class PeerTubeXMPPClient extends EventEmitter {
	instance: string;
	roomId: string;
	isAnonymous: boolean;
	// Runtime properties
	xmpp!: Client;
	data!: PeerTubeData;
	jid!: JID;
	waiting = new Set<string>(); // request ids waiting for responses
	ready = false;
	customEmojis = new Map<string, string>(); // short name -> url
	users = new UserManager();
	messages = new MessageManager();
	private randomUUID?: () => string;

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
		this.data = JSON.parse(match[1]);
		const { localAnonymousJID, localWebsocketServiceUrl, authenticationUrl, customEmojisUrl } = this.data;

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
					this.users.handle(stanza, this);
					break;
				}
				case "message": {
					this.messages.handle(stanza, this);
					break;
				}
			}
		});

		// Wrap manager events
		this.users.on("presence", (oldUser, newUser) => this.emit("presence", oldUser, newUser));
		this.messages.on("oldMessage", message => this.emit("oldMessage", message));
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
			{ from: this.jid, to: this.data.room + "/" + nickname },
			xml("x", { xmlns: "http://jabber.org/protocol/muc" })
		));
		const affRole = res.getChild("x")?.getChild("item");
		const user: User = {
			client: this,
			jid: this.jid,
			occupantId: res.getChild("occupant-id")?.getAttr("id"),
			nickname: (res.getAttr("from") as string).split("/").pop()!,
			affiliation: affRole?.getAttr("affiliation"),
			role: affRole?.getAttr("role"),
			online: true
		};
		this.users.self = user;
		// Ping the server every 40 seconds
		setInterval(() => this.ping(), 40000);
	}

	async stop() {
		await this.xmpp.stop();
		this.ready = false;
	}

	/**
	 * Sends and wait for a response by applying an ID
	 * @param element An XML element to send to the XMPP websocket
	 * @returns A response to the request
	 */
	private async send(element: Element) {
		const id = Math.random().toString(36).substring(2, 10);
		this.waiting.add(id);

		const waitForResult = new Promise<Element>(res => {
			this.once(`result:${id}`, res);
		});
		await this.xmpp.send(element.attr("id", id));
		return await waitForResult;
	}

	/**
	 * Sends a ping iq to the server to keep alive
	 */
	private async ping() {
		// Ping server
		await this.send(xml(
			"iq",
			{ from: this.jid, to: this.isAnonymous ? this.data.localAnonymousJID : this.instance, type: "get" },
			xml("ping", { xmlns: "urn:xmpp:ping" })
		));
		// Ping account
		await this.send(xml(
			"iq",
			{ to: this.data.room + "/" + this.users.self?.nickname, type: "get" },
			xml("ping", { xmlns: "urn:xmpp:ping" })
		));
	}

	/**
	 * Sends a message to the group chat
	 * To mention a user, put @{uri-encoded-nickname} in body
	 * @param body The body to send to the group chat
	 * @returns The message sent
	 */
	async message(body: string) {
		// Extract mentions from body
		const mentions: MessageMention[] = [];
		const mentionables = new Set<string>();
		for (const user of this.users.values())
			mentionables.add(encodeURIComponent(user.nickname));

		let index = body.indexOf("@");
		while (index >= 0) {
			const word = body.slice(index).split(/\s+/)[0];
			const name = word.slice(1);
			const decoded = decodeURIComponent(name);
			if (mentionables.has(name)) {
				mentions.push({
					uri: `xmpp:${this.data.room}/${name}`,
					begin: index,
					end: index + decoded.length,
					nickname: decoded,
				});
				body = body.replace(word, decoded);
			}
			index = body.indexOf("@", index + 1);
		}
		// Send message, including mentions
		if (!this.randomUUID) {
			if (typeof window == "undefined") this.randomUUID = (await import("crypto")).randomUUID; // node
			else this.randomUUID = crypto.randomUUID; // browser
		}
		const nodes = [xml("body", {}, body), xml("origin-id", { id: this.randomUUID(), xmlns: 'urn:xmpp:sid:0' })];
		mentions.forEach(mention => nodes.push(xml("reference", {
			uri: mention.uri,
			begin: mention.begin.toString(),
			end: mention.end.toString(),
			type: "mention",
			xmlns: "urn:xmpp:reference:0"
		})));
		const result = await this.send(xml(
			"message",
			{ from: this.jid, to: this.data.room, type: "groupchat" },
			...nodes
		));
		const error = result.getChild("error");
		if (error) throw new Error(error.getChildText("text") || "Unknown error");
		return this.messages.parse(result, this).message as Message;
	}

	/**
	 * Deletes a message
	 * @param msgId The origin ID of the message to be deleted
	 */
	async delete(msgId: string) {
		const result = await this.send(xml(
			"message",
			{ to: this.data.room, type: "groupchat" },
			xml("store", { xmlns: "urn:xmpp:hints" }),
			xml(
				"apply-to",
				{ id: msgId, xmlns: "urn:xmpp:fasten:0" },
				xml("retract", { xmlns: "urn:xmpp:message-retract:0" })
			),
		));
		const error = result.getChild("error");
		if (error) throw new Error(error.getChildText("text") || "Unknown error");
	}
}