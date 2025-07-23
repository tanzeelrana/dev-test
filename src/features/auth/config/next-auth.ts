import { PrismaAdapter } from "@auth/prisma-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import CredentialsProvider from "next-auth/providers/credentials";

import { db } from "@/lib/db";
import { authConfig } from "@/config/auth";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      // ...other properties
      // role: UserRole;
    } & DefaultSession["user"];
  }

  // interface User {
  //   // ...other properties
  //   // role: UserRole;
  // }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const nextAuthConfig = {
  providers: [
    DiscordProvider,

    // Simple credentials provider for testing
    CredentialsProvider({
      id: "test-credentials",
      name: "Test Login",
      credentials: {
        email: {
          label: "Email",
          type: "email",
          placeholder: "test@example.com",
        },
        name: {
          label: "Name",
          type: "text",
          placeholder: "Test User",
        },
      },
      async authorize(credentials) {
        // For testing purposes, accept any email/name combo
        // In production, you'd validate against a database
        if (credentials?.email && typeof credentials.email === "string") {
          return {
            id: `test_${Date.now()}`,
            email: credentials.email,
            name:
              (typeof credentials.name === "string"
                ? credentials.name
                : null) || "Test User",
            image: null,
          };
        }
        return null;
      },
    }),

    /**
     * ...add more providers here.
     *
     * Most other providers require a bit more work than the Discord provider. For example, the
     * GitHub provider requires you to add the `refresh_token_expires_in` field to the Account
     * model. Refer to the NextAuth.js docs for the provider you want to use. Example:
     *
     * @see https://next-auth.js.org/providers/github
     */
  ],
  adapter: PrismaAdapter(db),

  session: {
    strategy: "jwt",
    maxAge: authConfig.sessionMaxAge,
  },

  cookies: {
    sessionToken: {
      name: authConfig.sessionCookieName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name: authConfig.csrfCookieName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },

  callbacks: {
    session: ({ session, token }) => {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub || session.user.id,
        },
      };
    },
    jwt: ({ token, user, account }) => {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
      }

      if (account) {
        token.provider = account.provider;
      }

      return token;
    },
  },
  pages: {
    signIn: "/auth/signin", // Custom sign-in page
  },
} satisfies NextAuthConfig;
