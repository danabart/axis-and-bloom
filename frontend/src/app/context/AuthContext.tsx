import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  EmailAuthProvider,
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
  signOut,
} from 'firebase/auth';
import { auth, getAppCheckTokenSafe } from '../lib/firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isGuest: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName?: string, lastName?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u === null) {
        // First visit, or fully signed out — give this visitor a real (invisible)
        // Firebase identity so quiz persistence and lifecycle tracking work for
        // guests. This re-triggers onAuthStateChanged with the new anonymous user;
        // let that second call handle isAdmin/setLoading.
        //
        // C6b — wait for App Check to have a token ready (bounded, fail-open,
        // same helper/timeout C6a uses for the backend fetch wrapper) before
        // firing the sign-in, so the Auth SDK actually has something to
        // attach to the request. On a cold load this call can otherwise beat
        // App Check's own async init (reCAPTCHA v3 load + first token
        // exchange), which is the anonymous-sign-in-specific slice of the
        // ~12% "unverified" App Check monitoring showed on Auth. Never blocks
        // sign-in indefinitely — if App Check can't produce a token within
        // the timeout, this resolves anyway and sign-in proceeds unattested,
        // exactly like today (Auth is monitoring-only, not enforced).
        await getAppCheckTokenSafe();
        signInAnonymously(auth).catch((e) => console.error('Anonymous sign-in failed:', e));
        return;
      }
      if (!u.isAnonymous) {
        try {
          const token = await u.getIdToken();
          const res = await fetch('/api/users/profile', {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          setIsAdmin(data.isAdmin === true);
        } catch {
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  async function syncUser(firstName?: string, lastName?: string) {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    try {
      await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ firstName, lastName }),
      });
    } catch (e) {
      console.error('Failed to sync user:', e);
    }
  }

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    await syncUser();
  };

  const signUp = async (email: string, password: string, firstName?: string, lastName?: string) => {
    if (auth.currentUser?.isAnonymous) {
      // Link instead of replacing the identity — the same firebase_uid carries
      // forward, so quiz history / lifecycle state already keyed off it merges
      // automatically with zero backend changes.
      await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password));
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
    await syncUser(firstName, lastName);
  };

  const signInWithGoogle = async () => {
    if (auth.currentUser?.isAnonymous) {
      try {
        await linkWithPopup(auth.currentUser, new GoogleAuthProvider());
      } catch (err: any) {
        if (err?.code === 'auth/credential-already-in-use') {
          // This Google identity already has a separate real Firebase account —
          // fall back to signing into that existing account instead of erroring.
          await signInWithPopup(auth, new GoogleAuthProvider());
        } else {
          throw err;
        }
      }
    } else {
      await signInWithPopup(auth, new GoogleAuthProvider());
    }
    await syncUser();
  };

  const signInWithApple = async () => {
    if (auth.currentUser?.isAnonymous) {
      try {
        await linkWithPopup(auth.currentUser, new OAuthProvider('apple.com'));
      } catch (err: any) {
        if (err?.code === 'auth/credential-already-in-use') {
          await signInWithPopup(auth, new OAuthProvider('apple.com'));
        } else {
          throw err;
        }
      }
    } else {
      await signInWithPopup(auth, new OAuthProvider('apple.com'));
    }
    await syncUser();
  };

  const logout = async () => {
    await signOut(auth);
  };

  const isGuest = !!user && user.isAnonymous;

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, isGuest, signIn, signUp, signInWithGoogle, signInWithApple, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
