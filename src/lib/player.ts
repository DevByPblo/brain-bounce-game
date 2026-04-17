// Anonymous local player identity, persisted to localStorage.
const ID_KEY = "wikirace.playerId.v1";
const NAME_KEY = "wikirace.playerName.v1";

const ADJECTIVES = [
  "Swift", "Curious", "Quiet", "Restless", "Bold", "Wandering", "Cunning",
  "Patient", "Sudden", "Daring", "Lucid", "Brisk",
];
const NOUNS = [
  "Editor", "Reader", "Scribe", "Pilgrim", "Cartographer", "Linguist",
  "Archivist", "Librarian", "Voyager", "Tracker", "Sleuth", "Hopper",
];

const randomName = () =>
  `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${
    NOUNS[Math.floor(Math.random() * NOUNS.length)]
  }`;

export function getPlayerId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function getPlayerName(): string {
  let n = localStorage.getItem(NAME_KEY);
  if (!n) {
    n = randomName();
    localStorage.setItem(NAME_KEY, n);
  }
  return n;
}

export function setPlayerName(name: string): void {
  const trimmed = name.trim().slice(0, 32);
  if (trimmed) localStorage.setItem(NAME_KEY, trimmed);
}
