import type { NextAuthConfig } from 'next-auth';

// Edge-safe Auth.js config (no database / Node-only imports here).
// Used by both `middleware.ts` and the full `auth.ts`.
export const authConfig = {
  pages: {
    signIn: '/login',
  },
  providers: [], // real providers are added in auth.ts (Node runtime)
  callbacks: {
    // Runs in middleware to gate access to protected routes.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');

      if (isOnDashboard) {
        return isLoggedIn; // redirect unauthenticated users to /login
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
