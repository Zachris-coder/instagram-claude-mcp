import type { AppConfig } from "../config.js";
import { getApiRoot } from "../config.js";

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

export class InstagramClient {
  private readonly apiRoot: string;
  private readonly accessToken: string;
  private readonly accountId: string;

  constructor(config: AppConfig) {
    this.apiRoot = getApiRoot(config);
    this.accessToken = config.accessToken;
    this.accountId = config.accountId;
  }

  getAccountId(): string {
    return this.accountId;
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

  private async get(
    path: string,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const url = new URL(`${this.apiRoot}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("access_token", this.accessToken);

    const response = await fetch(url);
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message = extractErrorMessage(body) ?? `Instagram API HTTP ${response.status}`;
      throw new InstagramApiError(message, response.status, body);
    }

    return body;
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    body.error &&
    typeof body.error === "object" &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return undefined;
}
