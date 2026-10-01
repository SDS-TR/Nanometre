import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../supabase/migrations/20261001120000_phase2.sql', import.meta.url), 'utf8');

describe('migration phase 2', () => {
  it('refuse l’accès en base et protège le dernier propriétaire', () => {
    expect(sql).toContain("raise exception 'Accès refusé'");
    expect(sql).toContain('Il doit rester au moins un propriétaire actif.');
    expect(sql).toContain('admin_cancel');
    expect(sql).toContain('enqueue_booking_notifications');
    expect(sql).toContain('validate_promo');
    expect(sql).toContain('onsite_late_policy');
    expect(sql).not.toContain('perform public.cancel_booking');
  });
});
