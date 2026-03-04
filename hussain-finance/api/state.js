import { kv } from "@vercel/kv";

const KEY = "hussain_finance_state_v1";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const data = (await kv.get(KEY)) || null;
      res.setHeader("Content-Type", "application/json");
      res.status(200).send(data || {
        overall: { current: 0, savings: 0, monthly: 0 },
        current: { balance: 0, savings: 0 },
        daily: { base: 10500, updated: 10500, weekPlan: {1:"",2:"",3:"",4:""} },
        expenses: [],
        notes: [],
        docs: [],
        water: { targetMl: 3000, glasses: 0, mlPerGlass: 250, lastDate: null },
        quotes: { items: [], reflection: "" },
        focus: { running: false, endAt: null, overlay: false },
        plans: { items: [], pin: null }
      });
      return;
    }

    if (req.method === "POST") {
      const body = req.body || {};
      await kv.set(KEY, body);
      res.setHeader("Content-Type", "application/json");
      res.status(200).send({ ok: true });
      return;
    }

    res.status(405).send({ error: "Method not allowed" });
  } catch (e) {
    res.status(500).send({ error: String(e?.message || e) });
  }
}