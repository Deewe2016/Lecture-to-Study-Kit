export default async function handler(req, res) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed." });
  const id = String(req.query?.id || "").trim();
  if (!id) return res.status(400).json({ error: "A study kit id is required." });

  // Study kits are stored locally in the browser. This endpoint exists so the
  // generated API client can complete its deletion handshake on Vercel.
  return res.status(204).end();
}
