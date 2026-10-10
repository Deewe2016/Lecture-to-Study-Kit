export default async function handler(req, res) {
  console.log('GENERATE EVENTS CALLED');
  return res.status(200).json({ events: [], test: true });
}
