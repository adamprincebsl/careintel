// SWA injects the authenticated user as a base64-encoded JSON header on every
// proxied request to Functions. This helper decodes it and gives functions
// a clean { userId, name, provider, roles, claims } object.
//
// If the header is missing, the request bypassed SWA's auth wall — fail closed.
//
// Local dev: set MOCK_PRINCIPAL in local.settings.json to a base64 principal,
// and the helper will use that when x-ms-client-principal is absent.
//
// Copied verbatim from the Beacon SWA template (beacon-capapp / beacon-dispatch)
// — every Beacon micro-app shares this exact auth seam so behavior is identical.

export function getClientPrincipal(request) {
  let header = request.headers.get('x-ms-client-principal');
  if (!header && process.env.MOCK_PRINCIPAL) {
    header = process.env.MOCK_PRINCIPAL;
  }
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return {
      userId: parsed.userId,
      name: parsed.userDetails,
      provider: parsed.identityProvider,
      roles: parsed.userRoles || [],
      claims: parsed.claims || []
    };
  } catch {
    return null;
  }
}

export function requireAuth(request) {
  const principal = getClientPrincipal(request);
  if (!principal) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
  return principal;
}

export function requireRole(request, role) {
  const principal = requireAuth(request);
  if (!principal.roles.includes(role)) {
    const err = new Error(`Forbidden — role "${role}" required`);
    err.statusCode = 403;
    throw err;
  }
  return principal;
}
