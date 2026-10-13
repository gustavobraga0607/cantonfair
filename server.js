'use strict';

const http = require('node:http');
const path = require('node:path');
const { appFromEnv } = require('./src/config');

const PORT = Number(process.env.PORT) || 3000;
const { db, handler } = appFromEnv({ publicDir: path.join(__dirname, 'public') });

http.createServer(handler).listen(PORT, () => {
  console.log(`Canton Fair Buyer rodando em http://localhost:${PORT} (banco: ${db.driver})`);
});
