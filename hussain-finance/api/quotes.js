export default async function handler(req, res) {
  try {
    const picks = [];
    for (let i = 0; i < 4; i++) {
      picks.push(1 + Math.floor(Math.random() * 6236));
    }

    const items = [];
    for (const n of picks) {
      // English translation: Muhammad Asad
      const url = `https://api.alquran.cloud/v1/ayah/${n}/en.asad`;
      const r = await fetch(url);
      const j = await r.json();

      const a = j?.data;
      if (!a) continue;

      items.push({
        text: a.text,
        meta: `Quran ${a.surah?.englishName || ""} ${a.surah?.number || ""}:${a.numberInSurah || ""}`
      });
    }

    res.setHeader("Content-Type", "application/json");
    res.status(200).send({ items });
  } catch (e) {
    res.status(200).send({
      items: [
        { text: "Indeed, with hardship comes ease.", meta: "Quran 94:6" },
        { text: "So remember Me; I will remember you.", meta: "Quran 2:152" },
        { text: "Allah does not burden a soul beyond that it can bear.", meta: "Quran 2:286" },
        { text: "And He is with you wherever you are.", meta: "Quran 57:4" }
      ]
    });
  }
}