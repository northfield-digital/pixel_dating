import { Router, Request, Response } from 'express';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

async function loadCount(pixelId: number): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int AS n FROM event_participants WHERE pixel_id = $1`,
    [pixelId],
  );
  return res.rows[0].n;
}

// POST /api/event/:pixel_id/participate — idempotent join.
router.post('/:pixel_id/participate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const pixelId = parseInt(String(req.params.pixel_id), 10);
  if (Number.isNaN(pixelId)) {
    res.status(400).json({ error: 'Invalid pixel_id' });
    return;
  }

  const pixelRes = await query(
    `SELECT user_id, type, is_active FROM pixels WHERE id = $1`,
    [pixelId],
  );
  const pixel = pixelRes.rows[0];
  if (!pixel || !pixel.is_active) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  if (pixel.type !== 'event') {
    res.status(400).json({ error: 'not_an_event' });
    return;
  }
  if (pixel.user_id === user.id) {
    res.status(400).json({ error: 'own_event' });
    return;
  }

  await query(
    `INSERT INTO event_participants (pixel_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (pixel_id, user_id) DO NOTHING`,
    [pixelId, user.id],
  );

  res.json({ participants_count: await loadCount(pixelId), is_participant: true });
});

// DELETE /api/event/:pixel_id/participate — idempotent leave.
router.delete('/:pixel_id/participate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const pixelId = parseInt(String(req.params.pixel_id), 10);
  if (Number.isNaN(pixelId)) {
    res.status(400).json({ error: 'Invalid pixel_id' });
    return;
  }

  await query(
    `DELETE FROM event_participants WHERE pixel_id = $1 AND user_id = $2`,
    [pixelId, user.id],
  );

  res.json({ participants_count: await loadCount(pixelId), is_participant: false });
});

export default router;
