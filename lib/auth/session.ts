import { SessionOptions } from "iron-session";

const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "saint_record_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7, // 7일
    path: "/",
    domain: COOKIE_DOMAIN,
  },
};

export interface SessionData {
  user_id: string;
  name: string;
  email: string;
  permission_level: string;
  is_approved: boolean;
  member_id: string | null;
  group_id: string | null;
  group_role: string | null;
  finance_role: string;
  isLoggedIn: boolean;
}
