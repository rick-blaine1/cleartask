import { Pool } from 'pg';

/**
 * Retrieves a list of user IDs for whom the given sender email address is verified.
 * @param {string} senderEmail The email address of the sender.
 * @param {object} pool The PostgreSQL connection pool.
 * @returns {Promise<string[]>} An array of user IDs.
 */
export async function getVerifiedUserIdsForSender(senderEmail, pool) {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      'SELECT user_id FROM user_authorized_senders WHERE email_address = $1 AND is_verified = TRUE',
      [senderEmail]
    );
    return result.rows.map(row => row.user_id);
  } catch (error) {
    console.error('Error retrieving verified user IDs:', error);
    throw new Error('Database error during verified user IDs retrieval.');
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Checks if a sender email address is verified for at least one user.
 * @param {string} senderEmail The email address of the sender.
 * @param {object} pool The PostgreSQL connection pool.
 * @returns {Promise<boolean>} True if verified for any user, false otherwise.
 */
export async function isSenderVerified(senderEmail, pool) {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      'SELECT EXISTS(SELECT 1 FROM user_authorized_senders WHERE email_address = $1 AND is_verified = TRUE) AS is_verified',
      [senderEmail]
    );
    return result.rows[0].is_verified;
  } catch (error) {
    console.error('Error checking sender verification status:', error);
    throw new Error('Database error during sender verification check.');
  } finally {
    if (client) {
      client.release();
    }
  }
}
