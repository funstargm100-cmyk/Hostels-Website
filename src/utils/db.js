const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
  max: 3
});

// Helper that mimics mysql2's [rows] destructuring pattern
// Returns rows array directly
pool.query2 = async (text, params) => {
  const res = await pool.query(text, params);
  return [res.rows];
};

module.exports = pool;
