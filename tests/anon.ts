import { PeerTubeXMPPClient } from "../src";

const INSTANCE_URL = "peertube.wtf";
const ADDRESS = "7f85efe2-07bb-4e93-9008-c6e20efbbf08";

const client = new PeerTubeXMPPClient(INSTANCE_URL, ADDRESS);
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
		console.log(client.users.get(message.authorId)?.jid);
	}
});

client.on("presence", (oldUser, newUser) => {
	console.log(newUser.nickname, oldUser, newUser);
	if (newUser.online && (!oldUser || !oldUser.online)) {
		console.log(newUser.nickname + " is now online");
	} else if (oldUser?.online && !newUser.online) {
		console.log(oldUser.nickname + " is now offline");
	} else {
		console.log(`${newUser.nickname}: ${newUser.affiliation}, ${newUser.role}`);
	}
});