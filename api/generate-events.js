export default async function handler(req, res) {
  console.log('GENERATE EVENTS CALLED', req.method);
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ events: [], test: true });
}
