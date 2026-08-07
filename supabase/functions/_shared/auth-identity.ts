// supabase/functions/_shared/auth-identity.ts
//
// Identity must come from the verified Bearer JWT, never from a client-supplied
// body field. Used by lamplight-generate to replace the spoofable body.user_id.

export interface AuthClient {
  auth: {
    getUser(token: string): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}

export function bearerToken(req: { headers: { get(name: string): string | null } }): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
}

export async function deriveUserId(client: AuthClient, token: string): Promise<string | null> {
  if (!token) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
