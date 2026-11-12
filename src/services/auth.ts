import { initializeApp, getApps } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User 
} from 'firebase/auth';
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasFirebaseConfig = Object.values(firebaseConfig).every((value) => Boolean(value));
const app = hasFirebaseConfig
  ? (getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0])
  : null;
export const auth = app ? getAuth(app) : null;

// Essential Google OAuth Scopes for Blogger and Drive integration
export const SCOPES = [
  'https://www.googleapis.com/auth/blogger',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

const provider = new GoogleAuthProvider();
SCOPES.forEach(scope => provider.addScope(scope));

// Allow any Google account to sign in seamlessly
provider.setCustomParameters({
  access_type: 'offline'
});

const TOKEN_STORAGE_KEY = 'easyflight_google_token';

// Hydrate cached token from session/local storage
let cachedAccessToken: string | null = typeof window !== 'undefined'
  ? (sessionStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(TOKEN_STORAGE_KEY))
  : null;

let isSigningIn = false;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  if (!auth) {
    onAuthFailure?.();
    return () => undefined;
  }
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const storedToken = cachedAccessToken || 
        (typeof window !== 'undefined' ? (sessionStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(TOKEN_STORAGE_KEY)) : null);

      if (storedToken) {
        cachedAccessToken = storedToken;
        if (onAuthSuccess) onAuthSuccess(user, storedToken);
      } else {
        // User logged in via Firebase session but access token needs manual refresh
        if (onAuthSuccess) onAuthSuccess(user, '');
      }
    } else {
      cachedAccessToken = null;
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      }
      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Sign in with Google with Blogger & Drive OAuth scopes
 */
export const googleSignIn = async (): Promise<{ user: User; accessToken: string }> => {
  try {
    if (!auth) throw new Error('Firebase authentication is not configured for this deployment.');
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    
    if (!credential?.accessToken) {
      throw new Error('Google did not return an OAuth access token. Ensure popups are allowed and third-party cookies are enabled.');
    }

    cachedAccessToken = credential.accessToken;
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, cachedAccessToken);
        localStorage.setItem(TOKEN_STORAGE_KEY, cachedAccessToken);
      } catch (e) {
        console.warn('Storage quota limit when saving token:', e);
      }
    }

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Google Sign-In Error:', error);

    let friendlyMessage = error.message || 'Failed to authenticate with Google.';
    if (error.code === 'auth/popup-blocked') {
      friendlyMessage = 'The Google sign-in window was blocked by your browser. Please allow popups for this site and try again.';
    } else if (error.code === 'auth/popup-closed-by-user') {
      friendlyMessage = 'Google Sign-In was closed before completing authorization.';
    } else if (error.code === 'auth/unauthorized-domain') {
      friendlyMessage = 'This domain is not yet authorized in Firebase. Please add this domain under Firebase Console > Authentication > Settings > Authorized Domains.';
    } else if (error.code === 'auth/cancelled-popup-request') {
      friendlyMessage = 'Multiple popup requests were initiated. Please try again once.';
    }

    throw new Error(friendlyMessage);
  } finally {
    isSigningIn = false;
  }
};

/**
 * Manually attach or override an OAuth token (useful if popups are blocked or on custom domains)
 */
export const setManualGoogleToken = (token: string) => {
  cachedAccessToken = token.trim();
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, cachedAccessToken);
      localStorage.setItem(TOKEN_STORAGE_KEY, cachedAccessToken);
    } catch {
      // ignore
    }
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(TOKEN_STORAGE_KEY);
  }
  return null;
};

export const logout = async () => {
  if (auth) {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('Sign out error:', e);
    }
  }
  cachedAccessToken = null;
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
};

export interface UserBlog {
  id: string;
  name: string;
  url: string;
  posts: { totalItems: number };
}

/**
 * Dynamically fetch blogs owned or authored by the signed-in Google account
 */
export async function fetchUserBloggerBlogs(accessToken: string): Promise<UserBlog[]> {
  if (!accessToken || !accessToken.trim()) return [];

  try {
    const res = await fetch('https://www.googleapis.com/blogger/v3/users/self/blogs', {
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`
      }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[Blogger API] fetchUserBloggerBlogs failed:', res.status, err);
      return [];
    }

    const data = await res.json();
    return data.items || [];
  } catch (e) {
    console.warn('[Blogger API] Exception fetching blogs:', e);
    return [];
  }
}
