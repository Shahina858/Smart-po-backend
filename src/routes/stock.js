const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Multer for document uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `stock_doc_${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage });

// Get stock update history
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT su.*, p.pname, p.pcode 
       FROM stock_updates su 
       JOIN products p ON su.product_id = p.id
       ORDER BY su.created_at DESC LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add stock update
router.post('/', async (req, res) => {
  try {
    const { product_id, quantity, updated_by, notes } = req.body;
    const today = new Date().toISOString().split('T')[0];

    await db.query(
      'INSERT INTO stock_updates (product_id, quantity, updated_by, update_date, notes) VALUES (?,?,?,?,?)',
      [product_id, quantity, updated_by || 'admin', today, notes || '']
    );

    await db.query(
      'UPDATE products SET stock=? WHERE id=?',
      [quantity, product_id]
    );

    res.json({ message: 'Stock updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload stock document
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const notes = `📎 Document: ${req.file.originalname}`;
    const today = new Date().toISOString().split('T')[0];

    // Log upload using first product as reference
    const [products] = await db.query('SELECT id FROM products LIMIT 1');
    if (products.length > 0) {
      await db.query(
        'INSERT INTO stock_updates (product_id, quantity, updated_by, update_date, notes) VALUES (?,?,?,?,?)',
        [products[0].id, 0, 'admin', today, notes]
      );
    }

    res.json({
      message: 'Document uploaded successfully',
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;