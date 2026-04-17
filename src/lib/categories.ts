// Category-aware target picker.
//
// Each category maps to one or more Wikipedia category names (used with the
// `categorymembers` API) AND a curated fallback pool of well-known articles.
// At runtime we try the live API first (cached per session), and fall back to
// the curated list if the API stalls, errors, or returns nothing usable.
//
// We deliberately keep curated pools short and *recognisable* — a category
// race should land you on a target you've heard of.
//
// Difficulty tiers:
//   easy   — household-name targets (Taylor Swift, Pizza, Einstein)
//   normal — well-known but slightly less universal (George Michael, Sushi)
//   hard   — obscure / niche targets (Anacrusis, lesser-known laureates)

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
  /** Curated default fallback (used when no tier-specific list applies). */
  fallback: string[];
  /** Curated easy targets — household names. */
  easyFallback?: string[];
  /** Curated hard targets — obscure / niche. */
  hardFallback?: string[];
};

export const CATEGORIES: CategoryDef[] = [
  {
    label: "Animals",
    wikiCategories: ["Mammals", "Birds", "Reptiles"],
    fallback: ["Lion", "Octopus", "Elephant", "Dolphin", "Penguin", "Tiger", "Giraffe", "Wolf", "Honey bee", "Komodo dragon"],
    easyFallback: ["Lion", "Tiger", "Elephant", "Dog", "Cat", "Horse", "Eagle", "Shark"],
    hardFallback: ["Aye-aye", "Pangolin", "Okapi", "Dik-dik", "Gerenuk", "Saola", "Numbat", "Kakapo"],
  },
  {
    label: "Architecture and Design",
    wikiCategories: ["Architecture", "Architectural styles"],
    fallback: ["Eiffel Tower", "Sydney Opera House", "Gothic architecture", "Bauhaus", "Frank Lloyd Wright", "Taj Mahal", "Brutalist architecture", "Colosseum"],
    easyFallback: ["Eiffel Tower", "Taj Mahal", "Statue of Liberty", "Colosseum", "Burj Khalifa", "Big Ben"],
    hardFallback: ["Mannerism", "Stick style", "Carpenter Gothic", "Streamline Moderne", "Constructivist architecture", "Metabolism (architecture)"],
  },
  {
    label: "Arts",
    wikiCategories: ["Visual arts", "Painting"],
    fallback: ["Mona Lisa", "Vincent van Gogh", "Pablo Picasso", "Renaissance", "Sculpture", "Impressionism", "Surrealism", "Salvador Dalí"],
    easyFallback: ["Mona Lisa", "Vincent van Gogh", "Pablo Picasso", "Leonardo da Vinci", "The Starry Night"],
    hardFallback: ["Tachisme", "Suprematism", "Lyrical abstraction", "Op art", "Quattrocento", "Vorticism"],
  },
  {
    label: "Civilization",
    wikiCategories: ["Civilizations", "Ancient civilizations"],
    fallback: ["Roman Empire", "Ancient Egypt", "Maya civilization", "Mesopotamia", "Aztec Empire", "Inca Empire", "Byzantine Empire", "Han dynasty"],
    easyFallback: ["Roman Empire", "Ancient Egypt", "Aztec Empire", "Inca Empire", "Vikings"],
    hardFallback: ["Hittites", "Olmecs", "Phoenicia", "Nabataeans", "Sogdia", "Kushan Empire"],
  },
  {
    label: "Computing",
    wikiCategories: ["Computing", "Computer science"],
    fallback: ["Linux", "Alan Turing", "Internet", "Algorithm", "Cryptography", "Operating system", "World Wide Web", "Programming language"],
    easyFallback: ["Internet", "Linux", "Windows 11", "Google", "World Wide Web"],
    hardFallback: ["Lambda calculus", "Hindley–Milner type system", "Continuation-passing style", "Coroutine", "Memoization"],
  },
  {
    label: "Earth",
    wikiCategories: ["Earth sciences", "Geology"],
    fallback: ["Mount Everest", "Plate tectonics", "Volcano", "Earthquake", "Pacific Ocean", "Sahara", "Amazon rainforest", "Glacier"],
    easyFallback: ["Mount Everest", "Volcano", "Earthquake", "Pacific Ocean", "Sahara"],
    hardFallback: ["Karst", "Loess", "Doline", "Phreatomagmatic eruption", "Subduction"],
  },
  {
    label: "Economics",
    wikiCategories: ["Economics"],
    fallback: ["Capitalism", "Inflation", "Stock market", "Adam Smith", "Great Depression", "Cryptocurrency", "Gross domestic product", "Federal Reserve"],
    easyFallback: ["Inflation", "Stock market", "Capitalism", "Cryptocurrency", "Great Depression"],
    hardFallback: ["Phillips curve", "Laffer curve", "Pareto efficiency", "Stagflation", "Monetarism"],
  },
  {
    label: "Engineering",
    wikiCategories: ["Engineering"],
    fallback: ["Steam engine", "Bridge", "Skyscraper", "Internal combustion engine", "Nuclear reactor", "Robotics", "Civil engineering", "Hoover Dam"],
    easyFallback: ["Steam engine", "Bridge", "Skyscraper", "Hoover Dam", "Robotics"],
    hardFallback: ["Cantilever truss", "Wankel engine", "Magnetorheological damper", "Voussoir", "Tribology"],
  },
  {
    label: "Environment",
    wikiCategories: ["Environment"],
    fallback: ["Climate change", "Renewable energy", "Deforestation", "Recycling", "Greenhouse gas", "Ozone layer", "Biodiversity", "Sustainability"],
    easyFallback: ["Climate change", "Recycling", "Renewable energy", "Deforestation"],
    hardFallback: ["Eutrophication", "Carbon sequestration", "Bioremediation", "Allochthonous"],
  },
  {
    label: "Film and TV",
    wikiCategories: ["Films", "Television series"],
    fallback: ["The Godfather", "Star Wars", "Breaking Bad", "Alfred Hitchcock", "Pulp Fiction", "The Simpsons", "Citizen Kane", "Studio Ghibli"],
    easyFallback: ["Star Wars", "The Simpsons", "Breaking Bad", "Friends (TV series)", "Harry Potter (film series)"],
    hardFallback: ["Andrei Rublev (film)", "Stalker (1979 film)", "Au hasard Balthazar", "Sátántangó", "Persona (1966 film)"],
  },
  {
    label: "Food and Drink",
    wikiCategories: ["Foods", "Beverages"],
    fallback: ["Pizza", "Sushi", "Coffee", "Chocolate", "Wine", "Bread", "Cheese", "Tea"],
    easyFallback: ["Pizza", "Coffee", "Chocolate", "Bread", "Burger", "Sushi"],
    hardFallback: ["Casu martzu", "Hákarl", "Surströmming", "Natto", "Kvass", "Salep"],
  },
  {
    label: "Geography",
    wikiCategories: ["Geography"],
    fallback: ["Japan", "Brazil", "Iceland", "New York City", "Sahara", "Himalayas", "Nile", "Mediterranean Sea"],
    easyFallback: ["Japan", "Brazil", "France", "New York City", "London", "Australia"],
    hardFallback: ["Tuvalu", "Liechtenstein", "Comoros", "Bhutan", "Kiribati", "Eritrea"],
  },
  {
    label: "History",
    wikiCategories: ["History"],
    fallback: ["French Revolution", "World War II", "Cold War", "Industrial Revolution", "Renaissance", "Ancient Rome", "Silk Road", "Middle Ages"],
    easyFallback: ["World War II", "Cold War", "French Revolution", "Renaissance", "Ancient Rome"],
    hardFallback: ["Defenestrations of Prague", "Year of the Four Emperors", "Council of Trent", "Investiture Controversy"],
  },
  {
    label: "Inventions",
    wikiCategories: ["Inventions"],
    fallback: ["Telephone", "Printing press", "Light bulb", "Airplane", "Penicillin", "Television", "Photography", "Wheel"],
    easyFallback: ["Telephone", "Light bulb", "Airplane", "Television", "Wheel"],
    hardFallback: ["Astrolabe", "Cotton gin", "Spinning jenny", "Daguerreotype", "Stirling engine"],
  },
  {
    label: "Life",
    wikiCategories: ["Biology", "Life"],
    fallback: ["DNA", "Cell (biology)", "Evolution", "Photosynthesis", "Bacteria", "Virus", "Ecosystem", "Genetics"],
    easyFallback: ["DNA", "Evolution", "Bacteria", "Virus", "Photosynthesis"],
    hardFallback: ["Apoptosis", "Endoplasmic reticulum", "Chemiosmosis", "Telomerase", "Operon"],
  },
  {
    label: "Literature",
    wikiCategories: ["Literature", "Novels"],
    fallback: ["William Shakespeare", "Don Quixote", "Jane Austen", "Leo Tolstoy", "Moby-Dick", "Homer", "Franz Kafka", "Poetry"],
    easyFallback: ["William Shakespeare", "Harry Potter", "Jane Austen", "Charles Dickens", "Mark Twain"],
    hardFallback: ["Anacrusis", "Synecdoche", "Zeugma", "Catachresis", "Paratext"],
  },
  {
    label: "Mathematics",
    wikiCategories: ["Mathematics"],
    fallback: ["Pi", "Euclid", "Calculus", "Prime number", "Pythagorean theorem", "Fibonacci sequence", "Geometry", "Isaac Newton"],
    easyFallback: ["Pi", "Calculus", "Prime number", "Geometry", "Pythagorean theorem"],
    hardFallback: ["Galois theory", "Sheaf (mathematics)", "Mandelbrot set", "Riemann hypothesis", "Topos"],
  },
  {
    label: "Medicine and Health",
    wikiCategories: ["Medicine", "Health"],
    fallback: ["Vaccine", "Antibiotic", "Heart", "Cancer", "Surgery", "Hippocrates", "Penicillin", "Insulin"],
    easyFallback: ["Vaccine", "Heart", "Cancer", "Surgery", "Antibiotic"],
    hardFallback: ["Trepanation", "Cushing's syndrome", "Gleevec", "Apgar score", "Köbner phenomenon"],
  },
  {
    label: "Music",
    wikiCategories: ["Music", "Musicians"],
    fallback: ["The Beatles", "Mozart", "Jazz", "Beyoncé", "Hip hop music", "Bob Dylan", "Piano", "Symphony"],
    easyFallback: ["Taylor Swift", "The Beatles", "Beyoncé", "Drake (musician)", "Ed Sheeran", "Adele", "Eminem"],
    hardFallback: ["Anacrusis", "Hemiola", "Ostinato", "Mensuration canon", "Pierre Boulez", "Gesualdo"],
  },
  {
    label: "Mythology",
    wikiCategories: ["Mythology"],
    fallback: ["Zeus", "Norse mythology", "Egyptian mythology", "Thor", "Odin", "Greek mythology", "Hercules", "Anubis"],
    easyFallback: ["Zeus", "Thor", "Hercules", "Odin", "Anubis"],
    hardFallback: ["Tiamat", "Quetzalcoatl", "Susanoo-no-Mikoto", "Bragi", "Geb"],
  },
  {
    label: "Nature",
    wikiCategories: ["Nature"],
    fallback: ["Forest", "Coral reef", "Tundra", "Rainforest", "Wildflower", "Mountain", "Desert", "River"],
    easyFallback: ["Forest", "Mountain", "Desert", "River", "Rainforest"],
    hardFallback: ["Salt marsh", "Riparian zone", "Pingo", "Yardang", "Inselberg"],
  },
  {
    label: "People",
    wikiCategories: [
      "Nobel laureates",
      "Heads of state",
      "American film actors",
      "English-language singers",
      "Association football players",
    ],
    fallback: [
      "Albert Einstein", "Leonardo da Vinci", "Marie Curie", "Nelson Mandela",
      "Cleopatra", "Mahatma Gandhi", "William Shakespeare", "Abraham Lincoln",
      "Frida Kahlo", "Steve Jobs", "Oprah Winfrey", "Muhammad Ali",
      "Beyoncé", "Stephen Hawking", "Pelé", "Queen Elizabeth II",
    ],
    easyFallback: [
      "Taylor Swift", "Beyoncé", "Cristiano Ronaldo", "Lionel Messi",
      "Albert Einstein", "Barack Obama", "Elon Musk", "Oprah Winfrey",
      "LeBron James", "Tom Hanks",
    ],
    hardFallback: [
      "George Michael", "Maria Sibylla Merian", "Hedy Lamarr",
      "Tu Youyou", "Wangari Maathai", "Norman Borlaug",
      "Olaudah Equiano", "Ada Lovelace",
    ],
  },
  {
    label: "Philosophy",
    wikiCategories: ["Philosophy", "Philosophers"],
    fallback: ["Plato", "Aristotle", "Friedrich Nietzsche", "Stoicism", "Existentialism", "Immanuel Kant", "Confucius", "René Descartes"],
    easyFallback: ["Plato", "Aristotle", "Friedrich Nietzsche", "Confucius", "Socrates"],
    hardFallback: ["Phenomenology (philosophy)", "Quine–Putnam indispensability argument", "Modal realism", "Eliminative materialism"],
  },
  {
    label: "Politics",
    wikiCategories: ["Politics"],
    fallback: ["Democracy", "United Nations", "European Union", "Karl Marx", "Constitution", "Diplomacy", "Nelson Mandela", "Winston Churchill"],
    easyFallback: ["Democracy", "United Nations", "European Union", "Nelson Mandela", "Winston Churchill"],
    hardFallback: ["Gerrymandering", "Filibuster", "Cloture", "Subsidiarity", "Realpolitik"],
  },
  {
    label: "Religion",
    wikiCategories: ["Religion"],
    fallback: ["Christianity", "Islam", "Buddhism", "Hinduism", "Judaism", "Bible", "Vatican City", "Dalai Lama"],
    easyFallback: ["Christianity", "Islam", "Buddhism", "Hinduism", "Judaism"],
    hardFallback: ["Manichaeism", "Zoroastrianism", "Jainism", "Sufism", "Gnosticism"],
  },
  {
    label: "Science",
    wikiCategories: ["Science"],
    fallback: ["Albert Einstein", "Quantum mechanics", "Periodic table", "Marie Curie", "Theory of relativity", "DNA", "Big Bang", "Charles Darwin"],
    easyFallback: ["Albert Einstein", "DNA", "Big Bang", "Periodic table", "Charles Darwin"],
    hardFallback: ["Bose–Einstein condensate", "Yukawa potential", "Cherenkov radiation", "Pauli exclusion principle"],
  },
  {
    label: "Space",
    wikiCategories: ["Outer space", "Astronomy"],
    fallback: ["Moon", "Mars", "Jupiter", "Black hole", "Apollo 11", "International Space Station", "Solar System", "Hubble Space Telescope"],
    easyFallback: ["Moon", "Mars", "Jupiter", "Black hole", "Solar System"],
    hardFallback: ["Magnetar", "Quasar", "Bok globule", "Lagrangian point", "Heliopause"],
  },
  {
    label: "Sports",
    wikiCategories: ["Sports"],
    fallback: ["Association football", "Olympic Games", "Basketball", "Tennis", "Cricket", "Michael Jordan", "FIFA World Cup", "Formula One"],
    easyFallback: ["Association football", "Basketball", "Tennis", "Cristiano Ronaldo", "LeBron James", "Olympic Games"],
    hardFallback: ["Sepak takraw", "Hurling", "Pelota", "Korfball", "Bandy"],
  },
  {
    label: "Technology",
    wikiCategories: ["Technology"],
    fallback: ["Smartphone", "Artificial intelligence", "Electric car", "3D printing", "Robotics", "Solar panel", "Nanotechnology", "Blockchain"],
    easyFallback: ["Smartphone", "Artificial intelligence", "Electric car", "Robotics", "Blockchain"],
    hardFallback: ["Memristor", "Photolithography", "MOSFET", "Quantum tunnelling", "Spintronics"],
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
    easyFallback: ["Bicycle", "Train", "Automobile", "Airplane", "Ship"],
    hardFallback: ["Funicular", "Monorail", "Hovercraft", "Maglev", "Trolleybus"],
  },
  {
    label: "Universe",
    wikiCategories: ["Universe", "Cosmology"],
    fallback: ["Big Bang", "Galaxy", "Dark matter", "Black hole", "Milky Way", "Cosmic microwave background", "Andromeda Galaxy", "Multiverse"],
    easyFallback: ["Big Bang", "Galaxy", "Dark matter", "Black hole", "Milky Way"],
    hardFallback: ["Inflaton", "Wheeler–DeWitt equation", "Vacuum decay", "Heat death of the universe"],
  },
  {
    label: "Wars",
    wikiCategories: ["Wars", "Military history"],
    fallback: ["World War I", "World War II", "Vietnam War", "American Civil War", "Napoleonic Wars", "Cold War", "Crusades", "Battle of Waterloo"],
    easyFallback: ["World War I", "World War II", "Vietnam War", "American Civil War", "Cold War"],
    hardFallback: ["War of the Spanish Succession", "Russo-Japanese War", "Paraguayan War", "Boshin War", "Punic Wars"],
  },
];

export const CATEGORY_LABELS = CATEGORIES.map((c) => c.label);

/** Hand-picked categories surfaced at the top of the dropdown — these are the
 *  themes we expect most players to reach for first. */
export const POPULAR_CATEGORY_LABELS = [
  "People",
  "Wars",
  "Music",
  "Food and Drink",
  "Sports",
  "Film and TV",
] as const;

export const POPULAR_CATEGORIES = POPULAR_CATEGORY_LABELS
  .map((label) => CATEGORIES.find((c) => c.label === label))
  .filter((c): c is CategoryDef => Boolean(c));

export const OTHER_CATEGORIES = CATEGORIES
  .filter((c) => !(POPULAR_CATEGORY_LABELS as readonly string[]).includes(c.label))
  .sort((a, b) => a.label.localeCompare(b.label));

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

/** Approximate last-30-days views for a title via per-article daily endpoint. */
async function getMonthlyViews(title: string): Promise<number> {
  const end = new Date();
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
      d.getUTCDate()
    ).padStart(2, "0")}`;
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(
    title.replace(/ /g, "_")
  )}/daily/${fmt(start)}/${fmt(end)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return -1;
    const json = await res.json();
    const items: { views: number }[] = json?.items ?? [];
    return items.reduce((a, b) => a + (b.views || 0), 0);
  } catch {
    return -1;
  }
}

/**
 * Pick a random article title from the given category, respecting difficulty:
 *   easy   — high pageviews (≥ 50k/month) or fall back to easyFallback
 *   normal — anything (default behaviour)
 *   hard   — low pageviews (< 5k/month) or fall back to hardFallback
 */
export async function getTitleForCategory(
  label: string,
  difficulty: "easy" | "normal" | "hard" = "normal"
): Promise<string> {
  const def = CATEGORIES.find((c) => c.label === label);
  if (!def) throw new Error(`Unknown category: ${label}`);

  // Choose curated fallback to use if live filtering fails.
  const curated =
    difficulty === "easy" && def.easyFallback?.length
      ? def.easyFallback
      : difficulty === "hard" && def.hardFallback?.length
        ? def.hardFallback
        : def.fallback;

  const live = await fetchPoolFor(def);

  // Normal: keep behaviour as before — random from live pool or curated.
  if (difficulty === "normal") {
    const pool = live.length >= 5 ? live : curated;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Easy/Hard: rejection-sample from the live pool against pageviews.
  const EASY_MIN_VIEWS = 50_000;
  const HARD_MAX_VIEWS = 5_000;
  if (live.length >= 10) {
    // Shuffle a copy and probe up to 6 candidates.
    const candidates = [...live].sort(() => Math.random() - 0.5).slice(0, 6);
    for (const title of candidates) {
      const views = await getMonthlyViews(title);
      if (views < 0) continue; // pageviews API failed for this title
      if (difficulty === "easy" && views >= EASY_MIN_VIEWS) return title;
      if (difficulty === "hard" && views > 0 && views < HARD_MAX_VIEWS) return title;
    }
    // No candidate passed the filter — fall through to curated tier list.
  }

  return curated[Math.floor(Math.random() * curated.length)];
}
