import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Route protection for pages that don't exist yet (Tasks 16-19): /twin,
 * /dashboard and /onboarding. Unauthenticated visits to any of these
 * redirect to /login.
 *
 * Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts`
 * (see node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md);
 * `middleware.ts` still runs but logs a deprecation warning on every dev
 * server start, so this project uses the current name.
 *
 * This follows Supabase's documented Next.js SSR pattern: a request-scoped
 * `createServerClient` reads/writes the session cookie, and
 * `supabase.auth.getClaims()` -- never `getSession()` -- verifies the JWT
 * signature on every call. `getSession()` inside server code is not
 * guaranteed to revalidate the token and must not be used here.
 */
const PROTECTED_PATHS = ["/twin", "/dashboard", "/onboarding"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isProtected(request.nextUrl.pathname)) {
    return response;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Do not run code between createServerClient and supabase.auth.getClaims().
  // A simple mistake here could make it very hard to debug users being
  // randomly logged out.
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
