const BLOCKED_PATH_PATTERNS = [
  /^\/\.backup-/,
  /^\/_source(?:\/|$)/,
  /(?:^|\/)live-version\.html$/,
  /\.bak(?:$|[?#])/,
  /(?:^|\/)index-(?:old|backup|pre-migration|pre-migration-backup).*\.html$/,
  /(?:^|\/).*(?:prefix-hotfix|retrofit-before).*\.html$/,
  /^\/_redirects\.migration-ready$/,
];

function isBlockedPath(pathname) {
  return BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

export async function onRequest(context) {
  const { pathname } = new URL(context.request.url);

  if (isBlockedPath(pathname)) {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  return context.next();
}
