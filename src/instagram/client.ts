import type { AppConfig } from "../config.js";
import { extractMetaError, getApiRoot, maskToken } from "../config.js";

export class InstagramApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "InstagramApiError";
    this.status = status;
    this.body = body;
  }
}

export type AuthDebugResult = {
  requested_host: string;
  api_root: string;
  account_id: string;
  request_path: string;
  auth_method: "access_token_query_param";
  http_status: number;
  ok: boolean;
  meta_error: ReturnType<typeof extractMetaError>;
  token_length: number;
  token_preview: string;
  profile_summary?: {
    id?: string;
    user_id?: string;
    username?: string;
  };
  hint?: string;
};

export type TokenExchangeResult = {
  ok: boolean;
  http_status: number;
  token_type?: string;
  expires_in?: number;
  /** Present only on success so the operator can update INSTAGRAM_ACCESS_TOKEN. */
  long_lived_access_token?: string;
  token_length?: number;
  token_preview?: string;
  meta_error: ReturnType<typeof extractMetaError>;
  message: string;
};

export class InstagramClient {
  private readonly apiRoot: string;
  private readonly graphApiBase: string;
  private readonly accessToken: string;
  private readonly accountId: string;
  private readonly appSecret: string | undefined;

  constructor(config: AppConfig) {
    this.apiRoot = getApiRoot(config);
    this.graphApiBase = config.graphApiBase;
    this.accessToken = config.accessToken;
    this.accountId = config.accountId;
    this.appSecret = config.appSecret;
  }

  getAccountId(): string {
    return this.accountId;
  }

  getGraphApiBase(): string {
    return this.graphApiBase;
  }

  getApiRoot(): string {
    return this.apiRoot;
  }

  getTokenFingerprint(): ReturnType<typeof maskToken> {
    return maskToken(this.accessToken);
  }

  async getProfile(fields?: string): Promise<unknown> {
    const selectedFields =
      fields ??
      [
        "id",
        "username",
        "name",
        "biography",
        "website",
        "followers_count",
        "follows_count",
        "media_count",
        "profile_picture_url",
        "account_type",
      ].join(",");

    return this.get(`/${this.accountId}`, { fields: selectedFields });
  }

  /**
   * Simplest Instagram Login identity check:
   * GET /me?fields=user_id,username
   */
  async getMe(): Promise<unknown> {
    return this.get(`/me`, { fields: "user_id,username" });
  }

  async listMedia(options: {
    limit?: number;
    after?: string;
    fields?: string;
  }): Promise<unknown> {
    const fields =
      options.fields ??
      [
        "id",
        "caption",
        "media_type",
        "media_product_type",
        "media_url",
        "thumbnail_url",
        "permalink",
        "timestamp",
        "like_count",
        "comments_count",
        "username",
      ].join(",");

    const params: Record<string, string> = { fields };
    if (options.limit !== undefined) {
      params.limit = String(options.limit);
    }
    if (options.after) {
      params.after = options.after;
    }

    return this.get(`/${this.accountId}/media`, params);
  }

  async getMedia(mediaId: string, fields?: string): Promise<unknown> {
    const selectedFields =
      fields ??
      [
        "id",
        "caption",
        "media_type",
        "media_product_type",
        "media_url",
        "thumbnail_url",
        "permalink",
        "timestamp",
        "like_count",
        "comments_count",
        "username",
        "owner",
        "children{id,media_type,media_url,thumbnail_url,permalink}",
      ].join(",");

    return this.get(`/${mediaId}`, { fields: selectedFields });
  }

  async getAccountInsights(options: {
    metrics: string;
    period?: string;
    metricType?: string;
    timeframe?: string;
    breakdown?: string;
    since?: string;
    until?: string;
  }): Promise<unknown> {
    const params: Record<string, string> = {
      metric: options.metrics,
    };

    if (options.period) params.period = options.period;
    if (options.metricType) params.metric_type = options.metricType;
    if (options.timeframe) params.timeframe = options.timeframe;
    if (options.breakdown) params.breakdown = options.breakdown;
    if (options.since) params.since = options.since;
    if (options.until) params.until = options.until;

    return this.get(`/${this.accountId}/insights`, params);
  }

  async getMediaInsights(
    mediaId: string,
    options: {
      metrics: string;
      period?: string;
      breakdown?: string;
    },
  ): Promise<unknown> {
    const params: Record<string, string> = {
      metric: options.metrics,
    };
    if (options.period) params.period = options.period;
    if (options.breakdown) params.breakdown = options.breakdown;

    return this.get(`/${mediaId}/insights`, params);
  }

  async getComments(
    mediaId: string,
    options: {
      limit?: number;
      after?: string;
      fields?: string;
    },
  ): Promise<unknown> {
    const fields =
      options.fields ??
      [
        "id",
        "text",
        "timestamp",
        "username",
        "like_count",
        "replies{id,text,timestamp,username,like_count}",
      ].join(",");

    const params: Record<string, string> = { fields };
    if (options.limit !== undefined) {
      params.limit = String(options.limit);
    }
    if (options.after) {
      params.after = options.after;
    }

    return this.get(`/${mediaId}/comments`, params);
  }

  /**
   * Safe auth probe: calls GET /me and returns diagnostics without the raw token.
   */
  async debugAuth(): Promise<AuthDebugResult> {
    const fingerprint = maskToken(this.accessToken);
    const requestPath = "/me";
    const host = new URL(this.graphApiBase).host;

    const { response, body } = await this.requestJson(requestPath, {
      fields: "user_id,username",
    });

    const metaError = extractMetaError(body);
    const result: AuthDebugResult = {
      requested_host: host,
      api_root: this.apiRoot,
      account_id: this.accountId,
      request_path: requestPath,
      auth_method: "access_token_query_param",
      http_status: response.status,
      ok: response.ok,
      meta_error: metaError,
      token_length: fingerprint.token_length,
      token_preview: fingerprint.token_preview,
    };

    if (response.ok && body && typeof body === "object") {
      const profile = body as Record<string, unknown>;
      result.profile_summary = {
        id: typeof profile.id === "string" ? profile.id : undefined,
        user_id:
          typeof profile.user_id === "string"
            ? profile.user_id
            : typeof profile.user_id === "number"
              ? String(profile.user_id)
              : undefined,
        username:
          typeof profile.username === "string" ? profile.username : undefined,
      };
    } else {
      result.hint = buildAuthHint(metaError, this.graphApiBase, fingerprint.token_length);
    }

    return result;
  }

  /**
   * Exchange a short-lived Instagram User token (≈1 hour) for a long-lived
   * token (≈60 days). Requires INSTAGRAM_APP_SECRET.
   *
   * App Dashboard "Generate token" tokens are already long-lived.
   * Tokens from the OAuth / Business Login code exchange are short-lived
   * and must be exchanged via this flow before production use.
   *
   * Official: GET https://graph.instagram.com/access_token
   *   ?grant_type=ig_exchange_token
   *   &client_secret=APP_SECRET
   *   &access_token=SHORT_LIVED_TOKEN
   */
  async exchangeForLongLivedToken(): Promise<TokenExchangeResult> {
    if (!this.appSecret) {
      return {
        ok: false,
        http_status: 0,
        meta_error: null,
        message:
          "INSTAGRAM_APP_SECRET is not set. Add your Instagram app secret to exchange a short-lived token.",
      };
    }

    // Token exchange host is always graph.instagram.com (Instagram Login).
    const url = new URL("https://graph.instagram.com/access_token");
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", this.appSecret);
    url.searchParams.set("access_token", this.accessToken);

    const response = await fetch(url);
    const body: unknown = await response.json().catch(() => null);
    const metaError = extractMetaError(body);

    if (!response.ok) {
      return {
        ok: false,
        http_status: response.status,
        meta_error: metaError,
        message:
          metaError?.message ??
          `Token exchange failed with HTTP ${response.status}`,
      };
    }

    const payload = body as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
    };

    if (!payload.access_token) {
      return {
        ok: false,
        http_status: response.status,
        meta_error: metaError,
        message: "Token exchange response did not include access_token",
      };
    }

    const fingerprint = maskToken(payload.access_token);
    return {
      ok: true,
      http_status: response.status,
      token_type: payload.token_type,
      expires_in: payload.expires_in,
      long_lived_access_token: payload.access_token,
      token_length: fingerprint.token_length,
      token_preview: fingerprint.token_preview,
      meta_error: null,
      message:
        "Exchange succeeded. Copy long_lived_access_token into INSTAGRAM_ACCESS_TOKEN on Vercel, then remove this response. Do not commit the token.",
    };
  }

  private async get(
    path: string,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const { response, body } = await this.requestJson(path, params);

    if (!response.ok) {
      const message =
        extractMetaError(body)?.message ?? `Instagram API HTTP ${response.status}`;
      throw new InstagramApiError(message, response.status, body);
    }

    return body;
  }

  /**
   * Attach the token as Meta's documented `access_token` query parameter.
   * Never put the token into thrown Error messages or logs.
   */
  private async requestJson(
    path: string,
    params: Record<string, string> = {},
  ): Promise<{ response: Response; body: unknown }> {
    const url = new URL(`${this.apiRoot}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("access_token", this.accessToken);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const body: unknown = await response.json().catch(() => null);
    return { response, body };
  }
}

function buildAuthHint(
  metaError: ReturnType<typeof extractMetaError>,
  graphApiBase: string,
  tokenLength: number,
): string {
  const parts: string[] = [];

  if (metaError?.code === 190) {
    parts.push(
      "OAuthException 190 usually means the token string is malformed, expired, revoked, or for the wrong API host.",
    );
    parts.push(
      "If the token came from OAuth / Business Login (not App Dashboard Generate token), exchange it for a long-lived token via POST /exchange-instagram-token with INSTAGRAM_APP_SECRET set.",
    );
  }

  if (tokenLength < 20) {
    parts.push(
      "Token length looks suspiciously short — check for truncation in Vercel env vars.",
    );
  }

  if (!graphApiBase.includes("graph.instagram.com")) {
    parts.push(
      "INSTAGRAM_GRAPH_API_BASE is not graph.instagram.com. Instagram Login tokens must use https://graph.instagram.com.",
    );
  }

  parts.push(
    "Re-paste INSTAGRAM_ACCESS_TOKEN without quotes or Bearer prefix; ensure no trailing newline from the Vercel UI.",
  );

  return parts.join(" ");
}
