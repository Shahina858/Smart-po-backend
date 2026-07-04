const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM customers ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, gmail, ccode, contact_person, drug_license } = req.body;
    const [result] = await db.query(
      'INSERT INTO customers (name, gmail, ccode, contact_person, drug_license) VALUES (?,?,?,?,?)',
      [name, gmail, ccode, contact_person, drug_license]
    );
    res.json({ id: result.insertId, message: 'Customer added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, gmail, ccode, contact_person, drug_license } = req.body;
    await db.query(
      'UPDATE customers SET name=?, gmail=?, ccode=?, contact_person=?, drug_license=? WHERE id=?',
      [name, gmail, ccode, contact_person, drug_license, req.params.id]
    );
    res.json({ message: 'Customer updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM customers WHERE id=?', [req.params.id]);
    res.json({ message: 'Customer deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;