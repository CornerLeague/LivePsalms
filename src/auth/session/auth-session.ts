import type { SupabaseClient, User, Subscription } from '@supabase/supabase-js';
import { Observable } from '@/notepad/collection/observable';
import type { StorageAdapter } from '@/notepad/storage/adapter';
import { SupabaseStorageAdapter } from '@/notepad/storage/supabase-adapter';

export interface AuthSessionState {
  user: User | null;
  loading: boolean;
  adapter: StorageAdapter;
}

interface OAuthCallbackProbe {
  hasCallbackParams(): boolean;
  stripCallbackParams(): void;
}

const browserOAuthProbe: OAuthCallbackProbe = {
  hasCallbackParams() {
    if (typeof window === 'undefined') return false;
    const url = new URL(window.location.href);
    return (
      url.searchParams.has('code') ||
      url.hash.includes('access_token=') ||
      url.hash.includes('error=')
    );
  },
  stripCallbackParams() {
    if (typeof window === 'undefined') return;
    window.history.replaceState({}, document.title, window.location.pathname);
  },
};

/**
 * Identity for the active session. The `adapter` field is derived state:
 * `localAdapter` when no user, a `SupabaseStorageAdapter` memoized on `user.id`
 * when signed in. The Supabase auth listener keeps state in sync; explicit
 * sign-out flows back through that listener rather than mutating state directly.
 */
export class AuthSession extends Observable<AuthSessionState> {
  private readonly client: SupabaseClient | null;
  private readonly localAdapter: StorageAdapter;
  private readonly oauthProbe: OAuthCallbackProbe;
  private subscription: Subscription | null = null;
  private initialOAuthCallback = false;

  constructor(
    client: SupabaseClient | null,
    localAdapter: StorageAdapter,
    oauthProbe: OAuthCallbackProbe = browserOAuthProbe,
  ) {
    super({
      user: null,
      loading: client !== null,
      adapter: localAdapter,
    });
    this.client = client;
    this.localAdapter = localAdapter;
    this.oauthProbe = oauthProbe;
  }

  /**
   * Subscribe to auth state changes and resolve the initial session. Idempotent —
   * a second `init()` call without a `dispose()` is a programmer error and is
   * ignored.
   */
  init(): void {
    if (!this.client) {
      this.update((prev) => ({ ...prev, loading: false }));
      return;
    }
    if (this.subscription) return;

    this.initialOAuthCallback = this.oauthProbe.hasCallbackParams();

    if (!this.initialOAuthCallback) {
      // Normal page load — resolve initial session immediately. On OAuth
      // callbacks we wait for the SIGNED_IN event from the auth listener
      // because the supabase client exchanges the code asynchronously.
      this.client.auth.getSession()
        .then(({ data: { session } }) => {
          this.applySession(session?.user ?? null);
        })
        .catch(() => {
          this.applySession(null);
        })
        .finally(() => {
          this.update((prev) => ({ ...prev, loading: false }));
        });
    }

    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      this.applySession(session?.user ?? null);
      this.update((prev) => ({ ...prev, loading: false }));
      if (this.initialOAuthCallback && session?.user) {
        this.oauthProbe.stripCallbackParams();
        this.initialOAuthCallback = false;
      }
    });
    this.subscription = data.subscription;
  }

  dispose(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  signUp = async (email: string, password: string, fullName: string): Promise<void> => {
    if (!this.client) throw new Error('Supabase not configured');
    const emailRedirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/notebook/notes` : undefined;
    const { error } = await this.client.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo },
    });
    if (error) throw error;
  };

  resendSignupEmail = async (email: string): Promise<void> => {
    if (!this.client) throw new Error('Supabase not configured');
    const emailRedirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/notebook/notes` : undefined;
    const { error } = await this.client.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo },
    });
    if (error) throw error;
  };

  signIn = async (email: string, password: string): Promise<void> => {
    if (!this.client) throw new Error('Supabase not configured');
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  resetPassword = async (email: string): Promise<void> => {
    if (!this.client) throw new Error('Supabase not configured');
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/update-password` : undefined;
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  };

  updatePassword = async (password: string): Promise<void> => {
    if (!this.client) throw new Error('Supabase not configured');
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw error;
  };

  signInWithGoogle = async (): Promise<void> => {
    if (!this.client) throw new Error('Supabase not configured');
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/notebook/notes` : undefined;
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw error;
  };

  signInWithApple = async (): Promise<void> => {
    if (!this.client) throw new Error('Supabase not configured');
    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/notebook/notes` : undefined;
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo },
    });
    if (error) throw error;
  };

  signOut = async (): Promise<void> => {
    if (!this.client) return;
    await this.client.auth.signOut();
    // The onAuthStateChange listener will fire with a null session and reset
    // user/adapter via applySession.
  };

  private applySession(user: User | null): void {
    this.update((prev) => {
      const sameId = prev.user?.id === user?.id;
      const adapter = user && this.client
        ? (sameId && prev.adapter !== this.localAdapter
            ? prev.adapter
            : new SupabaseStorageAdapter(this.client, user.id))
        : this.localAdapter;
      return { ...prev, user, adapter };
    });
  }

  private update(updater: (prev: AuthSessionState) => AuthSessionState): void {
    this.setState(updater);
  }
}
