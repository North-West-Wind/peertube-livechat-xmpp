# PeerTube Live Chat XMPP
A library for interacting with PeerTube live chat plugin using XMPP.

### This library is in early development. Things may change drastically.

## Usage
To install the pacakge:
```bash
npm i peertube-livechat-xmpp
```

To start off, import the package and create a client:
```js
import { PeerTubeXMPPClient } from "peertube-livechat-xmpp";
// ...
const client = new PeerTubeXMPPClient("your.instance.url", "room-id");
```

Clients can be initialized with options
```js
const client = new PeerTubeXMPPClient("your.instance.url", "room-id", {
	refreshToken: "refresh-token", // Refresh token of a PeerTube account. Has higher priority than credentials 
	credentials: { username: "user", password: "pass" }, // Login details of a PeerTube account
	nickname: "Nick!", // Explicit nickname. If omitted, will use the PeerTube supplied nickname or anonymous name
	httpOnly: false, // If true, will use http instead of https
	onRefresh: (accessToken, refreshToken, expiresIn) => {}, // If account is supplied, this will be called when access token is refresh
});
```

`PeerTubeXMPPClient` is an `EventEmitter` and has the following events:
- `ready`: Emitted when connection with the chat room has been established
- `message <m: Message>`: Emitted when someone sends a message
- `presence <old: User> <new: User>`: Emitted when someone's presence changes

### Examples
```js
import { PeerTubeXMPPClient } from "peertube-livechat-xmpp";

// Join a chat room as anonymous
const client = new PeerTubeXMPPClient("your.instance.url", "room-id");

// Or this

// Join a chat room as a PeerTube account
// Note: "credentials" has higher priorities than "refreshToken"
const client = new PeerTubeXMPPClient("your.instance.url", "room-id", {
	credentials: { username: "my-username", password: "1234" },
	refreshToken: "refresh-token"
});

// Wait for the client to be ready
client.on("ready", async () => {
	console.log("I. AM " + client.users.self.nickname);
	// Sends a message to the chat room
	await client.message("Hello!");
});

// When someone (including you) sends a message
client.on("message", async message => {
	// Ignore self
	if (message.authorId == client.users.self?.occupantId) return;
	// Respond to command
	if (message.body == "!ping")
		await client.message("pong!");
	else // Print who sent what
		console.log(`${message.author()?.nickname}: ${message.body}`);
});

// You will also be notified when someone's presence changes
// This allows you to compare the old user object with a new one
client.on("presence", (oldUser, newUser) => {
	if (newUser.online && (!oldUser || !oldUser.online)) {
		console.log(newUser.nickname + " is now online");
	} else if (oldUser?.online && !newUser.online) {
		console.log(oldUser.nickname + " is now offline");
	} else {
		console.log(`${newUser.nickname}: ${newUser.affiliation}, ${newUser.role}`);
	}
});
```

## Tests
Clone this repository and run `npm i` to install the required pacakges.

Run `npm test` to test anonymous user in the chat room `7b912924-07bf-4864-a2e2-16e44bdaffa8@room.peertube.wtf`. You can check the room [here](https://peertube.wtf/plugins/livechat/router/webchat/room/7f85efe2-07bb-4e93-9008-c6e20efbbf08)

If you supply a `USERNAME` and `PASSWORD` (PeerTube account credentials) in `.env` (you'll need to create this), you can even try the non-anonymous version.

You will need to get the refresh token by running the login script `npx tsx tests/login.ts`. Copy the output refresh token to `.env` as `REFRESH_TOKEN`. Run the account script `npx tsx tests/account.ts`.