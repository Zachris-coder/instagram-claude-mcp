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

export type ResolvedAccount = {
  /** App-scoped ID from /me `id` (Instagram Login). Not used for /media. */
  appScopedId?: string;
  /** Instagram professional account ID — /me `user_id` / Meta's <IG_ID>. */
  igUserId: string;
  username?: string;
  source: "me.user_id" | "env.INSTAGRAM_ACCOUNT_ID";
};

export type AuthDebugResult = {
  requested_host: string;
  api_root: string;
  env_account_id: string | null;
  resolved_ig_user_id?: string;
  app_scoped_id?: string;
  id_mismatch?: boolean;
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

export type ToolDebugResult = {
  ok: boolean;
  tool: "get_instagram_profile" | "list_instagram_media";
  requested_host: string;
  api_root: string;
  env_account_id: string | null;
  resolved_ig_user_id?: string;
  request_path: string;
  http_status: number;
  meta_error: ReturnType<typeof extractMetaError>;
  summary?: unknown;
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

const INSTAGRAM_LOGIN_PROFILE_FIELDS = [
  "id",
  "user_id",
  "username",
  "name",
  "account_type",
  "profile_picture_url",
  "followers_count",
  "follows_count",
  "media_count",
].join(",");

const FACEBOOK_LOGIN_PROFILE_FIELDS = [
  "id",
  "username",
  "name",
  "biography",
  "website",
  "followers_count",
  "follows_count",
  "media_count",
  "profile_picture_url",
].join(",");

const DEFAULT_MEDIA_FIELDS = [
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

export class InstagramClient {
  private readonly apiRoot: string;
  private readonly graphApiBase: string;
  private readonly accessToken: string;
  private readonly envAccountId: string | undefined;
  private readonly appSecret: string | undefined;
  private resolvedAccount: ResolvedAccount | undefined;

  constructor(config: AppConfig) {
    this.apiRoot = getApiRoot(config);
    this.graphApiBase = config.graphApiBase;
    this.accessToken = config.accessToken;
    this.envAccountId = config.accountId;
    this.appSecret = config.appSecret;
  }

  isInstagramLogin(): boolean {
    return this.graphApiBase.includes("graph.instagram.com");
  }

  getEnvAccountId(): string | undefined {
    return this.envAccountId;
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

  /**
   * Resolve Meta's <IG_ID> for Instagram Login.
   * Prefer /me.user_id over INSTAGRAM_ACCOUNT_ID (which is often the wrong app-scoped `id`).
   */
  async resolveAccount(): Promise<ResolvedAccount> {
    if (this.resolvedAccount) {
      return this.resolvedAccount;
    }

    if (this.isInstagramLogin()) {
      const me = (await this.get(`/me`, {
        fields: "id,user_id,username",
      })) as Record<string, unknown>;

      const userId = asStringId(me.user_id);
      if (!userId) {
        throw new InstagramApiError(
          "Instagram Login /me did not return user_id (IG professional account ID).",
          502,
          me,
        );
      }

      this.resolvedAccount = {
        appScopedId: asStringId(me.id),
        igUserId: userId,
        username: typeof me.username === "string" ? me.username : undefined,
        source: "me.user_id",
      };
      return this.resolvedAccount;
    }

    if (this.envAccountId) {
      this.resolvedAccount = {
        igUserId: this.envAccountId,
        source: "env.INSTAGRAM_ACCOUNT_ID",
      };
      return this.resolvedAccount;
    }

    throw new InstagramApiError(
      "INSTAGRAM_ACCOUNT_ID is required when not using graph.instagram.com (Instagram Login).",
      500,
      null,
    );
  }

  async getProfile(fields?: string): Promise<unknown> {
    if (this.isInstagramLogin()) {
      // Instagram Login: profile comes from /me (same path as the working auth diagnostic).
      const selectedFields = fields ?? INSTAGRAM_LOGIN_PROFILE_FIELDS;
      // Ensure user_id is present so we can cache the IG professional ID.
      const fieldsWithUserId = selectedFields.includes("user_id")
        ? selectedFields
        : `${selectedFields},user_id`;

      const profile = (await this.get(`/me`, {
        fields: fieldsWithUserId,
      })) as Record<string, unknown>;

      const userId = asStringId(profile.user_id);
      if (userId && !this.resolvedAccount) {
        this.resolvedAccount = {
          appScopedId: asStringId(profile.id),
          igUserId: userId,
          username:
            typeof profile.username === "string" ? profile.username : undefined,
          source: "me.user_id",
        };
      }

      const account = await this.resolveAccount();
      return {
        ...profile,
        ig_user_id: account.igUserId,
        resolved_from: "me",
      };
    }

    const account = await this.resolveAccount();
    const selectedFields = fields ?? FACEBOOK_LOGIN_PROFILE_FIELDS;
    return this.get(`/${account.igUserId}`, { fields: selectedFields });
  }

  async listMedia(options: {
    limit?: number;
    after?: string;
    fields?: string;
  }): Promise<unknown> {
    const account = await this.resolveAccount();
    const fields = options.fields ?? DEFAULT_MEDIA_FIELDS;

    const params: Record<string, string> = { fields };
    if (options.limit !== undefined) {
      params.limit = String(options.limit);
    }
    if (options.after) {
      params.after = options.after;
    }

    // Instagram Login docs: GET /<IG_ID>/media where IG_ID is /me.user_id
    return this.get(`/${account.igUserId}/media`, params);
  }

  async getMedia(mediaId: string, fields?: string): Promise<unknown> {
    const selectedFields =
      fields ??
      [
        DEFAULT_MEDIA_FIELDS,
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
    const account = await this.resolveAccount();
    const params: Record<string, string> = {
      metric: options.metrics,
    };

    if (options.period) params.period = options.period;
    if (options.metricType) params.metric_type = options.metricType;
    if (options.timeframe) params.timeframe = options.timeframe;
    if (options.breakdown) params.breakdown = options.breakdown;
    if (options.since) params.since = options.since;
    if (options.until) params.until = options.until;

    return this.get(`/${account.igUserId}/insights`, params);
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
      fields: "id,user_id,username",
    });

    const metaError = extractMetaError(body);
    const result: AuthDebugResult = {
      requested_host: host,
      api_root: this.apiRoot,
      env_account_id: this.envAccountId ?? null,
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
      const userId = asStringId(profile.user_id);
      const appScopedId = asStringId(profile.id);

      result.profile_summary = {
        id: appScopedId,
        user_id: userId,
        username:
          typeof profile.username === "string" ? profile.username : undefined,
      };
      result.resolved_ig_user_id = userId;
      result.app_scoped_id = appScopedId;
      result.id_mismatch = Boolean(
        this.envAccountId &&
          userId &&
          this.envAccountId !== userId &&
          this.envAccountId !== appScopedId,
      );

      if (this.envAccountId && userId && this.envAccountId === appScopedId) {
        result.hint =
          "INSTAGRAM_ACCOUNT_ID matches /me.id (app-scoped), but media/profile account paths need /me.user_id (IG professional ID). This server now resolves user_id from /me automatically.";
      }
    } else {
      result.hint = buildAuthHint(
        metaError,
        this.graphApiBase,
        fingerprint.token_length,
      );
    }

    return result;
  }

  /** Safe probe for the same path get_instagram_profile uses. */
  async debugProfile(): Promise<ToolDebugResult> {
    const host = new URL(this.graphApiBase).host;
    const requestPath = this.isInstagramLogin() ? "/me" : undefined;

    try {
      const account = this.isInstagramLogin()
        ? undefined
        : await this.resolveAccount();
      const path =
        requestPath ?? `/${account!.igUserId}`;
      const { response, body } = await this.requestJson(path, {
        fields: this.isInstagramLogin()
          ? INSTAGRAM_LOGIN_PROFILE_FIELDS
          : FACEBOOK_LOGIN_PROFILE_FIELDS,
      });

      let resolved: ResolvedAccount | undefined;
      if (response.ok) {
        resolved = await this.resolveAccount();
      }

      const metaError = extractMetaError(body);
      const profile =
        body && typeof body === "object"
          ? (body as Record<string, unknown>)
          : null;

      return {
        ok: response.ok,
        tool: "get_instagram_profile",
        requested_host: host,
        api_root: this.apiRoot,
        env_account_id: this.envAccountId ?? null,
        resolved_ig_user_id: resolved?.igUserId ?? asStringId(profile?.user_id),
        request_path: path,
        http_status: response.status,
        meta_error: metaError,
        summary: profile
          ? {
              id: asStringId(profile.id),
              user_id: asStringId(profile.user_id),
              username:
                typeof profile.username === "string"
                  ? profile.username
                  : undefined,
              name: typeof profile.name === "string" ? profile.name : undefined,
              followers_count: profile.followers_count,
              media_count: profile.media_count,
              account_type: profile.account_type,
            }
          : undefined,
        hint: response.ok
          ? undefined
          : "Profile request failed. Confirm Instagram Login host and token.",
      };
    } catch (error) {
      return toolDebugFromError("get_instagram_profile", host, this, error);
    }
  }

  /** Safe probe for the same path list_instagram_media uses. */
  async debugListMedia(limit = 5): Promise<ToolDebugResult> {
    const host = new URL(this.graphApiBase).host;

    try {
      const account = await this.resolveAccount();
      const path = `/${account.igUserId}/media`;
      const { response, body } = await this.requestJson(path, {
        fields: "id,caption,media_type,media_product_type,timestamp,permalink",
        limit: String(limit),
      });

      const metaError = extractMetaError(body);
      const data =
        body &&
        typeof body === "object" &&
        "data" in body &&
        Array.isArray((body as { data: unknown }).data)
          ? (body as { data: Array<Record<string, unknown>> }).data
          : [];

      return {
        ok: response.ok,
        tool: "list_instagram_media",
        requested_host: host,
        api_root: this.apiRoot,
        env_account_id: this.envAccountId ?? null,
        resolved_ig_user_id: account.igUserId,
        request_path: path,
        http_status: response.status,
        meta_error: metaError,
        summary: {
          returned_count: data.length,
          sample: data.slice(0, limit).map((item) => ({
            id: asStringId(item.id),
            media_type: item.media_type,
            media_product_type: item.media_product_type,
            timestamp: item.timestamp,
            caption_preview:
              typeof item.caption === "string"
                ? item.caption.slice(0, 80)
                : undefined,
          })),
        },
        hint: response.ok
          ? undefined
          : "Media list uses /{user_id}/media. If this fails but /debug-instagram-auth works, env INSTAGRAM_ACCOUNT_ID was likely the app-scoped id.",
      };
    } catch (error) {
      return toolDebugFromError("list_instagram_media", host, this, error);
    }
  }

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
        extractMetaError(body)?.message ??
        `Instagram API HTTP ${response.status}`;
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

function asStringId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function toolDebugFromError(
  tool: ToolDebugResult["tool"],
  host: string,
  client: InstagramClient,
  error: unknown,
): ToolDebugResult {
  if (error instanceof InstagramApiError) {
    return {
      ok: false,
      tool,
      requested_host: host,
      api_root: client.getApiRoot(),
      env_account_id: client.getEnvAccountId() ?? null,
      request_path: "(failed before/during request)",
      http_status: error.status,
      meta_error: extractMetaError(error.body) ?? {
        message: error.message,
      },
      hint: error.message,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    tool,
    requested_host: host,
    api_root: client.getApiRoot(),
    env_account_id: client.getEnvAccountId() ?? null,
    request_path: "(failed)",
    http_status: 0,
    meta_error: { message },
    hint: message,
  };
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

  return parts.join(" ");
}
