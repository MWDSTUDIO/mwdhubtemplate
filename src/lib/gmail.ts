import "server-only";
import { randomUUID } from "crypto";

/**
 * The house's sending box — Gmail API through OAuth, from Estelle's
 * own mailbox (notifications brief §2 bis). No SMTP, no app password:
 * a refresh token held in the environment, never in the repository.
 *
 * Required variables (all outside the repo):
 *   GMAIL_CLIENT_ID      — the OAuth client
 *   GMAIL_CLIENT_SECRET
 *   GMAIL_REFRESH_TOKEN  — scope https://www.googleapis.com/auth/gmail.send
 *   GMAIL_SENDER         — the house's address (hello@…)
 */

export function gmailReady(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN &&
      process.env.GMAIL_SENDER
  );
}

async function accessToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: "refresh_token"
    })
  });
  const j = (await r.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) {
    // A revoked token is exactly the failure the brief insists must
    // surface — the caller records it and raises it to the house.
    throw new Error(`gmail token: ${j.error ?? r.status} ${j.error_description ?? ""}`.trim());
  }
  return j.access_token;
}

/** RFC 2047 word-encoding for headers that may carry accents or kanji. */
function encodeHeaderWord(s: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface GmailSendInput {
  to: string[];
  subject: string;
  text: string;
  /** The hand that follows the wedding — shown before the house address. */
  senderName?: string;
  /** Replies must land with a human (brief §2 bis d). */
  replyTo?: string;
  /** Successive reminders of one instalment join the same thread (§2 bis e). */
  inReplyTo?: string;
  references?: string[];
  threadId?: string;
}

export type GmailSendResult =
  | { ok: true; id: string; threadId: string; messageId: string }
  | { ok: false; error: string };

export async function sendGmail(input: GmailSendInput): Promise<GmailSendResult> {
  if (!gmailReady()) return { ok: false, error: "gmail not configured" };
  const sender = process.env.GMAIL_SENDER!;
  const domain = sender.split("@")[1] ?? "mail";
  const messageId = `<${randomUUID()}@${domain}>`;

  const from = input.senderName
    ? `${encodeHeaderWord(input.senderName)} <${sender}>`
    : sender;

  const headers: string[] = [
    `From: ${from}`,
    `To: ${input.to.join(", ")}`,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64"
  ];
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references?.length) headers.push(`References: ${input.references.join(" ")}`);

  const body = Buffer.from(input.text, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  const raw = base64url(Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8"));

  try {
    const token = await accessToken();
    const r = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(input.threadId ? { raw, threadId: input.threadId } : { raw })
      }
    );
    const j = (await r.json()) as { id?: string; threadId?: string; error?: { message?: string } };
    if (!r.ok || !j.id) {
      return { ok: false, error: j.error?.message ?? `gmail send: ${r.status}` };
    }
    return { ok: true, id: j.id, threadId: j.threadId ?? "", messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "gmail send failed" };
  }
}
