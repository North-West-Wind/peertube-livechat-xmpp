import "dotenv/config";

import { mkdirSync } from "fs";

import { PeerTubeXMPPClient } from "../src";

const INSTANCE_URL = "peertube.wtf";
const ADDRESS = "7b912924-07bf-4864-a2e2-16e44bdaffa8";

mkdirSync("runtime", { recursive: true });

/**
 * You can also use only the access token.
 * This will avoid any token refreshing.
 */
const accessToken = process.env.ACCESS_TOKEN;
const client = new PeerTubeXMPPClient(INSTANCE_URL, ADDRESS, { accessToken });
client.on("ready", async () => {
	console.log("ready!");
	console.log(client.users.self);
});

client.on("message", async message => {
	// ignore self
	if (message.authorId == client.users.self?.occupantId) return;
	// respond to command
	if (message.body == "!ping") {
		const message = await client.message("pong!");
		console.log(message);
	} else {
		console.log(message);
		console.log(`${client.users.get(message.authorId)?.nickname}: ${message.body}`);
	}
});

client.on("presence", (oldUser, newUser) => {
	if (newUser.online && (!oldUser || !oldUser.online)) {
		console.log(newUser.nickname + " is now online");
	} else if (oldUser?.online && !newUser.online) {
		console.log(oldUser.nickname + " is now offline");
	} else {
		console.log(`${newUser.nickname}: ${newUser.affiliation}, ${newUser.role}`);
	}
});

client.init();