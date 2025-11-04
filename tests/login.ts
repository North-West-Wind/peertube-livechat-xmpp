import "dotenv/config";

import { PeerTubeAuthenticator } from "../src";
import { writeFileSync } from "fs";

const INSTANCE = "peertube.wtf";
const ACCESS_TOKEN_PATH = "runtime/atoken.txt";
const REFRESH_TOKEN_PATH = "runtime/rtoken.txt";

/**
 * This uses an authenticator came with the library to
 * handle login and get a refresh token
 */
const auth = new PeerTubeAuthenticator(INSTANCE, "https", { username: process.env.USERNAME!, password: process.env.PASSWORD! });
auth.getAccessToken().then(({ accessToken }) => writeFileSync(ACCESS_TOKEN_PATH, accessToken));
auth.getRefreshToken().then((refreshToken) => writeFileSync(REFRESH_TOKEN_PATH, refreshToken));