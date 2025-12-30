export async function isMessageIdLocked(pool, messageId) {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { rows } = await pool.query(
      `SELECT processed_at FROM email_processing_lock WHERE message_id = $1 AND processed_at >= $2;`,
      [messageId, twentyFourHoursAgo]
    );
    return rows.length > 0;
  } catch (error) {
    console.error(`Error checking message ID lock for ${messageId}:`, error);
    return false;
  }
}

export async function addMessageIdToLockTable(pool, messageId) {
  try {
    await pool.query(
      `INSERT INTO email_processing_lock (message_id, processed_at) VALUES ($1, NOW());`,
      [messageId]
    );
    console.log(`Message-ID ${messageId} added to email_processing_lock.`);
  } catch (error) {
    console.error(`Error adding message ID ${messageId} to lock table:`, error);
  }
}