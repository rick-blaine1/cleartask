import { Pool } from 'pg';

/**
 * Checks if a sender's email address is verified for any user in the user_authorized_senders table.
 * @param {string} senderEmail The email address of the sender.
 * @param {object} pool The PostgreSQL connection pool.
 * @returns {Promise<boolean>} True if the sender is verified for any user, false otherwise.
 */
export async function isSenderVerified(senderEmail, pool) {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      'SELECT EXISTS (SELECT 1 FROM user_authorized_senders WHERE email_address = $1 AND is_verified = TRUE)',
      [senderEmail]
    );
    return result.rows[0].exists;
  } catch (error) {
    console.error('Error checking sender verification status:', error);
    throw new Error('Database error during sender verification check.');
  } finally {
    if (client) {
      client.release();
    }
  }
}
