// ============================================================
// Worker: musik-yt v4 — jembatan musik buat 4ever Musik
// 1) ?q=...   -> pencarian video musik YouTube (secret: YT_KEY)
// 2) ?sp=...  -> pencarian katalog Spotify: judul rapi, cover
//    album asli, artis bener (secret: SPOTIFY_ID + SPOTIFY_SECRET)
// Semua kunci disimpan sebagai secret di Worker ini, tidak
// terlihat di kode halaman musik.html.
// ============================================================
export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);

    // ---------- jalur Spotify: katalog ----------
    const sp = (url.searchParams.get('sp') || '').trim().slice(0, 120);
    if (sp) {
      if (!env.SPOTIFY_ID || !env.SPOTIFY_SECRET) {
        return Response.json({ error: 'SPOTIFY_ID/SECRET belum dipasang di Worker' }, { status: 500, headers: cors });
      }
      const cache = caches.default;
      const cacheKey = new Request(url.origin + '/sp-cache/' + encodeURIComponent(sp.toLowerCase()));
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
      try {
        const tokRes = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(env.SPOTIFY_ID + ':' + env.SPOTIFY_SECRET),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
        });
        const tok = await tokRes.json().catch(() => ({}));
        if (!tok.access_token) {
          return Response.json({ error: 'gagal ambil token Spotify' }, { status: 502, headers: cors });
        }
        const r = await fetch('https://api.spotify.com/v1/search?type=track&limit=24&market=ID&q=' + encodeURIComponent(sp), {
          headers: { 'Authorization': 'Bearer ' + tok.access_token },
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg = (d.error && d.error.message) || 'Spotify API error';
          return Response.json({ error: msg }, { status: 502, headers: cors });
        }
        const items = ((d.tracks && d.tracks.items) || []).map(t => ({
          title: t.name || '',
          artists: (t.artists || []).map(a => a.name).join(', '),
          album: (t.album && t.album.name) || '',
          cover: (t.album && t.album.images && t.album.images[0] && t.album.images[0].url) || '',
          year: ((t.album && t.album.release_date) || '').slice(0, 4),
          spotify: (t.external_urls && t.external_urls.spotify) || '',
        })).filter(x => x.title);
        const res = Response.json({ items }, {
          headers: { ...cors, 'Cache-Control': 'public, max-age=300' },
        });
        if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      } catch (e) {
        return Response.json({ error: 'Spotify lagi nggak bisa dihubungi' }, { status: 502, headers: cors });
      }
    }

    // ---------- jalur Deezer: katalog resmi (tanpa kunci) ----------
    const dz = (url.searchParams.get('dz') || '').trim().slice(0, 120);
    if (dz) {
      const cache = caches.default;
      const cacheKey = new Request(url.origin + '/dz-cache/' + encodeURIComponent(dz.toLowerCase()));
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
      try {
        const r = await fetch('https://api.deezer.com/search?limit=24&q=' + encodeURIComponent(dz));
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return Response.json({ error: 'Deezer API error' }, { status: 502, headers: cors });
        const items = (d.data || []).map(t => ({
          title: t.title || '',
          artists: (t.artist && t.artist.name) || '',
          album: (t.album && t.album.title) || '',
          cover: (t.album && (t.album.cover_xl || t.album.cover_medium)) || '',
          duration: t.duration || 0,
        })).filter(x => x.title);
        const res = Response.json({ items }, {
          headers: { ...cors, 'Cache-Control': 'public, max-age=300' },
        });
        if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      } catch (e) {
        return Response.json({ error: 'Deezer lagi nggak bisa dihubungi' }, { status: 502, headers: cors });
      }
    }

    // ---------- jalur YouTube: pencarian video musik ----------
    const q = (url.searchParams.get('q') || '').trim().slice(0, 120);
    if (!q) return Response.json({ error: 'parameter q kosong' }, { headers: cors });
    if (!env.YT_KEY) {
      return Response.json({ error: 'YT_KEY belum dipasang di Worker' }, { status: 500, headers: cors });
    }

    const api = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video'
      + '&videoEmbeddable=true&videoCategoryId=10&maxResults=24&q=' + encodeURIComponent(q)
      + '&key=' + env.YT_KEY;
    const r = await fetch(api);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && j.error.message) || 'YouTube API error';
      return Response.json({ error: msg }, { status: 502, headers: cors });
    }

    const items = (j.items || []).map(it => {
      const sn = it.snippet || {};
      const th = sn.thumbnails || {};
      return {
        id: it.id && it.id.videoId,
        title: sn.title || '',
        channel: sn.channelTitle || '',
        thumb: (th.high && th.high.url) || (th.medium && th.medium.url) || '',
      };
    }).filter(x => x.id);

    return Response.json({ items }, {
      headers: { ...cors, 'Cache-Control': 'public, max-age=300' },
    });
  },
};
