'use strict';

const http = require('node:http');
const path = require('node:path');
const { open } = require('./src/db');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

const db = open(DATA_DIR);
const handler = createApp({
  db,
  dataDir: DATA_DIR,
  publicDir: path.join(__dirname, 'public'),
  cnpjOnlineCheck: process.env.CNPJ_ONLINE_CHECK !== 'false',
  secureCookies: process.env.SECURE_COOKIES === 'true',
});

http.createServer(handler).listen(PORT, () => {
  console.log(`Canton Fair Buyer rodando em http://localhost:${PORT}`);
});
