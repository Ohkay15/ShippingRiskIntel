import { NextResponse, type NextRequest } from "next/server";

import { isPublicPath, SESSION_COOKIE } from "@/auth/constants";
import { ACCOUNT_ONLY_PATHS, signInRequired } from "@/auth/mode";
import { userForSessionToken } from "@/auth/session-store";

/**
 * The gate in front of every page and API route: the session cookie is
 * verified against the database BEFORE anything renders, so a missing,
 * expired or forged cookie never reaches page code. (Pages, server actions
 * and API routes re-check the session themselves as a second layer.)
 *
 * Runs on the Node.js runtime so it can reach Postgres.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Open mode: no accounts at all. Account pages just go home.
  if (!signInRequired()) {
    if (ACCOUNT_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let signedIn = false;
  if (token) {
    try {
      signedIn = (await userForSessionToken(token)) !== null;
    } catch {
      signedIn = false; // database unreachable: fail closed
    }
  }
  if (signedIn) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  const response = NextResponse.redirect(url);
  if (token) response.cookies.delete(SESSION_COOKIE); // drop a dead cookie
  return response;
}

export const config = {
  runtime: "nodejs",
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
