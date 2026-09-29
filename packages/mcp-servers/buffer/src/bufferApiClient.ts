export interface BufferCredentials {
  accessToken: string;
  channelId: string;
}

export interface BufferChannel {
  id: string;
  displayName: string;
  service: string;
}

export interface BufferPost {
  id: string;
  status: string;
  externalLink: string | null;
}

// The real-network boundary — everything above this (postPolling.ts, server.ts)
// depends only on this interface, so polling/tool-routing logic stay unit-testable
// against a fake without a live Buffer account (CLAUDE.md: every module that touches
// external state must be testable in isolation).
export interface BufferApiClient {
  listChannels(): Promise<BufferChannel[]>;
  createThreadPost(texts: string[], dueAt: Date, imageUrl?: string): Promise<BufferPost>;
  getPost(id: string): Promise<BufferPost>;
}

export class BufferApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BufferApiError';
  }
}

const BUFFER_API_URL = 'https://api.buffer.com';

interface GraphQlResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function graphql<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(BUFFER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new BufferApiError(`Buffer API request failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as GraphQlResponse<T>;
  if (body.errors && body.errors.length > 0) {
    throw new BufferApiError(body.errors.map((e) => e.message).join('; '));
  }
  if (!body.data) {
    throw new BufferApiError('Buffer API response had no data');
  }
  return body.data;
}

// Buffer represents an X/Twitter thread via metadata.twitter.thread, where each item
// after the first replies to the one before it in order (the same contract as
// packages/mcp-servers/x's postThread, just delegated to Buffer's own send). A single
// post omits metadata entirely — Buffer has no reason to treat it as a thread.
function threadMetadata(texts: string[]): Record<string, unknown> | undefined {
  if (texts.length <= 1) return undefined;
  return { twitter: { thread: texts.map((text) => ({ text })) } };
}

export function createBufferApiClient(credentials: BufferCredentials): BufferApiClient {
  return {
    async listChannels() {
      const data = await graphql<{ account: { organizations: { id: string }[] } }>(
        credentials.accessToken,
        `query GetOrganizations { account { organizations { id } } }`,
        {},
      );
      const channels: BufferChannel[] = [];
      for (const org of data.account.organizations) {
        const orgData = await graphql<{ channels: BufferChannel[] }>(
          credentials.accessToken,
          `query GetChannels($organizationId: OrganizationId!) {
            channels(input: { organizationId: $organizationId }) { id displayName service }
          }`,
          { organizationId: org.id },
        );
        channels.push(...orgData.channels);
      }
      return channels;
    },

    async createThreadPost(texts, dueAt, imageUrl) {
      const first = texts[0];
      if (!first) throw new BufferApiError('createThreadPost: at least one post is required');

      const data = await graphql<{
        createPost:
          | { post: { id: string; status: string } }
          | { message: string };
      }>(
        credentials.accessToken,
        `mutation CreatePost($input: CreatePostInput!) {
          createPost(input: $input) {
            ... on PostActionSuccess { post { id status } }
            ... on MutationError { message }
          }
        }`,
        {
          input: {
            text: first,
            channelId: credentials.channelId,
            schedulingType: 'automatic',
            mode: 'customScheduled',
            dueAt: dueAt.toISOString(),
            metadata: threadMetadata(texts),
            // Attaches only to the first/main post — Buffer's thread metadata (above)
            // carries reply text only, with no per-reply asset slot, so an image on a
            // thread always lands on its opening tweet. Omitted (not sent as []) when
            // there is no image, for a text-only post exactly as before this field existed.
            ...(imageUrl ? { assets: [{ image: { url: imageUrl } }] } : {}),
          },
        },
      );

      if ('message' in data.createPost) {
        throw new BufferApiError(data.createPost.message);
      }
      return { ...data.createPost.post, externalLink: null };
    },

    async getPost(id) {
      const data = await graphql<{ post: BufferPost }>(
        credentials.accessToken,
        `query GetPost($id: PostId!) {
          post(input: { id: $id }) { id status externalLink }
        }`,
        { id },
      );
      return data.post;
    },
  };
}
