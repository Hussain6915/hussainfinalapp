export default async function handler(req, res) {
  // IMPORTANT: No app.js changes required

  const section = String(req.query?.section || "all");

  // Ensure no caching (fresh each refresh)
  res.setHeader("Cache-Control", "no-store, max-age=0");

  /* ---------------- helpers ---------------- */
  const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();

  function shuffle(arr) {
    const a = Array.from(arr || []);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function dedupeBy(items, keyFn) {
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

  async function fetchWithTimeout(url, ms = 6500) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0" }
      });
    } finally {
      clearTimeout(t);
    }
  }

  // Hard deadline so API never keeps your UI spinning forever
  async function withDeadline(promise, ms, fallback) {
    return await Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
    ]);
  }

  /* ---------------- RSS parsing ---------------- */
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
      const r = await fetchWithTimeout(url, 6500);
      const xml = await r.text();
      return parseRss(xml, source);
    } catch {
      return [];
    }
  }

  // Google News RSS search (reliable + updates constantly)
  function gnews(query, label, lang = "en", gl = "PK", ceid = "PK:en") {
    const q = encodeURIComponent(query);
    return {
      url: `https://news.google.com/rss/search?q=${q}&hl=${lang}-${gl}&gl=${gl}&ceid=${ceid}`,
      source: label
    };
  }

  /* ---------------- BUILDERS ---------------- */

  async function buildNews() {
    // Strong & reliable approach:
    // Google News search includes Geo/ARY/HUM etc via site filters (no direct RSS dependency).
    const feeds = [
      gnews("site:geo.tv Pakistan OR site:arynews.tv Pakistan OR site:humnews.pk Pakistan", "PK TV"),
      gnews("site:dawn.com Pakistan", "Dawn"),
      gnews("site:tribune.com.pk Pakistan", "Tribune"),
      gnews("site:thenews.com.pk Pakistan", "TheNews"),
      gnews("site:bbc.co.uk world OR site:cnn.com world OR site:reuters.com world", "World"),
      gnews("breaking news world", "World Live")
    ];

    const fallback = [
      { title: "Pakistan: fresh headlines unavailable — try refresh again.", url: "", source: "Sup’ Sain" },
      { title: "World: fresh headlines unavailable — try refresh again.", url: "", source: "Sup’ Sain" },
      { title: "Tip: your network may be slow; Sup’ Sain will still return.", url: "", source: "Sup’ Sain" }
    ];

    const lists = await Promise.all(
      feeds.map((f) => fetchRss(f.url, f.source))
    );

    let pool = dedupeBy(lists.flat(), (x) => x.title);

    // Prefer 2 Pakistan + 1 World, but never fail
    const pk = pool.filter((x) => /PK TV|Dawn|Tribune|TheNews/i.test(x.source));
    const ww = pool.filter((x) => !/PK TV|Dawn|Tribune|TheNews/i.test(x.source));

    let chosen = [];
    chosen.push(...pickN(pk.length ? pk : pool, 2));
    chosen.push(...pickN(ww.length ? ww : pool, 1));
    chosen = dedupeBy(chosen, (x) => x.title).slice(0, 3);

    if (chosen.length < 3) chosen = pickN(pool.length ? pool : fallback, 3);
    return chosen;
  }

  async function buildFacts() {
    const fallback = [
      { text: "A day on Venus is longer than its year.", meta: "Mind-blown" },
      { text: "Honey never spoils.", meta: "Life" },
      { text: "Octopus have three hearts.", meta: "Science" }
    ];

    const tasks = [];

    // 6 useless facts
    for (let i = 0; i < 6; i++) {
      tasks.push((async () => {
        try {
          const r = await fetchWithTimeout("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en", 5000);
          const j = await r.json();
          return j?.text ? { text: clean(j.text), meta: "Fun fact" } : null;
        } catch { return null; }
      })());
    }

    // 6 numbers facts
    const nums = [
      "http://numbersapi.com/random/trivia?json",
      "http://numbersapi.com/random/year?json",
      "http://numbersapi.com/random/math?json"
    ];
    for (let i = 0; i < 6; i++) {
      tasks.push((async () => {
        try {
          const url = nums[Math.floor(Math.random() * nums.length)];
          const r = await fetchWithTimeout(url, 5000);
          const j = await r.json();
          return j?.text ? { text: clean(j.text), meta: "Trivia" } : null;
        } catch { return null; }
      })());
    }

    const settled = await Promise.allSettled(tasks);
    const pool = [];
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) pool.push(s.value);
    }

    const out = pickN(dedupeBy(pool, (x) => x.text), 3);
    return out.length === 3 ? out : fallback;
  }

  function buildIslam() {
    // Big-ish pool (you can expand later; this already won’t get stuck)
    const pool = [
      { text: "Smile — it’s charity.", meta: "Hadith" },
      { text: "Speak good or remain silent.", meta: "Hadith" },
      { text: "Give charity even if small.", meta: "Hadith" },
      { text: "Do not waste water, even at a river.", meta: "Sunnah" },
      { text: "Feed the hungry and spread peace.", meta: "Hadith" },
      { text: "Respect parents — huge barakah.", meta: "Reminder" },
      { text: "Be patient in hardship.", meta: "Reminder" },
      { text: "Forgive people — your heart becomes lighter.", meta: "Reminder" },
      { text: "Keep your promises.", meta: "Reminder" },
      { text: "Help someone quietly — Allah knows.", meta: "Reminder" }
    ];
    return pickN(pool, 3);
  }

  function buildQuiz() {
    const pool = [
      { question: "General: Capital of Pakistan?", answer: "Islamabad" },
      { question: "Math: 9 × 7 = ?", answer: "63" },
      { question: "Science: Water chemical formula?", answer: "H2O" },
      { question: "General: Largest ocean?", answer: "Pacific Ocean" },
      { question: "Math: 12 + 18 = ?", answer: "30" },
      { question: "Science: Gas plants absorb?", answer: "Carbon dioxide" }
    ];
    return pickN(pool, 3);
  }

  async function buildInnov() {
    // Again use Google News search (reliable) + Spaceflight
    const feeds = [
      gnews("innovation breakthrough technology AI robotics chips", "Innovation"),
      gnews("Pakistan startup technology innovation", "Pakistan Tech"),
      gnews("site:techcrunch.com AI OR robotics OR chip", "TechCrunch"),
      gnews("site:theverge.com AI OR chip OR robotics", "Verge")
    ];

    const fallback = [
      { title: "AI copilots are being embedded into everyday work tools.", url: "", source: "Innovation" },
      { title: "Battery improvements are boosting EV range and charging speed.", url: "", source: "Innovation" },
      { title: "Robotics adoption is accelerating in logistics.", url: "", source: "Innovation" }
    ];

    const lists = await Promise.all(feeds.map((f) => fetchRss(f.url, f.source)));
    let pool = lists.flat();

    // Add Spaceflight (fast + fresh)
    try {
      const r = await fetchWithTimeout("https://api.spaceflightnewsapi.net/v4/articles/?limit=25", 6500);
      const j = await r.json();
      const extra = (j?.results || []).map((a) => ({
        title: clean(a.title),
        url: a.url,
        source: "Spaceflight News"
      }));
      pool.push(...extra);
    } catch {}

    pool = dedupeBy(pool, (x) => x.title);
    const out = pickN(pool, 3);
    return out.length === 3 ? out : fallback;
  }

  function buildWeekend() {
    const pool = [
      { text: "Visit a local historic place (e.g., Shalimar Gardens if in Lahore).", meta: "Pakistan" },
      { text: "Food street visit with friends/family.", meta: "Pakistan" },
      { text: "Go for a sunset walk in a nearby park.", meta: "Outdoor" },
      { text: "Bike ride or light jogging.", meta: "Fitness" },
      { text: "Watch a movie night + snacks.", meta: "Home" },
      { text: "Try a new cafe and journal for 20 minutes.", meta: "Chill" },
      { text: "Cricket match with friends.", meta: "Sports" },
      { text: "Photography walk: capture 10 shots.", meta: "Creative" },
      { text: "Declutter your room + make it feel fresh.", meta: "Life" },
      { text: "Learn a small skill: 1 guitar chord or mini coding task.", meta: "Skill" }
    ];
    return pickN(pool, 3);
  }

  function buildBiz() {
    const pool = [
      { text: "Micro-SaaS: invoices/receipts for small shops.", meta: "SaaS" },
      { text: "WhatsApp bot for FAQs + lead capture for local businesses.", meta: "Automation" },
      { text: "AI workflow service: spreadsheets + dashboards for SMBs.", meta: "Service" },
      { text: "Niche newsletter + sponsor ads (jobs/tech/cricket).", meta: "Content" },
      { text: "Study planner app for Pakistani universities.", meta: "App" },
      { text: "Clinic booking + reminders system.", meta: "SaaS" },
      { text: "Digital products: templates/trackers/planners.", meta: "Digital" },
      { text: "Content studio for reels/shorts for local brands.", meta: "Agency" },
      { text: "Single-category e-commerce store (one hero product).", meta: "Ecom" },
      { text: "Online tutoring: Excel/Power BI/Data basics.", meta: "Skills" }
    ];
    return pickN(pool, 3);
  }

  async function buildJokes() {
    const fallback = [
      { text: "Why don’t programmers like nature? Too many bugs.", meta: "EN" },
      { text: "I told my computer I needed a break… it froze.", meta: "EN" },
      { text: "امی: موبائل چھوڑ دو — میں: بس آخری scroll 😭", meta: "UR" }
    ];

    const pool = [];

    // Official Joke API
    try {
      const r = await fetchWithTimeout("https://official-joke-api.appspot.com/random_ten", 6500);
      const j = await r.json();
      if (Array.isArray(j)) {
        for (const a of j) {
          if (a?.setup && a?.punchline) pool.push({ text: `${clean(a.setup)} — ${clean(a.punchline)}`, meta: "EN" });
        }
      }
    } catch {}

    // Urdu/Pakistani pool (keeps it fresh even when APIs slow)
    const ur = [
      "امی: موبائل چھوڑ دو — میں: بس آخری scroll 😭",
      "دوست: پیسے ہیں؟ — میں: ہیں… bank میں، bank والے نہیں دیتے 😅",
      "میں: diet شروع — سامنے: سموسے… test ہے 😭",
      "Netflix: کیا آپ اب بھی دیکھ رہے ہیں؟ — میں: جی ہاں 😭",
      "ابا: بل کم کیوں نہیں؟ — میں: بجلی کم آتی ہے، بل پورا آتا ہے 😭",
      "میں: calm رہوں گا — ٹریفک: hold my horn 🔊",
      "امی: باہر جا رہے ہو؟ — میں: نہیں — امی: اچھا تو سبزی لے آؤ 😭",
      "میں: budget بناؤں گا — online sale: surprise 🎁",
      "استاد: کوئی سوال؟ — میں: جی… زندگی کیوں؟ 😭",
      "میں: gym جا رہا ہوں — دماغ: واپسی میں chai ضروری ہے ☕"
    ];
    pool.push(...ur.map((t) => ({ text: t, meta: "UR" })));

    const out = pickN(dedupeBy(pool, (x) => x.text), 3);
    return out.length === 3 ? out : fallback;
  }

  /* ---------------- produce result fast ---------------- */
  const FALLBACK_ALL = {
    news: [
      { title: "Sup’ Sain: News loading… refresh again in a moment.", url: "", source: "Sup’ Sain" },
      { title: "Tip: slow networks can delay feeds, but the app won’t hang now.", url: "", source: "Sup’ Sain" },
      { title: "You can refresh anytime — results will rotate.", url: "", source: "Sup’ Sain" }
    ],
    doy: [
      { text: "Honey never spoils.", meta: "Fact" },
      { text: "Octopus have three hearts.", meta: "Science" },
      { text: "A day on Venus is longer than its year.", meta: "Space" }
    ],
    islam: buildIslam(),
    quiz: buildQuiz(),
    innov: [
      { title: "AI copilots are being embedded into everyday work tools.", url: "", source: "Innovation" },
      { title: "Battery improvements are boosting EV range and charging speed.", url: "", source: "Innovation" },
      { title: "Robotics adoption is accelerating in logistics.", url: "", source: "Innovation" }
    ],
    weekend: buildWeekend(),
    biz: buildBiz(),
    jokes: [
      { text: "Why don’t programmers like nature? Too many bugs.", meta: "EN" },
      { text: "I told my computer I needed a break… it froze.", meta: "EN" },
      { text: "امی: موبائل چھوڑ دو — میں: بس آخری scroll 😭", meta: "UR" }
    ]
  };

  // Build with deadline so API never hangs your UI
  const result = {
    news: await withDeadline(buildNews(), 7800, FALLBACK_ALL.news),
    doy: await withDeadline(buildFacts(), 7800, FALLBACK_ALL.doy),
    islam: buildIslam(),
    quiz: buildQuiz(),
    innov: await withDeadline(buildInnov(), 7800, FALLBACK_ALL.innov),
    weekend: buildWeekend(),
    biz: buildBiz(),
    jokes: await withDeadline(buildJokes(), 7800, FALLBACK_ALL.jokes)
  };

  if (section !== "all") {
    return res.status(200).json({ items: Array.isArray(result[section]) ? result[section] : [] });
  }
  return res.status(200).json(result);
}
