const WATCH_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function editorialVideoId(address: string): string | null {
  if (!URL.canParse(address)) return null;
  const url = new URL(address);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    return null;
  const pathId = /^\/(?:embed|shorts)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  const id = WATCH_HOSTS.has(url.hostname)
    ? url.pathname === "/watch"
      ? url.searchParams.get("v")
      : pathId
    : url.hostname === "youtu.be"
      ? /^\/([^/]+)\/?$/.exec(url.pathname)?.[1]
      : url.hostname === "www.youtube-nocookie.com" &&
          url.pathname.startsWith("/embed/")
        ? pathId
        : null;
  return id && VIDEO_ID.test(id) ? id : null;
}

export const videoEmbedUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}`;
export const videoWatchUrl = (id: string) =>
  `https://www.youtube.com/watch?v=${id}`;
