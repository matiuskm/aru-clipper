import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// Next.js 16 renamed the "middleware" convention to "proxy".
// Auth.js `auth` wrapper is used here to gate protected routes
// via the `authorized` callback in auth.config.ts.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Run on app routes, skip Next.js internals, API routes & static assets.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
