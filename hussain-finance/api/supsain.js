export default async function handler(req, res) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.status(405).send({ error: "Method not allowed" });
      return;
    }

    const section = String(req.query?.section || "all");

    // --- Helpers ---
    const pick = (arr, n) => {
      const a = Array.from(arr || []);
      const out = [];
      while (a.length && out.length < n) {
        const i = Math.floor(Math.random() * a.length);
        out.push(a.splice(i, 1)[0]);
      }
      return out;
    };

    const clean = (s) =>
      String(s || "")
        .replaceAll("&amp;", "&")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replace(/\s+/g, " ")
        .trim();

    function parseRss(xml) {
      const items = [];
      if (!xml) return items;

      const blocks = String(xml).split(/<item[\s>]/i).slice(1);
      for (const b of blocks) {
        const title = (b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
        const link = (b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1];
        const source = (b.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1];
        if (!title) continue;

        items.push({
          title: clean(title.replace(/<!\[CDATA\[|\]\]>/g, "")),
          url: clean((link || "").replace(/<!\[CDATA\[|\]\]>/g, "")),
          source: clean((source || "").replace(/<!\[CDATA\[|\]\]>/g, "")) || ""
        });
        if (items.length >= 25) break;
      }
      return items;
    }

    async function fetchRss(url) {
      const r = await fetch(url, {
        headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" }
      });
      const t = await r.text();
      return parseRss(t);
    }

    function dedupeByTitle(arr) {
      const seen = new Set();
      const out = [];
      for (const x of arr || []) {
        const k = clean(x?.title || "").toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(x);
      }
      return out;
    }

    function shortenTitle(t) {
      const s = clean(t);
      return s.length > 120 ? s.slice(0, 117) + "..." : s;
    }

    function guessSource(url) {
      try {
        const u = new URL(url);
        return u.hostname.replace("www.", "");
      } catch {
        return "";
      }
    }

    // --- Section builders ---
    async function buildNews() {
      const pkFeeds = [
        "https://news.google.com/rss?hl=en&gl=PK&ceid=PK:en",
        "https://www.dawn.com/feeds/home"
      ];
      const worldFeeds = ["https://news.google.com/rss?hl=en&gl=US&ceid=US:en"];

      const pk = [];
      for (const f of pkFeeds) {
        try { pk.push(...(await fetchRss(f))); } catch {}
      }

      const world = [];
      for (const f of worldFeeds) {
        try { world.push(...(await fetchRss(f))); } catch {}
      }

      const pkPicks = pick(dedupeByTitle(pk), 2);
      const wPick = pick(dedupeByTitle(world), 1);

      return [...pkPicks, ...wPick].map((x) => ({
        title: shortenTitle(x.title),
        url: x.url,
        source: x.source || guessSource(x.url)
      }));
    }

    async function buildDoy() {
      const items = [];
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch("http://numbersapi.com/random/trivia?json");
          const j = await r.json();
          items.push({ text: clean(j.text), meta: "Did you know" });
        } catch {
          items.push({
            text: "Honey never spoils — sealed honey has been found edible after thousands of years.",
            meta: "Did you know"
          });
        }
      }
      return items;
    }

    function buildIslam() {
      // Safe general reminders (no tricky rulings/percentages)
      const pool = [
        { text: "Be kind and gentle — Allah loves those who do good.", meta: "Reminder" },
        { text: "Give in charity, even if it’s a little. Small deeds done consistently matter.", meta: "Reminder" },
        { text: "Keep your prayers on time as much as you can; it brings calm and discipline.", meta: "Reminder" },
        { text: "Smile and speak softly — good character is a huge part of faith.", meta: "Reminder" },
        { text: "Help someone silently; sincere actions are the strongest.", meta: "Reminder" },
        { text: "Avoid backbiting and negativity — protect your heart and your tongue.", meta: "Reminder" },
        { text: "Make dua in hard times and good times; gratitude keeps blessings alive.", meta: "Reminder" },
        { text: "Give water when you can; acts of mercy are beloved.", meta: "Reminder" }
      ];
      return pick(pool, 3);
    }

    async function buildQuiz() {
      // 1) General
      let q1 = {
        question: "General: What is one habit that improves your day the most?",
        answer: "Any consistent habit: sleep, walk, prayer, reading, journaling.",
        hint: "Think: one habit, big impact."
      };

      try {
        const r = await fetch("https://opentdb.com/api.php?amount=1&type=multiple");
        const j = await r.json();
        const it = j?.results?.[0];
        if (it) {
          q1 = {
            question: `General: ${clean(it.question)}`,
            answer: clean(it.correct_answer),
            hint: clean(it.category || "General knowledge")
          };
        }
      } catch {}

      // 2) Easy Math
      const a = 2 + Math.floor(Math.random() * 18);
      const b = 2 + Math.floor(Math.random() * 18);
      const op = Math.random() < 0.5 ? "+" : "×";
      const mathAnswer = op === "+" ? String(a + b) : String(a * b);
      const q2 = { question: `Math: ${a} ${op} ${b} = ?`, answer: mathAnswer, hint: "Easy one 🙂" };

      // 3) Quiz (Sports category, but any will do)
      let q3 = { question: "Quiz: Which planet is known as the Red Planet?", answer: "Mars", hint: "Space" };
      try {
        const r = await fetch("https://opentdb.com/api.php?amount=1&type=multiple&category=21");
        const j = await r.json();
        const it = j?.results?.[0];
        if (it) {
          q3 = {
            question: `Quiz: ${clean(it.question)}`,
            answer: clean(it.correct_answer),
            hint: clean(it.category || "Quiz")
          };
        }
      } catch {}

      return [q1, q2, q3];
    }

    async function buildInnov() {
      try {
        const r = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
        const ids = (await r.json()) || [];
        const picksIds = ids.slice(0, 40);

        const items = [];
        for (const id of picksIds) {
          if (items.length >= 3) break;
          try {
            const rr = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
            const it = await rr.json();
            if (!it?.title) continue;

            items.push({
              title: shortenTitle(clean(it.title)),
              url: it.url || `https://news.ycombinator.com/item?id=${id}`,
              source: "Hacker News"
            });
          } catch {}
        }

        if (items.length) return items;
      } catch {}

      return [
        { title: "A new open-source tool is automating repetitive workflows for small teams.", url: "", source: "Trending" },
        { title: "Battery tech is improving energy storage for home and mobility use-cases.", url: "", source: "Trending" },
        { title: "AI assistants are being integrated into everyday productivity apps.", url: "", source: "Trending" }
      ];
    }

    function buildWeekend() {
      const pool = [
        { text: "Go for a sunrise walk/jog + chai after — simple reset.", meta: "Outdoor" },
        { text: "Visit a historic place nearby (Fort, museum, old bazaar) and take photos.", meta: "Explore" },
        { text: "Plan a family dinner: biryani/BBQ night at home.", meta: "Family" },
        { text: "Try a short road ride with friends + stop for snacks.", meta: "Ride" },
        { text: "Watch a movie/series + do a 20-min tidy-up sprint.", meta: "Chill" },
        { text: "Do a ‘skills hour’: learn a small coding trick or a new guitar riff.", meta: "Skill" },
        { text: "Masjid + quiet reflection + set your week goals in Plans.", meta: "Mind" },
        { text: "Visit Shalimar Gardens / local park (if you’re in Lahore) or your city’s best garden.", meta: "Pakistan" }
      ];
      return pick(pool, 3);
    }

    function buildBiz() {
      const pool = [
        { text: "WhatsApp micro-store: sell 1 niche item (e.g., perfumes, phone accessories) with COD delivery.", meta: "Low-cost" },
        { text: "Resume/LinkedIn optimization service for students and fresh grads.", meta: "Service" },
        { text: "Meal prep / healthy lunch boxes for office workers in one locality.", meta: "Local" },
        { text: "Small SaaS: invoice + expense tracker for freelancers (Pak-focused).", meta: "SaaS" },
        { text: "Bike/car wash on-demand within a neighborhood (subscription model).", meta: "Subscription" },
        { text: "Tuition + AI study planner: weekly plan + accountability group.", meta: "Education" },
        { text: "Digital products: Notion/Excel templates for budgeting and planning.", meta: "Digital" }
      ];
      return pick(pool, 3);
    }

    function buildJokes() {
      const pool = [
        { text: "English: I told my budget we need a break… it said ‘we’re already broke’.", meta: "Joke" },
        { text: "Urdu: Aj kal me ‘saving’ kar raha hun… bas ‘kharch’ ki aadat nahi ja rahi 😭", meta: "Joke" },
        { text: "Mix: Productivity guru said ‘wake up at 5am’ — main ne kaha bhai 5am ko bhi to nind hoti hai 😅", meta: "Joke" },
        { text: "English: My phone battery and my motivation… both die at 20%.", meta: "Joke" },
        { text: "Urdu: Gym join kiya… ab membership dekh ke hi calories jal jati hain 😄", meta: "Joke" },
        { text: "Mix: ‘Kal se pakka’ is Pakistan’s most powerful software update.", meta: "Joke" }
      ];
      return pick(pool, 3);
    }

    // --- Router ---
    if (section !== "all") {
      let items = [];
      if (section === "news") items = await buildNews();
      else if (section === "doy") items = await buildDoy();
      else if (section === "islam") items = buildIslam();
      else if (section === "quiz") items = await buildQuiz();
      else if (section === "innov") items = await buildInnov();
      else if (section === "weekend") items = buildWeekend();
      else if (section === "biz") items = buildBiz();
      else if (section === "jokes") items = buildJokes();

      res.status(200).send({ items });
      return;
    }

    const [news, doy, quiz, innov] = await Promise.all([
      buildNews(),
      buildDoy(),
      buildQuiz(),
      buildInnov()
    ]);

    res.status(200).send({
      news,
      doy,
      islam: buildIslam(),
      quiz,
      innov,
      weekend: buildWeekend(),
      biz: buildBiz(),
      jokes: buildJokes()
    });
  } catch (e) {
    res.status(200).send({
      news: [],
      doy: [],
      islam: [
        { text: "Be consistent with small good deeds.", meta: "Reminder" },
        { text: "Help someone today, even quietly.", meta: "Reminder" },
        { text: "Protect your heart from negativity.", meta: "Reminder" }
      ],
      quiz: [
        { question: "General: What’s one habit you want to improve this week?", answer: "Pick one and do it daily.", hint: "Consistency wins." },
        { question: "Math: 7 + 8 = ?", answer: "15", hint: "Easy 🙂" },
        { question: "Quiz: Which planet is the Red Planet?", answer: "Mars", hint: "Space" }
      ],
      innov: [],
      weekend: [],
      biz: [],
      jokes: []
    });
  }
}
