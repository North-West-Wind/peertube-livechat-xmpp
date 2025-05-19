import "dotenv/config";
import { mkdirSync, readFileSync } from "fs";
import { PeerTubeXMPPClient } from "../src";

const INSTANCE_URL = "peertube.wtf";
const ADDRESS = "7f85efe2-07bb-4e93-9008-c6e20efbbf08";
const REFRESH_TOKEN_PATH = "runtime/rtoken.txt";

mkdirSync("runtime", { recursive: true });

/**
 * It is recommended to use a refresh token after the initial login
 * To get a refresh token, check tests/login.ts
 * 
 * Because the authenticator automatically refreshes the token,
 * we make it write the new token to runtime/rtoken.txt
 * and supply that token to the program
 */
const refreshToken = readFileSync(REFRESH_TOKEN_PATH, "utf8") || process.env.REFRESH_TOKEN;
const client = new PeerTubeXMPPClient(INSTANCE_URL, ADDRESS, { refreshToken, refreshTokenFile: REFRESH_TOKEN_PATH });
client.on("ready", async () => {
	console.log("ready!");
	console.log(client.users.self);
});

client.on("message", async message => {
	// ignore self
	if (message.authorId == client.users.self?.id) return;
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