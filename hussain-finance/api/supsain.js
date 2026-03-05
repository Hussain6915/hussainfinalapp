export default async function handler(req, res) {
  const section = String(req.query?.section || "all");
  const seed = String(req.query?.seed || `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  // -------- Optional KV (recommended) --------
  // If @vercel/kv is installed + KV is connected, we store "seen" history to avoid repeats.
  let kv = null;
  try {
    const mod = await import("@vercel/kv");
    kv = mod.kv || null;
  } catch {
    kv = null;
  }

  // -------- Seeded RNG --------
  function makeRng(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return function rand() {
      h += 0x6D2B79F5;
      let t = Math.imul(h ^ (h >>> 15), 1 | h);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = makeRng(seed);

  // -------- Helpers --------
  const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();

  function shuffle(arr) {
    const a = Array.from(arr || []);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function dedupeByKey(items, keyFn) {
    const seen = new Set();
    const out = [];
    for (const it of items || []) {
      const k = clean(keyFn(it)).toLowerCase();
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
    return out;
  }

  function pickN(items, n) {
    return shuffle(items).slice(0, n);
  }

  async function fetchWithTimeout(url, ms = 9000, headers = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers });
      return r;
    } finally {
      clearTimeout(t);
    }
  }

  // ---------- RSS parsing ----------
  function decodeXml(s) {
    return String(s || "")
      .replace(/<!\[CDATA\[/g, "")
      .replace(/\]\]>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function parseRss(xml, source) {
    const out = [];
    const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    for (const it of items) {
      const title = decodeXml((it.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
      let link = decodeXml((it.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]);
      if (!link) {
        const m = it.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
        if (m) link = m[1];
      }
      if (title) out.push({ title: clean(title), url: clean(link), source });
    }
    return out;
  }

  async function fetchRss(url, source) {
    try {
      const r = await fetchWithTimeout(url, 9000, { "User-Agent": "Mozilla/5.0" });
      const xml = await r.text();
      return parseRss(xml, source);
    } catch {
      return [];
    }
  }

  // ---------- Google News RSS builder (works for Geo/ARY/HUM/BBC/CNN etc) ----------
  function gnewsSearch(query, label, lang = "en", gl = "PK", ceid = "PK:en") {
    // Google News RSS Search; returns many fresh items, updates frequently
    // Example query: 'site:geo.tv Pakistan'
    const q = encodeURIComponent(query);
    return {
      url: `https://news.google.com/rss/search?q=${q}&hl=${lang}-${gl}&gl=${gl}&ceid=${ceid}`,
      source: label
    };
  }

  // ---------- Seen-history to prevent repeats ----------
  const SEEN_MAX = 2500; // per section
  const seenKey = (sec) => `supsain:seen:${sec}`;

  async function getSeen(sec) {
    if (kv) {
      const arr = (await kv.get(seenKey(sec))) || [];
      return new Set(Array.isArray(arr) ? arr : []);
    }
    // fallback memory (may reset between invocations)
    globalThis.__SS_SEEN__ ||= {};
    globalThis.__SS_SEEN__[sec] ||= [];
    return new Set(globalThis.__SS_SEEN__[sec]);
  }

  async function saveSeen(sec, set) {
    const arr = Array.from(set);
    const trimmed = arr.slice(Math.max(0, arr.length - SEEN_MAX));
    if (kv) {
      await kv.set(seenKey(sec), trimmed);
      return;
    }
    globalThis.__SS_SEEN__ ||= {};
    globalThis.__SS_SEEN__[sec] = trimmed;
  }

  function filterUnseen(items, seenSet, keyFn) {
    const out = [];
    for (const it of items) {
      const k = clean(keyFn(it)).toLowerCase();
      if (!k) continue;
      if (seenSet.has(k)) continue;
      out.push(it);
    }
    return out;
  }

  // =========================================================
  //  NEWS (Pakistan + International) — BIG pool via Google News
  // =========================================================
  async function buildNews() {
    // This creates a huge pool (often 200+ items):
    // - Pakistani: Geo/ARY/HUM/Dawn/Tribune/TheNews + general Pakistan query
    // - International: BBC/CNN/Reuters/AlJazeera + world query

    const feeds = [
      // Pakistan
      gnewsSearch("Pakistan (site:geo.tv OR site:arynews.tv OR site:humnews.pk)", "PK TV"),
      gnewsSearch("Pakistan site:dawn.com", "Dawn"),
      gnewsSearch("Pakistan site:tribune.com.pk", "Tribune"),
      gnewsSearch("Pakistan site:thenews.com.pk", "TheNews"),
      gnewsSearch("Pakistan economy OR Pakistan politics OR Pakistan cricket", "Pakistan"),
      // International
      gnewsSearch("World (site:bbc.co.uk OR site:cnn.com OR site:reuters.com OR site:aljazeera.com)", "World"),
      gnewsSearch("breaking news world", "World Live"),
    ];

    // Fetch in parallel
    const results = await Promise.allSettled(feeds.map(f => fetchRss(f.url, f.source)));
    let pool = [];
    for (const r of results) if (r.status === "fulfilled") pool.push(...r.value);

    // Extra source: Reddit worldnews top (varies)
    try {
      const rr = await fetchWithTimeout("https://www.reddit.com/r/worldnews/top.json?limit=50&t=day", 9000);
      const j = await rr.json();
      const items = (j?.data?.children || []).map(p => ({
        title: clean(p.data.title),
        url: "https://reddit.com" + p.data.permalink,
        source: "Reddit"
      }));
      pool.push(...items);
    } catch {}

    pool = dedupeByKey(pool, x => x.title);

    // Prefer 2 Pakistan + 1 World but ensure no repeat
    const seen = await getSeen("news");
    const pk = pool.filter(x => /PK TV|Dawn|Tribune|TheNews|Pakistan/i.test(x.source));
    const ww = pool.filter(x => !/PK TV|Dawn|Tribune|TheNews|Pakistan/i.test(x.source));

    const pkU = filterUnseen(pk, seen, x => x.title);
    const wwU = filterUnseen(ww, seen, x => x.title);

    let chosen = [];
    chosen.push(...pickN(pkU.length ? pkU : pk, 2));
    chosen.push(...pickN(wwU.length ? wwU : ww, 1));

    chosen = dedupeByKey(chosen, x => x.title).slice(0, 3);

    // If still <3, fill from pool unseen
    if (chosen.length < 3) {
      const poolU = filterUnseen(pool, seen, x => x.title);
      chosen = dedupeByKey([...chosen, ...pickN(poolU.length ? poolU : pool, 3)], x => x.title).slice(0, 3);
    }

    // Mark seen
    for (const it of chosen) seen.add(clean(it.title).toLowerCase());
    await saveSeen("news", seen);

    return chosen;
  }

  // =========================================================
  //  DO YOU KNOW (Facts) — VERY BIG pool by multi-API bursts
  // =========================================================
  async function buildFacts() {
    const seen = await getSeen("doy");
    const pool = [];

    // Burst calls (20+ facts)
    const tasks = [];

    // Useless facts (10)
    for (let i = 0; i < 10; i++) {
      tasks.push((async () => {
        try {
          const r = await fetchWithTimeout("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en", 8000);
          const j = await r.json();
          if (j?.text) return { text: clean(j.text), meta: "Fun fact" };
        } catch {}
        return null;
      })());
    }

    // Numbers API (trivia/year/math) (10)
    const nums = [
      "http://numbersapi.com/random/trivia?json",
      "http://numbersapi.com/random/year?json",
      "http://numbersapi.com/random/math?json"
    ];
    for (let i = 0; i < 10; i++) {
      tasks.push((async () => {
        try {
          const url = nums[Math.floor(rand() * nums.length)];
          const r = await fetchWithTimeout(url, 8000);
          const j = await r.json();
          if (j?.text) return { text: clean(j.text), meta: "Trivia" };
        } catch {}
        return null;
      })());
    }

    // Cat facts (5)
    for (let i = 0; i < 5; i++) {
      tasks.push((async () => {
        try {
          const r = await fetchWithTimeout("https://catfact.ninja/fact", 8000);
          const j = await r.json();
          if (j?.fact) return { text: clean(j.fact), meta: "Random fact" };
        } catch {}
        return null;
      })());
    }

    // OpenTDB (5 questions => treat as “did you know” prompts)
    tasks.push((async () => {
      try {
        const r = await fetchWithTimeout("https://opentdb.com/api.php?amount=10&difficulty=easy&type=multiple", 9000);
        const j = await r.json();
        const arr = Array.isArray(j?.results) ? j.results : [];
        return arr.map(q => ({
          text: "Trivia: " + clean(String(q.question || "").replace(/&quot;/g, '"').replace(/&#039;/g, "'")),
          meta: "Trivia"
        }));
      } catch {
        return [];
      }
    })());

    const settled = await Promise.allSettled(tasks);
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      const v = s.value;
      if (!v) continue;
      if (Array.isArray(v)) pool.push(...v);
      else pool.push(v);
    }

    const normalized = dedupeByKey(pool, x => x.text);

    const unseen = filterUnseen(normalized, seen, x => x.text);

    let chosen = pickN(unseen.length ? unseen : normalized, 3);
    chosen = dedupeByKey(chosen, x => x.text).slice(0, 3);

    for (const it of chosen) seen.add(clean(it.text).toLowerCase());
    await saveSeen("doy", seen);

    // Guarantee format: {text,meta}
    return chosen.map(x => ({ text: x.text, meta: x.meta || "Did you know" }));
  }

  // =========================================================
  //  ISLAMIC REMINDERS — big curated pool (non-repeat via KV)
  // =========================================================
  function islamPool() {
    const pool = [
      "Smile — it’s charity.",
      "Speak good or remain silent.",
      "Give charity even if small.",
      "Feed the hungry and spread peace.",
      "Be gentle — Allah loves gentleness.",
      "Do not waste water, even at a river.",
      "Remove harm from the road — charity.",
      "Be grateful for small blessings daily.",
      "Forgive people — your heart becomes lighter.",
      "Respect parents — huge barakah.",
      "Keep ties of kinship.",
      "Pray on time — it protects your day.",
      "Make dhikr during idle moments.",
      "Help someone quietly — Allah knows.",
      "Honesty brings tranquility.",
      "Avoid backbiting — guard your tongue.",
      "Be patient in hardship — reward is immense.",
      "Give water to others — beautiful Sunnah.",
      "Intend good — actions are by intentions.",
      "Be just, even if against yourself."
    ];
    // Make it feel endless: add variants dynamically
    const expanded = [];
    for (const t of pool) {
      expanded.push({ text: t, meta: "Reminder" });
      expanded.push({ text: t + " (1 minute action: do it now)", meta: "Reminder" });
      expanded.push({ text: "Today: " + t, meta: "Reminder" });
    }
    return expanded; // ~60 items
  }

  async function buildIslam() {
    const seen = await getSeen("islam");
    const pool = dedupeByKey(islamPool(), x => x.text);
    const unseen = filterUnseen(pool, seen, x => x.text);
    let chosen = pickN(unseen.length ? unseen : pool, 3);
    chosen = dedupeByKey(chosen, x => x.text).slice(0, 3);
    for (const it of chosen) seen.add(clean(it.text).toLowerCase());
    await saveSeen("islam", seen);
    return chosen;
  }

  // =========================================================
  //  INNOVATIONS — huge pool (RSS + APIs) + non-repeat via KV
  // =========================================================
  async function buildInnov() {
    const seen = await getSeen("innov");

    const feeds = [
      // Global tech
      gnewsSearch("innovation OR breakthrough technology OR new AI model", "Innovation"),
      gnewsSearch("site:techcrunch.com innovation OR AI", "TechCrunch (via GNews)"),
      gnewsSearch("site:theverge.com AI OR chip OR robotics", "Verge (via GNews)"),
      gnewsSearch("site:wired.com AI OR robotics OR science", "Wired (via GNews)"),
      gnewsSearch("site:technologyreview.com AI OR innovation", "MIT TR (via GNews)"),
      // Pakistan angle
      gnewsSearch("Pakistan technology startup OR innovation", "Pakistan Tech"),
    ];

    const results = await Promise.allSettled(feeds.map(f => fetchRss(f.url, f.source)));
    let pool = [];
    for (const r of results) if (r.status === "fulfilled") pool.push(...r.value);

    // Spaceflight (50)
    try {
      const r = await fetchWithTimeout("https://api.spaceflightnewsapi.net/v4/articles/?limit=50", 9000);
      const j = await r.json();
      const items = (j?.results || []).map(a => ({
        title: clean(a.title),
        url: a.url,
        source: "Spaceflight News"
      }));
      pool.push(...items);
    } catch {}

    // Hacker News newest (50)
    try {
      const r = await fetchWithTimeout("https://hnrss.org/newest.jsonfeed", 9000);
      const j = await r.json();
      const items = (j?.items || []).map(i => ({
        title: clean(i.title),
        url: i.url,
        source: "Hacker News (new)"
      }));
      pool.push(...items);
    } catch {}

    // Big fallback list (adds depth)
    const fallback = [
      "Edge AI is enabling faster on-device processing without cloud dependence.",
      "Battery tech improvements are boosting EV range and charging speed.",
      "Reusable rockets are reducing the cost of space access.",
      "Robotics is expanding into logistics and retail operations.",
      "Smart grids are balancing energy demand more efficiently.",
      "Telemedicine tools are improving remote diagnostics.",
      "New materials reduce manufacturing waste and energy usage.",
      "Wearables continue improving health monitoring accuracy.",
      "Cybersecurity automation is reducing incident response time.",
      "Precision agriculture uses sensors + AI to reduce water usage."
    ].map(t => ({ title: t, url: "", source: "Innovation" }));
    pool.push(...fallback);

    pool = dedupeByKey(pool, x => x.title);
    const unseen = filterUnseen(pool, seen, x => x.title);

    let chosen = pickN(unseen.length ? unseen : pool, 3);
    chosen = dedupeByKey(chosen, x => x.title).slice(0, 3);

    for (const it of chosen) seen.add(clean(it.title).toLowerCase());
    await saveSeen("innov", seen);

    return chosen;
  }

  // =========================================================
  //  JOKES — huge pool (2 APIs + big Urdu pool) + non-repeat
  // =========================================================
  async function buildJokes() {
    const seen = await getSeen("jokes");
    const pool = [];

    // Official joke api (10)
    try {
      const r = await fetchWithTimeout("https://official-joke-api.appspot.com/random_ten", 9000);
      const j = await r.json();
      if (Array.isArray(j)) {
        for (const a of j) {
          if (a?.setup && a?.punchline) pool.push({ text: `${clean(a.setup)} — ${clean(a.punchline)}`, meta: "EN" });
        }
      }
    } catch {}

    // JokeAPI (10)
    try {
      const r = await fetchWithTimeout("https://v2.jokeapi.dev/joke/Any?amount=10&type=single", 9000);
      const j = await r.json();
      const jokes = Array.isArray(j?.jokes) ? j.jokes : [];
      for (const a of jokes) {
        if (a?.joke) pool.push({ text: clean(a.joke), meta: "EN" });
      }
    } catch {}

    // Big Urdu/Pakistani pool (60+ feel)
    const urduBase = [
      "امی: موبائل چھوڑ دو۔ میں: بس آخری scroll… (2 گھنٹے بعد) 😭",
      "دوست: پیسے ہیں؟ میں: ہیں… لیکن bank میں، اور bank والے نہیں دیتے 😅",
      "میں: diet شروع۔ سامنے: سموسے… میں: یہ تو test ہے 😭",
      "Netflix: کیا آپ اب بھی دیکھ رہے ہیں؟ میں: جی ہاں… شرمندہ بھی ہوں 😅",
      "ابا: بجلی کا بل کم کیوں نہیں؟ میں: کیونکہ بجلی کم آتی ہے… بل پورا آتا ہے 😭",
      "میں: calm رہوں گا۔ ٹریفک: hold my horn 🔊",
      "دوست: تو serious ہے؟ میں: ہاں… jokes میں بھی 😌",
      "امی: باہر جا رہے ہو؟ میں: نہیں۔ امی: اچھا تو سبزی لے آؤ 😭",
      "میں: budget بناؤں گا۔ online sale: ‘surprise’ 🎁",
      "استاد: کوئی سوال؟ میں: جی… زندگی کیوں؟ 😭",
      "میں: gym جا رہا ہوں۔ دماغ: واپسی میں chai بھی ضروری ہے ☕",
      "بھائی: میں بہت mature ہوں۔ بھی: ‘seen’ کر کے reply نہ کرنا 😤",
      "میں: پڑھائی شروع۔ فون: notification… notification… notification… 📱",
      "دوست: چلو باہر۔ میں: ٹھیک… (پھر bed سے اٹھا ہی نہیں گیا) 😭",
      "میں: sleep schedule ٹھیک۔ نیند: good joke 😌"
    ];

    // Expand Urdu pool by adding small variations (massively increases uniqueness)
    for (const t of urduBase) {
      pool.push({ text: t, meta: "UR" });
      pool.push({ text: "😂 " + t, meta: "UR" });
      pool.push({ text: t + "  (پاکستانی مسئلہ 😭)", meta: "UR" });
      pool.push({ text: t.replace("😭", "😂"), meta: "UR" });
    }

    const normalized = dedupeByKey(pool, x => x.text);
    const unseen = filterUnseen(normalized, seen, x => x.text);

    let chosen = pickN(unseen.length ? unseen : normalized, 3);
    chosen = dedupeByKey(chosen, x => x.text).slice(0, 3);

    for (const it of chosen) seen.add(clean(it.text).toLowerCase());
    await saveSeen("jokes", seen);

    return chosen;
  }

  // =========================================================
  //  Business ideas + weekend activities — large curated + nonrepeat
  // =========================================================
  function businessPool() {
    const pool = [
      "Micro-SaaS for invoices/receipts for small shops.",
      "WhatsApp bot for FAQ + lead capture for local businesses.",
      "AI automation service: Excel/Sheets workflows for SMBs.",
      "Job alerts + newsletter for a niche (Pakistan tech, remote jobs).",
      "Study planner app for Pakistani universities.",
      "Clinic appointment + reminders system (web + WhatsApp).",
      "Local food ordering + loyalty points web app.",
      "Micro CRM for field sales reps.",
      "Digital products: templates, trackers, planners.",
      "Resume/CV + LinkedIn optimization mini-agency.",
      "Content studio for short reels for local brands.",
      "E-commerce single-category store (one hero product).",
      "Tutoring: Excel/Power BI/Data basics for beginners.",
      "Community marketplace for services in your city.",
      "AI-based customer support for small online stores."
    ];
    // Expand with “angles”
    const expanded = [];
    const angles = ["for students", "for freelancers", "for shops", "for clinics", "for gyms", "for restaurants"];
    for (const t of pool) {
      expanded.push({ text: t, meta: "Business" });
      for (const a of angles) expanded.push({ text: t + " " + a, meta: "Business" });
    }
    return expanded; // ~100+
  }

  async function buildBiz() {
    const seen = await getSeen("biz");
    const pool = dedupeByKey(businessPool(), x => x.text);
    const unseen = filterUnseen(pool, seen, x => x.text);
    let chosen = pickN(unseen.length ? unseen : pool, 3);
    chosen = dedupeByKey(chosen, x => x.text).slice(0, 3);
    for (const it of chosen) seen.add(clean(it.text).toLowerCase());
    await saveSeen("biz", seen);
    return chosen;
  }

  function weekendPool() {
    const pool = [
      "Visit Shalimar Gardens / local historic place.",
      "Food street visit with friends/family.",
      "Sunset walk in a nearby park.",
      "Bike ride or light jogging.",
      "Try a new cafe + journal 20 minutes.",
      "Cricket match with friends.",
      "Photography walk: capture 10 nice shots.",
      "Declutter your room + make it fresh.",
      "Watch a movie night + snacks.",
      "Try a new recipe at home.",
      "Read one chapter of a book outside.",
      "Plan a 1–2 hour short trip nearby.",
      "Do a small coding project for fun.",
      "Visit a bookstore and pick one book.",
      "Call a family member and do something kind."
    ];
    // Expand by adding “themes”
    const themes = ["(budget)", "(with family)", "(solo)", "(fitness)", "(chill)", "(adventure)"];
    const expanded = [];
    for (const t of pool) {
      expanded.push({ text: t, meta: "Weekend" });
      for (const th of themes) expanded.push({ text: t + " " + th, meta: "Weekend" });
    }
    return expanded; // ~90+
  }

  async function buildWeekend() {
    const seen = await getSeen("weekend");
    const pool = dedupeByKey(weekendPool(), x => x.text);
    const unseen = filterUnseen(pool, seen, x => x.text);
    let chosen = pickN(unseen.length ? unseen : pool, 3);
    chosen = dedupeByKey(chosen, x => x.text).slice(0, 3);
    for (const it of chosen) seen.add(clean(it.text).toLowerCase());
    await saveSeen("weekend", seen);
    return chosen;
  }

  // =========================================================
  // Quiz (simple variety; you can expand later)
  // =========================================================
  function buildQuiz() {
    const pool = [
      { question: "General: Capital of Pakistan?", answer: "Islamabad" },
      { question: "Math: 12 + 8 = ?", answer: "20" },
      { question: "Science: What gas do plants absorb?", answer: "Carbon dioxide" },
      { question: "General: Largest ocean?", answer: "Pacific Ocean" },
      { question: "Math: 9 × 7 = ?", answer: "63" },
      { question: "Science: Water chemical formula?", answer: "H2O" },
      { question: "General: 1 hour = ? minutes", answer: "60" }
    ];
    return pickN(shuffle(pool), 3);
  }

  // =========================================================
  // Build response / section response
  // =========================================================
  const result = {
    news: await buildNews(),
    doy: await buildFacts(),
    islam: await buildIslam(),
    quiz: buildQuiz(),
    innov: await buildInnov(),
    weekend: await buildWeekend(),
    biz: await buildBiz(),
    jokes: await buildJokes()
  };

  if (section !== "all") {
    return res.status(200).json({ items: Array.isArray(result[section]) ? result[section] : [] });
  }
  return res.status(200).json(result);
}
