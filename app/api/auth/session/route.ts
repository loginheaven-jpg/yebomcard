import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sealed = cookieStore.get(sessionOptions.cookieName);

    if (!sealed) {
      return NextResponse.json({ session: null });
    }

    const session = await unsealData<SessionData>(sealed.value, {
      password: sessionOptions.password,
    });

    if (!session?.isLoggedIn) {
      return NextResponse.json({ session: null });
    }

    return NextResponse.json({ session });
  } catch {
    return NextResponse.json({ session: null });
  }
}
