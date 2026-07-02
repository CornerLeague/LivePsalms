import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AuthSession } from './auth-session';
import { FakeStorageAdapter } from '@/notepad/collection/fake-storage-adapter';
import { SupabaseStorageAdapter } from '@/notepad/storage/supabase-adapter';
import type { StorageAdapter } from '@/notepad/storage/adapter';

interface AuthListener {
  (event: string, session: { user: User } | null): void;
}

class FakeSupabaseAuth {
  listeners: AuthListener[] = [];
  initialSession: { user: User } | null = null;
  signOutCalls = 0;
  signUpCalls: Array<{ email: string; password: string; fullName: string; emailRedirectTo?: string }> = [];
  resendCalls: Array<{ type: string; email: string; emailRedirectTo?: string }> = [];
  signInCalls: Array<{ email: string; password: string }> = [];
  oauthCalls: Array<{ provider: string }> = [];
  resetPasswordCalls: Array<{ email: string; redirectTo?: string }> = [];
  resetPasswordError: Error | null = null;
  updateUserCalls: Array<{ password?: string }> = [];
  updateUserError: Error | null = null;

  async getSession() {
    return { data: { session: this.initialSession }, error: null };
  }

  onAuthStateChange(listener: AuthListener) {
    this.listeners.push(listener);
    return {
      data: {
        subscription: {
          id: 'sub',
          callback: listener,
          unsubscribe: () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
          },
        },
      },
    };
  }

  async signUp(payload: { email: string; password: string; options?: { data?: { full_name?: string }; emailRedirectTo?: string } }) {
    this.signUpCalls.push({
      email: payload.email,
      password: payload.password,
      fullName: payload.options?.data?.full_name ?? '',
      emailRedirectTo: payload.options?.emailRedirectTo,
    });
    return { error: null };
  }

  async resend(payload: { type: string; email: string; options?: { emailRedirectTo?: string } }) {
    this.resendCalls.push({
      type: payload.type,
      email: payload.email,
      emailRedirectTo: payload.options?.emailRedirectTo,
    });
    return { error: null };
  }

  async signInWithPassword(payload: { email: string; password: string }) {
    this.signInCalls.push(payload);
    return { error: null };
  }

  async signInWithOAuth(payload: { provider: string }) {
    this.oauthCalls.push(payload);
    return { error: null };
  }

  async resetPasswordForEmail(email: string, options?: { redirectTo?: string }) {
    this.resetPasswordCalls.push({ email, redirectTo: options?.redirectTo });
    return { error: this.resetPasswordError };
  }

  async updateUser(attributes: { password?: string }) {
    this.updateUserCalls.push(attributes);
    return { error: this.updateUserError };
  }

  async signOut() {
    this.signOutCalls++;
    // Emulate Supabase: signOut emits a null-session event.
    this.emit('SIGNED_OUT', null);
    return { error: null };
  }

  emit(event: string, session: { user: User } | null) {
    for (const l of [...this.listeners]) l(event, session);
  }
}

function makeFakeClient(): { client: SupabaseClient; auth: FakeSupabaseAuth } {
  const auth = new FakeSupabaseAuth();
  const client = { auth } as unknown as SupabaseClient;
  return { client, auth };
}

async function flush(): Promise<void> {
  // Flush a `.then().catch().finally()` chain — yield to a macrotask.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function makeUser(id: string, email = `${id}@example.com`): User {
  return {
    id,
    email,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
  } as User;
}

class FakeOAuthProbe {
  hasParams = false;
  stripped = 0;
  hasCallbackParams() {
    return this.hasParams;
  }
  stripCallbackParams() {
    this.stripped++;
  }
}

describe('AuthSession — initial state', () => {
  let local: StorageAdapter;
  beforeEach(() => {
    local = new FakeStorageAdapter();
  });

  it('starts with localAdapter, no user, loading=true when supabase is configured', () => {
    const { client } = makeFakeClient();
    const session = new AuthSession(client, local);
    const snap = session.getSnapshot();
    expect(snap.user).toBeNull();
    expect(snap.adapter).toBe(local);
    expect(snap.loading).toBe(true);
  });

  it('starts with loading=false when supabase is null (env not configured)', () => {
    const session = new AuthSession(null, local);
    expect(session.getSnapshot().loading).toBe(false);
  });
});

describe('AuthSession — session resolution', () => {
  let local: StorageAdapter;
  beforeEach(() => {
    local = new FakeStorageAdapter();
  });

  it('init() with no existing session leaves user=null, keeps localAdapter, clears loading', async () => {
    const { client, auth } = makeFakeClient();
    auth.initialSession = null;
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    session.init();
    await flush();
    const snap = session.getSnapshot();
    expect(snap.user).toBeNull();
    expect(snap.adapter).toBe(local);
    expect(snap.loading).toBe(false);
  });

  it('init() with an existing session sets user and swaps to a SupabaseStorageAdapter', async () => {
    const { client, auth } = makeFakeClient();
    const u = makeUser('user-1');
    auth.initialSession = { user: u };
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    session.init();
    await flush();
    const snap = session.getSnapshot();
    expect(snap.user?.id).toBe('user-1');
    expect(snap.adapter).toBeInstanceOf(SupabaseStorageAdapter);
    expect(snap.loading).toBe(false);
  });

  it('skips initial getSession() when an OAuth callback is in progress, then fills in via SIGNED_IN', async () => {
    const { client, auth } = makeFakeClient();
    const probe = new FakeOAuthProbe();
    probe.hasParams = true;
    auth.initialSession = null; // getSession would return null even if we asked
    const session = new AuthSession(client, local, probe);
    session.init();
    await flush();
    // No SIGNED_IN yet → loading still true
    expect(session.getSnapshot().loading).toBe(true);
    auth.emit('SIGNED_IN', { user: makeUser('user-x') });
    expect(session.getSnapshot().user?.id).toBe('user-x');
    expect(session.getSnapshot().loading).toBe(false);
    expect(probe.stripped).toBe(1);
  });
});

describe('AuthSession — adapter lifecycle', () => {
  let local: StorageAdapter;
  beforeEach(() => {
    local = new FakeStorageAdapter();
  });

  it('reuses the SupabaseStorageAdapter across same-id auth events (no churn)', () => {
    const { client, auth } = makeFakeClient();
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    session.init();
    const u = makeUser('user-1');
    auth.emit('SIGNED_IN', { user: u });
    const first = session.getSnapshot().adapter;
    auth.emit('TOKEN_REFRESHED', { user: u });
    expect(session.getSnapshot().adapter).toBe(first);
  });

  it('creates a fresh adapter when user.id changes', () => {
    const { client, auth } = makeFakeClient();
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    session.init();
    auth.emit('SIGNED_IN', { user: makeUser('user-1') });
    const first = session.getSnapshot().adapter;
    auth.emit('SIGNED_IN', { user: makeUser('user-2') });
    const second = session.getSnapshot().adapter;
    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(SupabaseStorageAdapter);
  });

  it('signOut() flows through the listener and resets to localAdapter', async () => {
    const { client, auth } = makeFakeClient();
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    session.init();
    auth.emit('SIGNED_IN', { user: makeUser('user-1') });
    expect(session.getSnapshot().adapter).toBeInstanceOf(SupabaseStorageAdapter);
    await session.signOut();
    expect(auth.signOutCalls).toBe(1);
    expect(session.getSnapshot().user).toBeNull();
    expect(session.getSnapshot().adapter).toBe(local);
  });
});

describe('AuthSession — auth methods', () => {
  let local: StorageAdapter;
  beforeEach(() => {
    local = new FakeStorageAdapter();
  });

  it('signUp passes fullName through as user_metadata', async () => {
    const { client, auth } = makeFakeClient();
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    await session.signUp('a@b.com', 'pw', 'Alice Doe');
    expect(auth.signUpCalls[0]).toEqual({ email: 'a@b.com', password: 'pw', fullName: 'Alice Doe' });
  });

  it('signUp passes an emailRedirectTo to /notebook/notes when a window exists', async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { location: { origin: 'https://example.test' } };
    try {
      const { client, auth } = makeFakeClient();
      const session = new AuthSession(client, local, new FakeOAuthProbe());
      await session.signUp('a@b.com', 'pw', 'Alice Doe');
      expect(auth.signUpCalls[0].emailRedirectTo).toBe('https://example.test/notebook/notes');
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('resendSignupEmail calls auth.resend with type=signup and the emailRedirectTo', async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { location: { origin: 'https://example.test' } };
    try {
      const { client, auth } = makeFakeClient();
      const session = new AuthSession(client, local, new FakeOAuthProbe());
      await session.resendSignupEmail('a@b.com');
      expect(auth.resendCalls[0]).toEqual({
        type: 'signup',
        email: 'a@b.com',
        emailRedirectTo: 'https://example.test/notebook/notes',
      });
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('signIn calls signInWithPassword', async () => {
    const { client, auth } = makeFakeClient();
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    await session.signIn('a@b.com', 'pw');
    expect(auth.signInCalls[0]).toEqual({ email: 'a@b.com', password: 'pw' });
  });

  it('signInWithGoogle / signInWithApple route to OAuth providers', async () => {
    const { client, auth } = makeFakeClient();
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    await session.signInWithGoogle();
    await session.signInWithApple();
    expect(auth.oauthCalls.map((c) => c.provider)).toEqual(['google', 'apple']);
  });

  it('resetPassword calls resetPasswordForEmail with an /update-password redirectTo when a window exists', async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    // vitest env is 'node' (no window); stub it so the redirectTo branch is exercised.
    (globalThis as { window?: unknown }).window = {
      location: { origin: 'https://example.test' },
    };
    try {
      const { client, auth } = makeFakeClient();
      const session = new AuthSession(client, local, new FakeOAuthProbe());
      await session.resetPassword('a@b.com');
      expect(auth.resetPasswordCalls[0].email).toBe('a@b.com');
      expect(auth.resetPasswordCalls[0].redirectTo).toBe('https://example.test/update-password');
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    }
  });

  it('resetPassword passes redirectTo=undefined when no window exists (SSR fallback)', async () => {
    const { client, auth } = makeFakeClient();
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    await session.resetPassword('a@b.com');
    expect(auth.resetPasswordCalls[0].email).toBe('a@b.com');
    expect(auth.resetPasswordCalls[0].redirectTo).toBeUndefined();
  });

  it('resetPassword throws when the underlying call returns an error', async () => {
    const { client, auth } = makeFakeClient();
    auth.resetPasswordError = new Error('reset failed');
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    await expect(session.resetPassword('a@b.com')).rejects.toThrow(/reset failed/i);
  });

  it('updatePassword calls updateUser with the new password', async () => {
    const { client, auth } = makeFakeClient();
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    await session.updatePassword('new-secret');
    expect(auth.updateUserCalls[0].password).toBe('new-secret');
  });

  it('updatePassword throws when the underlying call returns an error', async () => {
    const { client, auth } = makeFakeClient();
    auth.updateUserError = new Error('update failed');
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    await expect(session.updatePassword('new-secret')).rejects.toThrow(/update failed/i);
  });

  it('all sign-in/up methods throw when no client is configured', async () => {
    const session = new AuthSession(null, local);
    await expect(session.signUp('a', 'b', 'c')).rejects.toThrow(/not configured/i);
    await expect(session.resendSignupEmail('a@b.com')).rejects.toThrow(/not configured/i);
    await expect(session.signIn('a', 'b')).rejects.toThrow(/not configured/i);
    await expect(session.signInWithGoogle()).rejects.toThrow(/not configured/i);
    await expect(session.signInWithApple()).rejects.toThrow(/not configured/i);
    await expect(session.resetPassword('a')).rejects.toThrow(/not configured/i);
    await expect(session.updatePassword('a')).rejects.toThrow(/not configured/i);
  });

  it('dispose() unsubscribes the auth listener', () => {
    const { client, auth } = makeFakeClient();
    const session = new AuthSession(client, local, new FakeOAuthProbe());
    session.init();
    expect(auth.listeners.length).toBe(1);
    session.dispose();
    expect(auth.listeners.length).toBe(0);
  });
});
