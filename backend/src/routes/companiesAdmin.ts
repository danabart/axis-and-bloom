import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { db } from '../db/client.js';

const router = Router();
router.use(requireAdmin);

// GET /api/admin/companies?search= — autocomplete for the New Company Gift form's
// company combobox. No full CRUD/detail page — search plus create-on-the-fly from the
// gift form is enough for this patch (see Round 2 followups doc).
router.get('/', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  try {
    const r = search
      ? await db.query(
          `SELECT id, company_name FROM company WHERE company_name ILIKE $1 ORDER BY company_name LIMIT 20`,
          [`%${search}%`]
        )
      : await db.query(`SELECT id, company_name FROM company ORDER BY company_name LIMIT 20`);
    res.json(r.rows.map((row: any) => ({ id: row.id, companyName: row.company_name })));
  } catch (err) {
    console.error('[admin/companies/search]', err);
    res.status(500).json({ error: 'Failed to search companies' });
  }
});

export default router;
