// Song cards for the playlist pages (Lingtape, Jewish Christmas): YouTube thumbnails that play the video
// in place, links that play a list of videos on YouTube, and showing a filtered list of cards without
// restarting a playing video. Songs have a video (a YouTube ID, or null), a song name and an artist.

export const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children.filter((c) => c != null && c !== false));
  return e;
};

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// YouTube links that play the given videos as an unnamed playlist, at most 50 per link (YouTube's
// limit), as [{ from, to, url }] with 1-based positions.
export const PLAYLIST_LIMIT = 50;
export function playlistLinks(videos) {
  const links = [];
  for (let i = 0; i < videos.length; i += PLAYLIST_LIMIT) {
    const chunk = videos.slice(i, i + PLAYLIST_LIMIT);
    links.push({ from: i + 1, to: i + chunk.length, url: `https://www.youtube.com/watch_videos?video_ids=${chunk.join(",")}` });
  }
  return links;
}

// "▶ Play on YouTube" links for the videos (numbered ranges when there are over 50)
export function playLinks(videos) {
  const links = playlistLinks(videos);
  return links.map(({ from, to, url }, i) => el("a", { href: url, target: "_blank", rel: "noopener", className: "play-link" },
    links.length === 1 ? "▶ Play on YouTube" : `${i ? "" : "▶ Play on YouTube: "}${from}–${to}`));
}

// A player for song cards (elements with a .song property and a .thumb child), playing one video at a
// time in place of its card's thumbnail. missing(song) makes the thumbnail for a song with no video.
export function createPlayer({ missing = () => el("div", { className: "thumb missing" }, "Not on YouTube") } = {}) {
  let playing = null; // the card whose video is playing

  function thumbnail(song) {
    if (!song.video) return missing(song);
    const button = el("button", { type: "button", className: "thumb", title: `Play ${song.song}`, onclick: () => play(button.closest(".song")) },
      el("img", { src: `https://i.ytimg.com/vi/${song.video}/mqdefault.jpg`, alt: "", loading: "lazy" }),
      el("span", { className: "play", ariaHidden: "true" }, "▶"));
    return button;
  }

  function play(card) {
    if (playing && playing !== card) stop(playing);
    playing = card;
    const song = card.song;
    card.querySelector(".thumb").replaceWith(el("iframe", {
      className: "thumb",
      src: `https://www.youtube-nocookie.com/embed/${song.video}?autoplay=1&rel=0`,
      title: `${song.song} by ${song.artist}`,
      allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
      allowFullscreen: true,
    }));
  }

  function stop(card) {
    card.querySelector(".thumb").replaceWith(thumbnail(card.song));
    if (playing === card) playing = null;
  }

  // scroll to a random one of the cards with a video and play it
  function playRandom(cards) {
    const playable = cards.filter((c) => c.song.video);
    if (!playable.length) return;
    const card = playable[Math.floor(Math.random() * playable.length)];
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    play(card);
  }

  return { thumbnail, play, playRandom };
}

// Show the given cards in list (in an order consistent with those shown) without moving any that are
// already shown, since moving an iframe reloads it and would restart a playing video.
export function showCards(list, wanted) {
  const keep = new Set(wanted);
  for (const c of [...list.children]) if (!keep.has(c)) c.remove();
  let next = list.firstElementChild;
  for (const c of wanted) {
    if (c === next) next = next.nextElementSibling;
    else list.insertBefore(c, next);
  }
}
