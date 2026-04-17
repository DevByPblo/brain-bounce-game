// Category-aware target picker.
//
// Each category maps to one or more Wikipedia category names (used with the
// `categorymembers` API) AND a curated fallback pool of well-known articles.
// At runtime we try the live API first (cached per session), and fall back to
// the curated list if the API stalls, errors, or returns nothing usable.
//
// We deliberately keep curated pools short and *recognisable* — a category
// race should land you on a target you've heard of.

const API = "https://en.wikipedia.org/w/api.php";

const apiUrl = (params: Record<string, string>) => {
  const usp = new URLSearchParams({ origin: "*", format: "json", ...params });
  return `${API}?${usp.toString()}`;
};

const isBadCategoryTitle = (t: string) =>
  /^(List of|Index of|Outline of|Timeline of|History of)\b/i.test(t) ||
  /\(disambiguation\)/i.test(t) ||
  /^[A-Z][a-z]+ \d{4}$/.test(t) || // "January 1990"-style
  t.length > 60;

export type CategoryDef = {
  /** Canonical label shown in the dropdown. */
  label: string;
  /** Wikipedia category names (without the "Category:" prefix). */
  wikiCategories: string[];
  /** Curated fallback article titles. */
  fallback: string[];
};

export const CATEGORIES: CategoryDef[] = [
  {
    label: "Animals",
    wikiCategories: ["Mammals", "Birds", "Reptiles"],
    fallback: ["Lion", "Octopus", "Elephant", "Dolphin", "Penguin", "Tiger", "Giraffe", "Wolf", "Honey bee", "Komodo dragon"],
  },
  {
    label: "Architecture and Design",
    wikiCategories: ["Architecture", "Architectural styles"],
    fallback: ["Eiffel Tower", "Sydney Opera House", "Gothic architecture", "Bauhaus", "Frank Lloyd Wright", "Taj Mahal", "Brutalist architecture", "Colosseum"],
  },
  {
    label: "Arts",
    wikiCategories: ["Visual arts", "Painting"],
    fallback: ["Mona Lisa", "Vincent van Gogh", "Pablo Picasso", "Renaissance", "Sculpture", "Impressionism", "Surrealism", "Salvador Dalí"],
  },
  {
    label: "Civilization",
    wikiCategories: ["Civilizations", "Ancient civilizations"],
    fallback: ["Roman Empire", "Ancient Egypt", "Maya civilization", "Mesopotamia", "Aztec Empire", "Inca Empire", "Byzantine Empire", "Han dynasty"],
  },
  {
    label: "Computing",
    wikiCategories: ["Computing", "Computer science"],
    fallback: ["Linux", "Alan Turing", "Internet", "Algorithm", "Cryptography", "Operating system", "World Wide Web", "Programming language"],
  },
  {
    label: "Earth",
    wikiCategories: ["Earth sciences", "Geology"],
    fallback: ["Mount Everest", "Plate tectonics", "Volcano", "Earthquake", "Pacific Ocean", "Sahara", "Amazon rainforest", "Glacier"],
  },
  {
    label: "Economics",
    wikiCategories: ["Economics"],
    fallback: ["Capitalism", "Inflation", "Stock market", "Adam Smith", "Great Depression", "Cryptocurrency", "Gross domestic product", "Federal Reserve"],
  },
  {
    label: "Engineering",
    wikiCategories: ["Engineering"],
    fallback: ["Steam engine", "Bridge", "Skyscraper", "Internal combustion engine", "Nuclear reactor", "Robotics", "Civil engineering", "Hoover Dam"],
  },
  {
    label: "Environment",
    wikiCategories: ["Environment"],
    fallback: ["Climate change", "Renewable energy", "Deforestation", "Recycling", "Greenhouse gas", "Ozone layer", "Biodiversity", "Sustainability"],
  },
  {
    label: "Film and TV",
    wikiCategories: ["Films", "Television series"],
    fallback: ["The Godfather", "Star Wars", "Breaking Bad", "Alfred Hitchcock", "Pulp Fiction", "The Simpsons", "Citizen Kane", "Studio Ghibli"],
  },
  {
    label: "Food and Drink",
    wikiCategories: ["Foods", "Beverages"],
    fallback: ["Pizza", "Sushi", "Coffee", "Chocolate", "Wine", "Bread", "Cheese", "Tea"],
  },
  {
    label: "Geography",
    wikiCategories: ["Geography"],
    fallback: ["Japan", "Brazil", "Iceland", "New York City", "Sahara", "Himalayas", "Nile", "Mediterranean Sea"],
  },
  {
    label: "History",
    wikiCategories: ["History"],
    fallback: ["French Revolution", "World War II", "Cold War", "Industrial Revolution", "Renaissance", "Ancient Rome", "Silk Road", "Middle Ages"],
  },
  {
    label: "Inventions",
    wikiCategories: ["Inventions"],
    fallback: ["Telephone", "Printing press", "Light bulb", "Airplane", "Penicillin", "Television", "Photography", "Wheel"],
  },
  {
    label: "Life",
    wikiCategories: ["Biology", "Life"],
    fallback: ["DNA", "Cell (biology)", "Evolution", "Photosynthesis", "Bacteria", "Virus", "Ecosystem", "Genetics"],
  },
  {
    label: "Literature",
    wikiCategories: ["Literature", "Novels"],
    fallback: ["William Shakespeare", "Don Quixote", "Jane Austen", "Leo Tolstoy", "Moby-Dick", "Homer", "Franz Kafka", "Poetry"],
  },
  {
    label: "Mathematics",
    wikiCategories: ["Mathematics"],
    fallback: ["Pi", "Euclid", "Calculus", "Prime number", "Pythagorean theorem", "Fibonacci sequence", "Geometry", "Isaac Newton"],
  },
  {
    label: "Medicine and Health",
    wikiCategories: ["Medicine", "Health"],
    fallback: ["Vaccine", "Antibiotic", "Heart", "Cancer", "Surgery", "Hippocrates", "Penicillin", "Insulin"],
  },
  {
    label: "Music",
    wikiCategories: ["Music", "Musicians"],
    fallback: ["The Beatles", "Mozart", "Jazz", "Beyoncé", "Hip hop music", "Bob Dylan", "Piano", "Symphony"],
  },
  {
    label: "Mythology",
    wikiCategories: ["Mythology"],
    fallback: ["Zeus", "Norse mythology", "Egyptian mythology", "Thor", "Odin", "Greek mythology", "Hercules", "Anubis"],
  },
  {
    label: "Nature",
    wikiCategories: ["Nature"],
    fallback: ["Forest", "Coral reef", "Tundra", "Rainforest", "Wildflower", "Mountain", "Desert", "River"],
  },
  {
    label: "Philosophy",
    wikiCategories: ["Philosophy", "Philosophers"],
    fallback: ["Plato", "Aristotle", "Friedrich Nietzsche", "Stoicism", "Existentialism", "Immanuel Kant", "Confucius", "René Descartes"],
  },
  {
    label: "Politics",
    wikiCategories: ["Politics"],
    fallback: ["Democracy", "United Nations", "European Union", "Karl Marx", "Constitution", "Diplomacy", "Nelson Mandela", "Winston Churchill"],
  },
  {
    label: "Religion",
    wikiCategories: ["Religion"],
    fallback: ["Christianity", "Islam", "Buddhism", "Hinduism", "Judaism", "Bible", "Vatican City", "Dalai Lama"],
  },
  {
    label: "Science",
    wikiCategories: ["Science"],
    fallback: ["Albert Einstein", "Quantum mechanics", "Periodic table", "Marie Curie", "Theory of relativity", "DNA", "Big Bang", "Charles Darwin"],
  },
  {
    label: "Space",
    wikiCategories: ["Outer space", "Astronomy"],
    fallback: ["Moon", "Mars", "Jupiter", "Black hole", "Apollo 11", "International Space Station", "Solar System", "Hubble Space Telescope"],
  },
  {
    label: "Sports",
    wikiCategories: ["Sports"],
    fallback: ["Association football", "Olympic Games", "Basketball", "Tennis", "Cricket", "Michael Jordan", "FIFA World Cup", "Formula One"],
  },
  {
    label: "Technology",
    wikiCategories: ["Technology"],
    fallback: ["Smartphone", "Artificial intelligence", "Electric car", "3D printing", "Robotics", "Solar panel", "Nanotechnology", "Blockchain"],
  },
  {
    label: "Test",
    wikiCategories: ["Tests"],
    fallback: ["Examination", "IQ", "Turing test", "Standardized test", "SAT"],
  },
  {
    label: "Transportation",
    wikiCategories: ["Transport"],
    fallback: ["Bicycle", "Train", "Automobile", "Airplane", "Ship", "Subway", "Helicopter", "Truck"],
  },
  {
    label: "Universe",
    wikiCategories: ["Universe", "Cosmology"],
    fallback: ["Big Bang", "Galaxy", "Dark matter", "Black hole", "Milky Way", "Cosmic microwave background", "Andromeda Galaxy", "Multiverse"],
  },
  {
    label: "Wars",
    wikiCategories: ["Wars", "Military history"],
    fallback: ["World War I", "World War II", "Vietnam War", "American Civil War", "Napoleonic Wars", "Cold War", "Crusades", "Battle of Waterloo"],
  },
];

export const CATEGORY_LABELS = CATEGORIES.map((c) => c.label);

const cache = new Map<string, string[]>();

/** Pull a (cached) pool of decent article titles from a category's Wikipedia categories. */
async function fetchPoolFor(def: CategoryDef): Promise<string[]> {
  if (cache.has(def.label)) return cache.get(def.label)!;
  const collected = new Set<string>();
  await Promise.all(
    def.wikiCategories.map(async (cat) => {
      try {
        const url = apiUrl({
          action: "query",
          list: "categorymembers",
          cmtitle: `Category:${cat}`,
          cmnamespace: "0", // articles only — excludes sub-categories
          cmlimit: "200",
          cmtype: "page",
        });
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        const members: { title: string }[] = json?.query?.categorymembers ?? [];
        for (const m of members) {
          if (!isBadCategoryTitle(m.title)) collected.add(m.title);
        }
      } catch {
        /* ignore — we'll fall back */
      }
    })
  );
  const arr = Array.from(collected);
  cache.set(def.label, arr);
  return arr;
}

/** Pick a random article title from the given category. Falls back to curated list. */
export async function getTitleForCategory(label: string): Promise<string> {
  const def = CATEGORIES.find((c) => c.label === label);
  if (!def) throw new Error(`Unknown category: ${label}`);

  const live = await fetchPoolFor(def);
  const pool = live.length >= 5 ? live : def.fallback;
  return pool[Math.floor(Math.random() * pool.length)];
}
