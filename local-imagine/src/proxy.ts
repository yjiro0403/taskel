import { NextRequest, NextResponse } from "next/server";

/**
 * Local-only guard: the API has no authentication, so refuse requests that do not come
 * from a loopback host, and refuse cross-site requests (DNS rebinding / malicious pages).
 */
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;

export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!LOOPBACK.test(host) && !process.env.LOCAL_IMAGINE_ALLOW_REMOTE) {
    return NextResponse.json({ error: "Local Imagine only accepts connections from localhost" }, { status: 403 });
  }
  if (req.nextUrl.pathname.startsWith("/api/") && req.method !== "GET" && req.method !== "HEAD") {
    const site = req.headers.get("sec-fetch-site");
    const origin = req.headers.get("origin");
    if (site && site !== "same-origin" && site !== "none") {
      return NextResponse.json({ error: "Cross-site requests are not allowed" }, { status: 403 });
    }
    if (origin) {
      try {
        if (new URL(origin).host !== host) return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
      } catch {
        return NextResponse.json({ error: "Bad origin" }, { status: 403 });
      }
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*", "/"] };
