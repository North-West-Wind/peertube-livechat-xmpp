import { PeerTubeXMPPClient } from "../src";

const INSTANCE_URL = "peertube.wtf";
const ADDRESS = "7f85efe2-07bb-4e93-9008-c6e20efbbf08";

const client = new PeerTubeXMPPClient(INSTANCE_URL, ADDRESS);
client.on("ready", async () => {
	console.log("ready!");
	console.log(client.users.self);

	// send a message that will be deleted
	const message = await client.message("To be deleted");
	//console.log(message);
	setTimeout(async () => {
		await client.delete(message.originId);
	}, 3000);
});

client.on("message", async message => {
	// ignore self
	if (message.authorId == client.users.self?.occupantId) return;

	const author = message.author();
	// respond to command
	if (message.body == "!ping") {
		const message = await client.message("pong!");
		console.log(message.originId);
	} else if (message.mentions.some(mention => mention.nickname == client.users.self?.nickname)) {
		// mentions
		await client.message(`@${encodeURIComponent(author?.nickname || "")} Hi`);
	} else {
		console.log(message.mentions);
		console.log(client.users.get(message.authorId)?.jid);
	}
});

client.on("messageRemove", message => {
	if (message)
		console.log(`Removed "${message.body}" from ${message.author()?.nickname}`);
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