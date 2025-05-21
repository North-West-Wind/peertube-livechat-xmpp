export class PeerTubeAuthenticator {
	readonly oauthClientUrl: string;
	readonly loginUrl: string;
	private refreshTokenFile?: string;

	private type: "password" | "refresh_token";
	private refreshToken?: string;
	private credentials?: { username: string, password: string };

	private accessToken?: string;
	private tokenType?: string;
	private expireTimeout?: NodeJS.Timeout;

	/**
	 * Creates a PeerTubeAuthenticator object for obtaining access token
	 * @param instance PeerTube instance URL
	 * @param protocol HTTP or HTTPS
	 * @param tokenOrCredentials Refresh token or username and password
	 * @param refreshTokenFile A file to write the new refresh token to
	 */
	constructor(instance: string, protocol: "http" | "https", tokenOrCredentials: string | { username: string, password: string }, refreshTokenFile?: string) {
		this.oauthClientUrl = `${protocol}://${instance}/api/v1/oauth-clients/local`;
		this.loginUrl = `${protocol}://${instance}/api/v1/users/token`;
		this.refreshTokenFile = refreshTokenFile;

		if (typeof tokenOrCredentials == "string") {
			this.type = "refresh_token";
			this.refreshToken = tokenOrCredentials;
		} else {
			this.type = "password";
			this.credentials = tokenOrCredentials;
		}
	}

	async getAccessToken() {
		if (this.accessToken && this.tokenType)
			return { accessToken: this.accessToken, tokenType: this.tokenType };

		let res = await fetch(this.oauthClientUrl);
		if (!res.ok) throw new Error("Failed to get OAuth client details");
		const { client_id: clientId, client_secret: clientSecret } = await res.json();

		const body: Record<string, string> = {
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: this.type
		};
		if (this.type == "password") {
			body.username = this.credentials!.username;
			body.password = this.credentials!.password;
		} else {
			body.refresh_token = this.refreshToken!;
		}
		res = await fetch(this.loginUrl, { method: "POST", body: new URLSearchParams(body) });
		if (!res.ok) throw new Error("Failed to login");
		const { access_token: accessToken, refresh_token: refreshToken, token_type: tokenType, expires_in: expiresIn } = await res.json();
		// Cache access token and types
		this.accessToken = accessToken;
		this.tokenType = tokenType;
		// Schedule access token to expire
		this.expireAccessToken(expiresIn);
		// Cache refresh token and write to file
		this.refreshToken = refreshToken;
		if (this.refreshTokenFile) {
			if (typeof window === "undefined") {
				// Write file in node
				(await import("fs")).writeFile(this.refreshTokenFile, this.refreshToken || "", () => {});
			} else {
				// No FS in browser
				console.warn("refreshTokenFile specified, but environment is not node");
			}
		}
		// Convert auth method to refresh_token
		this.type = "refresh_token";
		return { accessToken, tokenType };
	}

	async getRefreshToken() {
		if (this.refreshToken) return this.refreshToken;
		await this.getAccessToken();
		return this.refreshToken!;
	}

	private expireAccessToken(seconds: number) {
		// Clear old timeout
		if (this.expireTimeout)
			clearTimeout(this.expireTimeout);
		// Create timeout to invalidate access token
		this.expireTimeout = setTimeout(() => {
			this.accessToken = undefined;
			this.tokenType = undefined;
		}, seconds * 1000);
	}
}