const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/stats/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [[{ pos_today }]] = await db.query(
      'SELECT COUNT(*) as pos_today FROM po_orders WHERE DATE(created_at)=?', [today]
    );
    const [[{ xls_generated }]] = await db.query(
      'SELECT COUNT(*) as xls_generated FROM po_orders WHERE xls_path IS NOT NULL AND DATE(created_at)=?', [today]
    );
    const [[{ total_unmatched }]] = await db.query(
      'SELECT COALESCE(SUM(unmatched_items),0) as total_unmatched FROM po_orders WHERE DATE(created_at)=?', [today]
    );
    const [[{ total_pos }]] = await db.query(
      'SELECT COUNT(*) as total_pos FROM po_orders'
    );
    res.json({ pos_today, xls_generated, total_unmatched, total_pos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT po.*, c.name as customer_name 
       FROM po_orders po
       LEFT JOIN customers c ON po.customer_id = c.id
       ORDER BY po.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [[po]] = await db.query(
      `SELECT po.*, c.name as customer_name, c.gmail as customer_gmail
       FROM po_orders po
       LEFT JOIN customers c ON po.customer_id = c.id
       WHERE po.id=?`, [req.params.id]
    );
    if (!po) return res.status(404).json({ error: 'PO not found' });
    const [items] = await db.query(
      'SELECT * FROM po_items WHERE po_id=?', [req.params.id]
    );
    res.json({ ...po, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a PO item
router.put('/item/:id', async (req, res) => {
  try {
    const { quantity, unit_price, pname_matched, pcode_matched } = req.body;
    await db.query(
      'UPDATE po_items SET quantity=?, unit_price=?, pname_matched=?, pcode_matched=? WHERE id=?',
      [quantity, unit_price, pname_matched, pcode_matched, req.params.id]
    );
    res.json({ message: 'Item updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save product alias from PO review — maps hospital name to correct pcode
router.post('/alias', async (req, res) => {
  try {
    const { hospital_name, pcode, pname, po_item_id } = req.body;

    if (!hospital_name || !pcode) {
      return res.status(400).json({ error: 'hospital_name and pcode required' });
    }

    // Save alias
    await db.query(
      `INSERT INTO product_aliases (hospital_name, pcode, pname)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE pcode=VALUES(pcode), pname=VALUES(pname)`,
      [hospital_name.toUpperCase(), pcode, pname]
    );

    // Also update the po_item with correct match if item_id provided
    if (po_item_id) {
      // Get product details
      const [products] = await db.query(
        'SELECT * FROM products WHERE pcode=? LIMIT 1', [pcode]
      );
      if (products.length > 0) {
        const product = products[0];
        await db.query(
          `UPDATE po_items SET 
           pcode_matched=?, pname_matched=?, match_status='matched', match_confidence=100
           WHERE id=?`,
          [pcode, product.pname, po_item_id]
        );

        // Update po_orders counts
        const [item] = await db.query('SELECT po_id FROM po_items WHERE id=?', [po_item_id]);
        if (item.length > 0) {
          const poId = item[0].po_id;
          const [[matched]] = await db.query(
            "SELECT COUNT(*) as c FROM po_items WHERE po_id=? AND match_status='matched'", [poId]
          );
          const [[unmatched]] = await db.query(
            "SELECT COUNT(*) as c FROM po_items WHERE po_id=? AND match_status='unmatched'", [poId]
          );
          await db.query(
            'UPDATE po_orders SET matched_items=?, unmatched_items=? WHERE id=?',
            [matched.c, unmatched.c, poId]
          );
        }
      }
    }

    res.json({ message: 'Alias saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all saved aliases
router.get('/aliases/list', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM product_aliases ORDER BY hospital_name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;