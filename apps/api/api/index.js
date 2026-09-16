// The actual Vercel serverless function. Deliberately plain JavaScript, not
// TypeScript: it has no decorators and nothing Nest needs to reflect on, so
// there is no risk of Vercel's own (esbuild-based) TypeScript handling
// producing different decorator metadata than the `tsc` build that already
// compiled the real application into ../dist. This file only has to exist
// and forward the request — everything else already ran through nest build.
//
// vercel.json rewrites every path to this function, so Nest's own router
// (global prefix, 404s, all of it) still decides what each path does.
const { getServer } = require('../dist/serverless');

module.exports = async (req, res) => {
  const server = await getServer();
  server(req, res);
};
