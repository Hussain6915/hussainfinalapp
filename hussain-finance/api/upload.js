import { put } from "@vercel/blob";

export default async function handler(req, res) {
  try {

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { filename, contentType } = req.query;

    const blob = await put(filename, req, {
      access: "public",
      contentType: contentType || "application/octet-stream"
    });

    res.status(200).json(blob);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
