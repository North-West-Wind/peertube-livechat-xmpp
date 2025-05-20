import "dotenv/config";

import { PeerTubeAuthenticator } from "../src";

const INSTANCE = "peertube.wtf";

/**
 * This uses an authenticator came with the library to
 * handle login and get a refresh token
 */
const auth = new PeerTubeAuthenticator(INSTANCE, "https", { username: process.env.USERNAME!, password: process.env.PASSWORD! });
auth.getRefreshToken().then(console.log);