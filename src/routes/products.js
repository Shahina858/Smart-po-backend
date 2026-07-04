const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });

// Get all products
router.get('/', async (req, res) => {
  try {
    const search = req.query.search || '';
    const [rows] = await db.query(
      'SELECT * FROM products WHERE pname LIKE ? OR pcode LIKE ? ORDER BY pname',
      [`%${search}%`, `%${search}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import products from STS Excel
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Find header row with PCode
    let headerRow = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i].some(cell => String(cell).trim() === 'PCode')) {
        headerRow = i;
        break;
      }
    }

    if (headerRow === -1) {
      return res.status(400).json({ error: 'Could not find PCode header row in Excel' });
    }

    const headers = data[headerRow].map(h => String(h).trim());
    const pcodeIdx = headers.indexOf('PCode');
    const pnameIdx = headers.indexOf('Product Name');
    const packingIdx = headers.indexOf('Packing');
    const mfrIdx = headers.indexOf('Manufacturer / Division');
    const stockIdx = headers.indexOf('STOCK');

    let count = 0;

    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      const pcode = String(row[pcodeIdx] || '').trim();
      const pname = String(row[pnameIdx] || '').trim();

      if (!pcode || !pname || isNaN(Number(pcode))) continue;

      const packing = String(row[packingIdx] || '').trim();
      const manufacturer = String(row[mfrIdx] || 'Unknown').trim() || 'Unknown';
      const stock = parseInt(row[stockIdx]) || 0;

      try {
        await db.query(
          `INSERT INTO products (pcode, pname, packing, manufacturer, stock, mrp)
           VALUES (?, ?, ?, ?, ?, 0)
           ON DUPLICATE KEY UPDATE 
           pname=VALUES(pname), packing=VALUES(packing),
           manufacturer=VALUES(manufacturer), stock=VALUES(stock)`,
          [pcode, pname, packing, manufacturer, stock]
        );
        count++;
      } catch (err) {
        console.log(`Skip row ${i}:`, err.message);
      }
    }

    fs.unlinkSync(req.file.path);
    res.json({ message: `Imported ${count} products`, count });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add product
router.post('/', async (req, res) => {
  try {
    const { pcode, pname, packing, manufacturer, stock, mrp } = req.body;
    const [result] = await db.query(
      'INSERT INTO products (pcode, pname, packing, manufacturer, stock, mrp) VALUES (?,?,?,?,?,?)',
      [pcode, pname, packing, manufacturer, stock || 0, mrp || 0]
    );
    res.json({ id: result.insertId, message: 'Product added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update product
router.put('/:id', async (req, res) => {
  try {
    const { pcode, pname, packing, manufacturer, stock, mrp } = req.body;
    await db.query(
      'UPDATE products SET pcode=?, pname=?, packing=?, manufacturer=?, stock=?, mrp=? WHERE id=?',
      [pcode, pname, packing, manufacturer, stock, mrp, req.params.id]
    );
    res.json({ message: 'Product updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete product
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM products WHERE id=?', [req.params.id]);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;