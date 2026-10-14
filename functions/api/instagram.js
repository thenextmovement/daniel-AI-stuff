// Read-only Instafeed integration. Credentials and media requests stay server-side.
const FEED_URL = 'https://instafeed.nfcube.com/feed/v6?limit=8&account=galaxybuzzdk.myshopify.com&fu=0&fid=0';
const TTL = 600;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

function response(data, status = 200) {
  return Response.json(data, {status, headers: {'Cache-Control': status === 200 ? 'public, max-age=120' : 'no-store', 'X-Content-Type-Options': 'nosniff'}});
}

function mediaURL(value) {
  try {
    const url = new URL(value);
    const host = url.hostname;
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (host === 'scontent.cdninstagram.com' || host.endsWith('.cdninstagram.com') || host.endsWith('.fbcdn.net') || host === 'instafeed.nfcube.com' || host === 'cdn.nfcube.com') ? url.href : null;
  } catch { return null; }
}

function plainText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D\u20E3]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function normalizeFeed(raw) {
  if (Number(raw?.meta?.code) !== 200) throw new Error(`provider-${Number(raw?.meta?.code) || 0}`);
  if (raw.meta.username !== 'theneontrip') throw new Error('account-mismatch');
  if (!Array.isArray(raw.data)) throw new Error('invalid-post-list');
  const ids = new Set();
  return raw.data.slice(0, 8).flatMap(post => {
    const id = String(post.id || '');
    let link;
    try { link = new URL(post.link); } catch { return []; }
    const image = mediaURL(post.images?.standard_resolution?.url);
    if (!/^[\w-]{1,100}$/.test(id) || ids.has(id) || !image || link.protocol !== 'https:' || !['www.instagram.com', 'instagram.com'].includes(link.hostname) || !/^\/(p|reel|tv)\/[\w-]+\/?$/.test(link.pathname)) return [];
    ids.add(id);
    const seconds = Number(post.created_time);
    return [{id, link: `https://www.instagram.com${link.pathname}`, image, alt: plainText(post.alt_text || post.caption?.text) || 'Ein LED-Neon-Projekt von NEONTRIP', type: post.type === 'video' ? 'video' : 'image', date: Number.isFinite(seconds) && seconds > 0 && seconds < 4102444800 ? new Date(seconds * 1000).toISOString().slice(0, 10) : null}];
  });
}

async function getFeed(context, cache) {
  const key = new Request(new URL('/__nt-instagram/v1/feed', context.request.url));
  const hit = cache && await cache.match(key);
  if (hit) return hit.json();
  const upstream = await fetch(FEED_URL, {headers: {'X-API-Key': context.env.INSTAFEED_API_KEY}, redirect: 'manual', signal: AbortSignal.timeout(8000)});
  if (!upstream.ok) throw new Error(`http-${upstream.status}`);
  const posts = normalizeFeed(await upstream.json());
  if (!posts.length) throw new Error('Feed empty');
  if (cache) context.waitUntil(cache.put(key, Response.json(posts, {headers: {'Cache-Control': `public, max-age=${TTL}`}})));
  return posts;
}

export async function onRequest(context) {
  const {request, env} = context;
  if (request.method !== 'GET') return new Response('Method Not Allowed', {status: 405, headers: {Allow: 'GET', 'Cache-Control': 'no-store'}});
  if (!env.INSTAFEED_API_KEY) {
    console.warn('NEONTRIP Instagram: missing-secret');
    return response({available: false}, 503);
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('image');
  if ([...url.searchParams.keys()].some(name => name !== 'image') || (id !== null && !/^[\w-]{1,100}$/.test(id))) return response({available: false}, 400);
  const cache = globalThis.caches?.default;
  try {
    // Only image IDs from this account's current feed are accepted, never caller URLs.
    const posts = await getFeed(context, cache);
    if (id === null) return response({available: true, username: 'theneontrip', posts: posts.map(post => ({...post, image: `/api/instagram?image=${encodeURIComponent(post.id)}`}))});
    const post = posts.find(item => item.id === id);
    if (!post) return response({available: false}, 404);
    const key = new Request(new URL(`/__nt-instagram/v1/image/${id}`, request.url));
    const cached = cache && await cache.match(key);
    if (cached) return cached;
    const media = await fetch(post.image, {redirect: 'manual', signal: AbortSignal.timeout(8000)});
    const type = media.headers.get('Content-Type')?.split(';')[0];
    if (!media.ok || !imageTypes.has(type) || Number(media.headers.get('Content-Length')) > 5_000_000) throw new Error('Image unavailable');
    const bytes = await media.arrayBuffer();
    if (bytes.byteLength > 5_000_000) throw new Error('Image too large');
    const result = new Response(bytes, {headers: {'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff'}});
    if (cache) context.waitUntil(cache.put(key, result.clone()));
    return result;
  } catch (error) {
    // Log only known diagnostic codes, never upstream bodies, URLs or credentials.
    const known = /^(provider-\d+|http-\d+|account-mismatch|invalid-post-list|Feed empty|Image unavailable|Image too large)$/;
    console.warn('NEONTRIP Instagram:', known.test(error.message) ? error.message : error.name === 'TimeoutError' ? 'timeout' : 'request-failed');
    return response({available: false}, 503);
  }
}
