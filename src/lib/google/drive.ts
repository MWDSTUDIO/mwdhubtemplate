import "server-only";

/**
 * Google Drive — one folder per client (shared / internal), under the
 * house's parent folder. Same OAuth2 refresh-token flow as Calendar.
 */

async function accessToken(): Promise<string | null> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  if (!r.ok) return null;
  return (await r.json()).access_token ?? null;
}

async function createFolder(token: string, name: string, parentId?: string) {
  const r = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined
    })
  });
  if (!r.ok) throw new Error(`drive: ${r.status}`);
  return (await r.json()).id as string;
}

/**
 * Create "<Couple>/Shared with the couple" and "<Couple>/Internal".
 * Returns null when Drive is not configured — the hub works without it.
 */
export async function createWeddingFolders(coupleDisplayName: string) {
  const token = await accessToken();
  if (!token) return null;
  const parent = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || undefined;
  const root = await createFolder(token, coupleDisplayName, parent);
  const shared = await createFolder(token, "Shared with the couple", root);
  const internal = await createFolder(token, "Internal", root);
  return { root, shared, internal };
}
