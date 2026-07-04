const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Get all aliases
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM product_aliases ORDER BY hospital_name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save alias
router.post('/', async (req, res) => {
  try {
    const { hospital_name, pcode, pname } = req.body;
    await db.query(
      `INSERT INTO product_aliases (hospital_name, pcode, pname)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE pcode=VALUES(pcode), pname=VALUES(pname)`,
      [hospital_name.toUpperCase(), pcode, pname]
    );
    res.json({ message: 'Alias saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete alias
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM product_aliases WHERE id=?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;