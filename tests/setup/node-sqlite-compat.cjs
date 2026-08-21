const { createRequire } = require('node:module');
const nodeRequire = createRequire(__filename);
module.exports = nodeRequire('node:sqlite');
