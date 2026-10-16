import { z } from 'zod';
import type { gmail_v1 } from 'googleapis';
import type { ToolContext, ToolDefinition, ToolResult } from '../types.js';
import { errorResponse } from '../types.js';
import { withRetry } from '../utils/retry.js';

const MESSAGE_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date'];

const SearchGmailMessagesSchema = z.object({
  query: z.string().trim().min(1, 'A Gmail search query is required').max(1000),
  maxResults: z.number().int().min(1).max(20).optional().default(10),
  pageToken: z.string().optional(),
});

const GetGmailMessageSchema = z.object({
  messageId: z.string().trim().min(1, 'messageId is required'),
  maxBodyCharacters: z.number().int().min(100).max(20000).optional().default(10000),
});

const ListGmailDraftsSchema = z.object({
  maxResults: z.number().int().min(1).max(20).optional().default(10),
  pageToken: z.string().optional(),
});

const CreateGmailDraftSchema = z.object({
  to: z.string().trim().email('to must be a valid email address'),
  subject: z.string().trim().min(1).max(250).refine(
    (value) => !/[\x00-\x1f\x7f]/.test(value),
    'subject must not contain control characters',
  ),
  bodyText: z.string().min(1).max(100000),
});

type MessageHeader = { name?: string | null; value?: string | null };
type MessagePart = {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null } | null;
  parts?: MessagePart[] | null;
};

function headerValue(headers: MessageHeader[] | undefined, name: string): string | undefined {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

function collectPartBodies(part: MessagePart | undefined, mimeType: string, bodies: string[]): void {
  if (!part || part.filename) return;
  if (part.mimeType?.toLowerCase() === mimeType && part.body?.data) {
    bodies.push(Buffer.from(part.body.data, 'base64url').toString('utf8'));
  }
  for (const child of part.parts ?? []) collectPartBodies(child, mimeType, bodies);
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|br)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractMessageBody(payload: MessagePart | undefined): string {
  const plainText: string[] = [];
  collectPartBodies(payload, 'text/plain', plainText);
  if (plainText.length > 0) return plainText.join('\n');

  const html: string[] = [];
  collectPartBodies(payload, 'text/html', html);
  return html.length > 0 ? htmlToText(html.join('\n')) : '';
}

function messageSummary(message: gmail_v1.Schema$Message) {
  const headers = message.payload?.headers as MessageHeader[] | undefined;
  return {
    messageId: message.id ?? undefined,
    threadId: message.threadId ?? undefined,
    from: headerValue(headers, 'From'),
    to: headerValue(headers, 'To'),
    cc: headerValue(headers, 'Cc'),
    subject: headerValue(headers, 'Subject'),
    date: headerValue(headers, 'Date'),
    snippet: message.snippet ?? undefined,
    labelIds: message.labelIds ?? [],
  };
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;

  const chunks: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const character of subject) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (chunkBytes + characterBytes > 42 && chunk) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks
    .map((value) => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`)
    .join('\r\n ');
}

function encodeBodyLines(body: string): string {
  const normalized = body.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  const base64 = Buffer.from(normalized, 'utf8').toString('base64');
  return base64.match(/.{1,76}/g)?.join('\r\n') ?? '';
}

async function withGmail<T>(ctx: ToolContext, action: (gmail: gmail_v1.Gmail) => Promise<T>): Promise<T> {
  const gmail = ctx.google.gmail({ version: 'v1', auth: ctx.authClient });
  return action(gmail);
}

async function getMessageMetadata(ctx: ToolContext, messageId: string): Promise<gmail_v1.Schema$Message> {
  return withGmail(ctx, async (gmail) => {
    const response = await withRetry(
      (signal) => gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: MESSAGE_HEADERS,
      }, { signal }),
      ctx.runtimeConfig,
      'gmail.users.messages.get(metadata)',
      ctx.log,
    );
    return response.data;
  });
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'searchGmailMessages',
    description: 'Search Gmail messages with Gmail search syntax. Returns message headers and snippets, not message bodies.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query, for example from:alice@example.com newer_than:7d.' },
        maxResults: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'Maximum messages to return.' },
        pageToken: { type: 'string', description: 'Page token returned by a previous search.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'getGmailMessage',
    description: 'Read one Gmail message, returning its headers and plain-text body (or text extracted from HTML when no plain-text part exists). Attachments are not downloaded.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Gmail message ID returned by searchGmailMessages.' },
        maxBodyCharacters: { type: 'integer', minimum: 100, maximum: 20000, default: 10000, description: 'Maximum body characters returned.' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'listGmailDrafts',
    description: 'List Gmail drafts with headers and snippets. This does not send, update, or delete drafts.',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'Maximum drafts to return.' },
        pageToken: { type: 'string', description: 'Page token returned by a previous draft listing.' },
      },
    },
  },
  {
    name: 'createGmailDraft',
    description: 'Create a new plain-text Gmail draft. This tool cannot send, update, or delete emails or drafts.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', format: 'email', description: 'Recipient email address.' },
        subject: { type: 'string', maxLength: 250, description: 'Draft subject. Line breaks are not allowed.' },
        bodyText: { type: 'string', maxLength: 100000, description: 'Plain-text draft body.' },
      },
      required: ['to', 'subject', 'bodyText'],
    },
  },
];

export async function handleTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  switch (toolName) {
    case 'searchGmailMessages': {
      const parsed = SearchGmailMessagesSchema.safeParse(args);
      if (!parsed.success) return errorResponse(parsed.error.errors[0].message);
      try {
        return await withGmail(ctx, async (gmail) => {
          const response = await withRetry(
            (signal) => gmail.users.messages.list({
              userId: 'me',
              q: parsed.data.query,
              maxResults: parsed.data.maxResults,
              pageToken: parsed.data.pageToken,
            }, { signal }),
            ctx.runtimeConfig,
            'gmail.users.messages.list',
            ctx.log,
          );
          const messages = await Promise.all(
            (response.data.messages ?? [])
              .filter((message): message is gmail_v1.Schema$Message & { id: string } => !!message.id)
              .map((message) => getMessageMetadata(ctx, message.id)),
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                resultSizeEstimate: response.data.resultSizeEstimate ?? 0,
                messages: messages.map(messageSummary),
                nextPageToken: response.data.nextPageToken ?? null,
              }, null, 2),
            }],
            isError: false,
          };
        });
      } catch (err) {
        return errorResponse(`Gmail search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    case 'getGmailMessage': {
      const parsed = GetGmailMessageSchema.safeParse(args);
      if (!parsed.success) return errorResponse(parsed.error.errors[0].message);
      try {
        return await withGmail(ctx, async (gmail) => {
          const response = await withRetry(
            (signal) => gmail.users.messages.get({
              userId: 'me',
              id: parsed.data.messageId,
              format: 'full',
            }, { signal }),
            ctx.runtimeConfig,
            'gmail.users.messages.get(full)',
            ctx.log,
          );
          const body = extractMessageBody(response.data.payload as MessagePart | undefined);
          const maxCharacters = parsed.data.maxBodyCharacters;
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ...messageSummary(response.data),
                bodyText: body.slice(0, maxCharacters),
                bodyTruncated: body.length > maxCharacters,
              }, null, 2),
            }],
            isError: false,
          };
        });
      } catch (err) {
        return errorResponse(`Could not read Gmail message: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    case 'listGmailDrafts': {
      const parsed = ListGmailDraftsSchema.safeParse(args);
      if (!parsed.success) return errorResponse(parsed.error.errors[0].message);
      try {
        return await withGmail(ctx, async (gmail) => {
          const response = await withRetry(
            (signal) => gmail.users.drafts.list({
              userId: 'me',
              maxResults: parsed.data.maxResults,
              pageToken: parsed.data.pageToken,
            }, { signal }),
            ctx.runtimeConfig,
            'gmail.users.drafts.list',
            ctx.log,
          );
          const drafts = await Promise.all(
            (response.data.drafts ?? [])
              .filter((draft): draft is gmail_v1.Schema$Draft & { id: string } => !!draft.id)
              .map(async (draft) => {
                const detail = await withRetry(
                  (signal) => gmail.users.drafts.get({
                    userId: 'me',
                    id: draft.id,
                    format: 'metadata',
                  }, { signal }),
                  ctx.runtimeConfig,
                  'gmail.users.drafts.get(metadata)',
                  ctx.log,
                );
                return {
                  draftId: detail.data.id ?? draft.id,
                  ...messageSummary(detail.data.message ?? {}),
                };
              }),
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                drafts,
                nextPageToken: response.data.nextPageToken ?? null,
              }, null, 2),
            }],
            isError: false,
          };
        });
      } catch (err) {
        return errorResponse(`Could not list Gmail drafts: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    case 'createGmailDraft': {
      const parsed = CreateGmailDraftSchema.safeParse(args);
      if (!parsed.success) return errorResponse(parsed.error.errors[0].message);
      try {
        const { to, subject, bodyText } = parsed.data;
        const mimeMessage = [
          `To: ${to}`,
          `Subject: ${encodeSubject(subject)}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
          '',
          encodeBodyLines(bodyText),
        ].join('\r\n');
        const raw = Buffer.from(mimeMessage, 'utf8').toString('base64url');
        return await withGmail(ctx, async (gmail) => {
          const response = await withRetry(
            (signal) => gmail.users.drafts.create({
              userId: 'me',
              requestBody: { message: { raw } },
            }, { signal }),
            { ...ctx.runtimeConfig, retryMax: 0 },
            'gmail.users.drafts.create',
            ctx.log,
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                created: true,
                draftId: response.data.id ?? null,
                messageId: response.data.message?.id ?? null,
                threadId: response.data.message?.threadId ?? null,
                to,
                subject,
              }, null, 2),
            }],
            isError: false,
          };
        });
      } catch (err) {
        return errorResponse(`Could not create Gmail draft: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    default:
      return null;
  }
}
