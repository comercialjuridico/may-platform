const { test } = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');
const express = require('express');
const { loadRoute, database, withApp } = require('./helpers.cjs');
process.env.STRIPE_SECRET_KEY = 'sk_test_local_fixture';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_fixture';

test('Stripe verifies original body even after global JSON parser consumed it', async () => {
  const db = database({ subscriptions_log: [] });
  const router = loadRoute('backend/routes/stripe.js', {
    '../services/supabase': { supabase: db },
    '../middleware/auth': { authMiddleware(req, res, next) { next(); } },
  });
  const event = { id: 'evt_fixture', object: 'event', type: 'test.unhandled', data: { object: {} } };
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(event), secret: process.env.STRIPE_WEBHOOK_SECRET });
  await withApp(router, async request => {
    assert.equal((await request('/webhook', event, { 'stripe-signature': signature })).status, 200);
    assert.equal((await request('/webhook', { ...event, id: 'tampered' }, { 'stripe-signature': signature })).status, 400);
  }, (req, res, next) => { req.rawBody = JSON.stringify(req.body); next(); });
  assert.equal(db.tables.subscriptions_log.length, 1);
});
