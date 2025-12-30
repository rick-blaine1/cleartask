/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
import tap from 'tap';
import sinon from 'sinon';
import Fastify from 'fastify';
import emailIngestionPlugin from '../src/email_ingestion/index.js';
import * as emailVerification from '../src/email_ingestion/emailVerification.js';
import * as messageIdService from '../src/email_ingestion/messageIdService.js';

// Mock the database pool
const mockPool = {
  query: sinon.stub(),
};

// Helper function to create a Fastify instance with the plugin
async function buildFastify(pool) {
  const fastify = Fastify();
  fastify.decorate('authenticate', async (request, reply) => {
    request.user = { id: 'test_user', email: 'test@example.com' };
  });
  fastify.decorate('log', { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() });
  await fastify.register(emailIngestionPlugin, { pool });
  return fastify;
}

tap.test('Email Deduplication Unit Tests', async (t) => {
  let fastify;

  t.beforeEach(async () => {
    // Reset mocks before each test
    mockPool.query.resetBehavior();
    sinon.restore(); // Restore all stubs and mocks
  });

  t.test('isMessageIdLocked returns true if message_id is in lock table and not expired', async (t) => {
    const messageId = '<test-message-id-1>';
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);
    mockPool.query.returns(Promise.resolve({ rows: [{ processed_at: twentyThreeHoursAgo }] }));

    const isLocked = await messageIdService.isMessageIdLocked(mockPool, messageId);
    t.ok(isLocked, 'Message ID should be locked');
    t.ok(mockPool.query.calledOnce, 'pool.query should be called once');
    t.match(mockPool.query.getCall(0).args[0], /SELECT processed_at FROM email_processing_lock WHERE message_id = \$1 AND processed_at >= \$2;/,
      'SQL query should be correct');
    t.equal(mockPool.query.getCall(0).args[1][0], messageId, 'Message ID should be passed correctly');
    t.ok(mockPool.query.getCall(0).args[1][1] instanceof Date, 'Date object should be passed');
  });

  t.test('isMessageIdLocked returns false if message_id is in lock table but expired', async (t) => {
    const messageId = '<test-message-id-2>';
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    mockPool.query.returns(Promise.resolve({ rows: [{ processed_at: twentyFiveHoursAgo }] }));

    const isLocked = await messageIdService.isMessageIdLocked(mockPool, messageId);
    t.notOk(isLocked, 'Message ID should not be locked');
    t.ok(mockPool.query.calledOnce, 'pool.query should be called once');
  });

  t.test('isMessageIdLocked returns false if message_id is not in lock table', async (t) => {
    const messageId = '<test-message-id-3>';
    mockPool.query.returns(Promise.resolve({ rows: [] }));

    const isLocked = await messageIdService.isMessageIdLocked(mockPool, messageId);
    t.notOk(isLocked, 'Message ID should not be locked');
    t.ok(mockPool.query.calledOnce, 'pool.query should be called once');
  });

  t.test('isMessageIdLocked returns false on database error', async (t) => {
    const messageId = '<test-message-id-4>';
    mockPool.query.throws(new Error('Database error'));

    const isLocked = await messageIdService.isMessageIdLocked(mockPool, messageId);
    t.notOk(isLocked, 'Message ID should not be locked on error');
    t.ok(mockPool.query.calledOnce, 'pool.query should be called once');
  });

  t.test('addMessageIdToLockTable adds message_id to the table', async (t) => {
    const messageId = '<new-message-id>';
    mockPool.query.returns(Promise.resolve({}));

    await messageIdService.addMessageIdToLockTable(mockPool, messageId);

    t.ok(mockPool.query.calledOnce, 'pool.query should be called once');
    t.match(mockPool.query.getCall(0).args[0], /INSERT INTO email_processing_lock \(message_id, processed_at\) VALUES \(\$1, NOW\(\)\);/,
      'SQL query should be correct');
    t.equal(mockPool.query.getCall(0).args[1][0], messageId, 'Message ID should be passed correctly');
  });

  t.test('addMessageIdToLockTable logs error on database error', async (t) => {
    const messageId = '<error-message-id>';
    mockPool.query.throws(new Error('Insert error'));
    const consoleErrorStub = sinon.stub(console, 'error');

    await messageIdService.addMessageIdToLockTable(mockPool, messageId);

    t.ok(mockPool.query.calledOnce, 'pool.query should be called once');
    t.ok(consoleErrorStub.calledOnce, 'console.error should be called once');
    t.match(consoleErrorStub.getCall(0).args[0], /Error adding message ID/, 'Error message should be logged');
    consoleErrorStub.restore();
  });

  t.end();
});

tap.test('Email Ingestion API Integration Tests (Deduplication)', async (t) => {
  let fastify;
  let isSenderVerifiedStub;
  let isMessageIdLockedStub;
  let addMessageIdToLockTableStub;

  t.beforeEach(async () => {
    fastify = await buildFastify(mockPool);
    isSenderVerifiedStub = sinon.stub(emailVerification, 'isSenderVerified');
    isMessageIdLockedStub = sinon.stub(messageIdService, 'isMessageIdLocked');
    addMessageIdToLockTableStub = sinon.stub(messageIdService, 'addMessageIdToLockTable');
    mockPool.query.resetBehavior();
  });

  t.afterEach(async () => {
    await fastify.close();
    isSenderVerifiedStub.restore();
    isMessageIdLockedStub.restore();
    addMessageIdToLockTableStub.restore();
  });

  t.test('should reject email with duplicate Message-ID within 24 hours', async (t) => {
    isSenderVerifiedStub.returns(true);
    isMessageIdLockedStub.returns(true); // Simulate a locked message ID

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      payload: {
        messageId: '<test-duplicate-message-id>',
        sender: 'authorized@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      },
    });

    t.equal(response.statusCode, 409, 'Should return 409 Conflict for duplicate message ID');
    t.match(response.json(), { message: 'Email with this Message-ID has been processed recently.' }, 'Correct error message');
    t.ok(isSenderVerifiedStub.calledOnce, 'isSenderVerified should be called once');
    t.ok(isMessageIdLockedStub.calledOnceWith(mockPool, '<test-duplicate-message-id>'), 'isMessageIdLocked should be called with correct message ID');
    t.notOk(addMessageIdToLockTableStub.called, 'addMessageIdToLockTable should NOT be called');
  });

  t.test('should successfully process email with unique Message-ID', async (t) => {
    isSenderVerifiedStub.returns(true);
    isMessageIdLockedStub.returns(false); // Simulate a unique message ID
    addMessageIdToLockTableStub.returns(Promise.resolve()); // Simulate successful addition

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      payload: {
        messageId: '<test-unique-message-id>',
        sender: 'authorized@example.com',
        subject: 'Unique Subject',
        body: 'Unique Body',
      },
    });

    t.equal(response.statusCode, 200, 'Should return 200 OK for unique message ID');
    t.match(response.json().message, 'Email ingestion endpoint hit and validated successfully.', 'Correct success message');
    t.ok(isSenderVerifiedStub.calledOnce, 'isSenderVerified should be called once');
    t.ok(isMessageIdLockedStub.calledOnceWith(mockPool, '<test-unique-message-id>'), 'isMessageIdLocked should be called with correct message ID');
    t.ok(addMessageIdToLockTableStub.calledOnceWith(mockPool, '<test-unique-message-id>'), 'addMessageIdToLockTable should be called with correct message ID');
  });

  t.test('should process email with expired duplicate Message-ID', async (t) => {
    isSenderVerifiedStub.returns(true);
    isMessageIdLockedStub.returns(false); // Simulate an expired duplicate message ID (treated as not locked)
    addMessageIdToLockTableStub.returns(Promise.resolve()); // Simulate successful addition

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      payload: {
        messageId: '<test-expired-duplicate-message-id>',
        sender: 'authorized@example.com',
        subject: 'Expired Duplicate Subject',
        body: 'Expired Duplicate Body',
      },
    });

    t.equal(response.statusCode, 200, 'Should return 200 OK for expired duplicate message ID');
    t.match(response.json().message, 'Email ingestion endpoint hit and validated successfully.', 'Correct success message');
    t.ok(isSenderVerifiedStub.calledOnce, 'isSenderVerified should be called once');
    t.ok(isMessageIdLockedStub.calledOnceWith(mockPool, '<test-expired-duplicate-message-id>'), 'isMessageIdLocked should be called with correct message ID');
    t.ok(addMessageIdToLockTableStub.calledOnceWith(mockPool, '<test-expired-duplicate-message-id>'), 'addMessageIdToLockTable should be called with correct message ID');
  });

  t.test('should handle missing Message-ID gracefully (no deduplication check)', async (t) => {
    isSenderVerifiedStub.returns(true);
    // isMessageIdLocked and addMessageIdToLockTable should NOT be called

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      payload: {
        sender: 'authorized@example.com',
        subject: 'No Message ID',
        body: 'This email has no Message-ID',
      },
    });

    t.equal(response.statusCode, 200, 'Should return 200 OK even without Message-ID');
    t.match(response.json().message, 'Email ingestion endpoint hit and validated successfully.', 'Correct success message');
    t.ok(isSenderVerifiedStub.calledOnce, 'isSenderVerified should be called once');
    t.notOk(isMessageIdLockedStub.called, 'isMessageIdLocked should not be called');
    t.notOk(addMessageIdToLockTableStub.called, 'addMessageIdToLockTable should not be called');
  });

  t.test('should return 403 if sender is not authorized', async (t) => {
    isSenderVerifiedStub.returns(false);
    // isMessageIdLocked and addMessageIdToLockTable should NOT be called

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      payload: {
        messageId: '<test-unauthorized-message-id>',
        sender: 'unauthorized@example.com',
        subject: 'Unauthorized Subject',
        body: 'Unauthorized Body',
      },
    });

    t.equal(response.statusCode, 403, 'Should return 403 Forbidden');
    t.match(response.json(), { message: 'Sender email address is not authorized.' }, 'Correct error message');
    t.ok(isSenderVerifiedStub.calledOnce, 'isSenderVerified should be called once');
    t.notOk(isMessageIdLockedStub.called, 'isMessageIdLocked should not be called');
    t.notOk(addMessageIdToLockTableStub.called, 'addMessageIdToLockTable should not be called');
  });

  t.end();
});
