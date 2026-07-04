const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });

// Get pricing for a customer for given month/year
router.get('/', async (req, res) => {
  try {
    const { customer_id, month, year } = req.query;
    const m = month || new Date().getMonth() + 1;
    const y = year || new Date().getFullYear();

    let query = `SELECT cp.*, c.name as customer_name, p.pname
                 FROM customer_pricing cp
                 JOIN customers c ON cp.customer_id = c.id
                 LEFT JOIN products p ON cp.pcode = p.pcode
                 WHERE cp.month=? AND cp.year=?`;
    const params = [m, y];

    if (customer_id) {
      query += ' AND cp.customer_id=?';
      params.push(customer_id);
    }

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set price for a customer+product
router.post('/', async (req, res) => {
  try {
    const { customer_id, pcode, price, month, year } = req.body;
    await db.query(
      `INSERT INTO customer_pricing (customer_id, pcode, price, month, year)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE price=VALUES(price)`,
      [customer_id, pcode, price, month, year]
    );
    res.json({ message: 'Price saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload price list Excel for a customer
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { customer_id, month, year } = req.body;
    if (!customer_id) return res.status(400).json({ error: 'customer_id required' });

    const m = month || new Date().getMonth() + 1;
    const y = year || new Date().getFullYear();

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    let count = 0;
    for (const row of data) {
      // Support columns: PCode/pcode, Price/price
      const pcode = String(row['PCode'] || row['pcode'] || row['PCODE'] || '').trim();
      const price = parseFloat(row['Price'] || row['price'] || row['PRICE'] || 0);

      if (!pcode || !price) continue;

      await db.query(
        `INSERT INTO customer_pricing (customer_id, pcode, price, month, year)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE price=VALUES(price)`,
        [customer_id, pcode, price, m, y]
      );
      count++;
    }

    fs.unlinkSync(req.file.path);
    res.json({ message: `Imported ${count} prices`, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a price entry
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM customer_pricing WHERE id=?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;