// Next 16 "proxy" (formerly middleware; SPEC §14.3 guards): Host-header allowlist (DNS rebinding), Origin check on
// mutations, Sec-Fetch-Site on API reads, 5 MB body cap. The upload route is excluded from the matcher (the proxy would
// buffer its body) and runs the same checks itself.
import { NextResponse, type NextRequest } from "next/server";
import { checkRequest, guardInputOf, portsFromEnv } from "./server/guards";

export function proxy(request: NextRequest) {
  const r = checkRequest(guardInputOf(request, request.nextUrl.pathname), { ports: portsFromEnv(process.env) });
  if (r.ok) return NextResponse.next();
  return new NextResponse(JSON.stringify({ error: { code: r.status === 413 ? "PAYLOAD_TOO_LARGE" : "FORBIDDEN", message: r.reason } }), {
    status: r.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/projects/[^/]+/upload).*)"],
};
