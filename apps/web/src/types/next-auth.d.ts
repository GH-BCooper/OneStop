// The session carries the OneStop user id, so a route never has to look it up by email.
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

export {};
