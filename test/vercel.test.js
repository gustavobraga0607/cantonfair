'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findDatabaseUrl } = require('../src/config');

test('encontra a URL do Postgres, inclusive com prefixo personalizado', () => {
  assert.equal(findDatabaseUrl({ DATABASE_URL: 'a', POSTGRES_URL: 'b' }).name, 'DATABASE_URL');
  assert.equal(findDatabaseUrl({ POSTGRES_URL: 'b' }).name, 'POSTGRES_URL');
  assert.equal(findDatabaseUrl({ STORAGE_DATABASE_URL: 'c' }).name, 'STORAGE_DATABASE_URL');
  assert.equal(findDatabaseUrl({ OTHER: 'x' }), null);
});
