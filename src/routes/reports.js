const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/', async (req, res) => {
  try {
    const { customer_id, month, year, type } = req.query;
    const m = month || new Date().getMonth() + 1;
    const y = year || new Date().getFullYear();

    let query = `
      SELECT
        pi.pcode_matched AS pcode,
        COALESCE(pi.pname_matched, pi.product_name) AS pname,
        p.packing,
        c.name AS customer_name,
        SUM(COALESCE(pi.quantity, 0)) AS total_qty,
        COUNT(DISTINCT po.id) AS po_count
      FROM po_items pi
      JOIN po_orders po ON pi.po_id = po.id
      JOIN customers c ON po.customer_id = c.id
      LEFT JOIN products p ON p.pcode = pi.pcode_matched
      WHERE MONTH(po.created_at) = ?
        AND YEAR(po.created_at) = ?
        AND pi.match_status = 'matched'
        AND pi.pcode_matched IS NOT NULL
    `;
    const params = [m, y];

    if (customer_id) {
      query += ' AND po.customer_id = ?';
      params.push(customer_id);
    }

    query += `
      GROUP BY pi.pcode_matched, pi.pname_matched, pi.product_name, p.packing, c.id, c.name
    `;

    if (type === 'by_hospital') {
      query += ' ORDER BY c.name ASC, total_qty DESC';
    } else {
      query += ' ORDER BY pi.pcode_matched ASC, total_qty DESC';
    }

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
