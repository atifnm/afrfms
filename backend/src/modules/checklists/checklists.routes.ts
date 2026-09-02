import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/client";
import { requireAuth, requireRole } from "../../middleware/auth";
import { newId } from "../../utils/id";
import { logAction } from "../../utils/audit";

const router = Router();

// GET /categories — list every equipment category, for Admin's equipment
// and checklist management screens (create equipment, edit a template).
router.get("/", requireAuth, async (_req, res) => {
  const rows = (await db.prepare(`SELECT id, name FROM equipment_categories ORDER BY name ASC`).all()) as any[];
  res.json(rows.map((r) => ({ id: r.id, name: r.name })));
});

const categoryNameSchema = z.object({ name: z.string().min(1) });

// POST /categories — Admin only. Adds a new equipment category (e.g. a
// vehicle class not covered by the defaults) — Architecture Doc 6.2.
router.post("/", requireAuth, requireRole("ADMIN", "GM_FIRE"), async (req, res) => {
  const parsed = categoryNameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const existing = await db.prepare(`SELECT id FROM equipment_categories WHERE name = ?`).get(parsed.data.name);
  if (existing) return res.status(409).json({ error: "A category with this name already exists" });

  const id = newId();
  await db.prepare(`INSERT INTO equipment_categories (id, name) VALUES (?, ?)`).run(id, parsed.data.name);
  await logAction(req.user!.userId, "CATEGORY_CREATED", "EquipmentCategory", id, { name: parsed.data.name });
  res.status(201).json({ id, name: parsed.data.name });
});

// PATCH /categories/:categoryId — Admin only. Renames a category. The
// checklist template and every vehicle already in this category follow
// automatically since they reference the category by id, not name.
router.patch("/:categoryId", requireAuth, requireRole("ADMIN", "GM_FIRE"), async (req, res) => {
  const parsed = categoryNameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const category = await db.prepare(`SELECT id FROM equipment_categories WHERE id = ?`).get(req.params.categoryId);
  if (!category) return res.status(404).json({ error: "Equipment category not found" });

  const existing = (await db.prepare(`SELECT id FROM equipment_categories WHERE name = ? AND id != ?`).get(
    parsed.data.name,
    req.params.categoryId
  )) as { id: string } | undefined;
  if (existing) return res.status(409).json({ error: "A category with this name already exists" });

  await db.prepare(`UPDATE equipment_categories SET name = ? WHERE id = ?`).run(parsed.data.name, req.params.categoryId);
  await logAction(req.user!.userId, "CATEGORY_RENAMED", "EquipmentCategory", req.params.categoryId, { name: parsed.data.name });
  res.json({ ok: true });
});

// GET /categories/:categoryId/checklist-template
// Returns the active checklist template (sectioned items) for an equipment
// category. This is what the driver app renders as the inspection form —
// the same category always yields the same shape, per Architecture Doc 6.3.
// Retired items (is_active = 0) are never returned here.
router.get("/:categoryId/checklist-template", requireAuth, async (req, res) => {
  const template = (await db
    .prepare(
      `SELECT id, category_id, version, effective_date
       FROM checklist_templates
       WHERE category_id = ? AND is_active = 1
       ORDER BY version DESC LIMIT 1`
    )
    .get(req.params.categoryId)) as any;

  if (!template) {
    return res.status(404).json({ error: "No active checklist template for this category" });
  }

  const items = (await db
    .prepare(
      `SELECT id, section, label, input_type, is_critical, sort_order
       FROM checklist_items WHERE template_id = ? AND is_active = 1 ORDER BY sort_order ASC`
    )
    .all(template.id)) as any[];

  res.json({
    templateId: template.id,
    version: template.version,
    effectiveDate: template.effective_date,
    items: items.map((i) => ({
      id: i.id,
      section: i.section,
      label: i.label,
      inputType: i.input_type,
      isCritical: !!i.is_critical,
      sortOrder: i.sort_order,
    })),
  });
});

const itemSchema = z.object({
  id: z.string().optional(), // omit for a new item
  section: z.string().min(1),
  label: z.string().min(1),
  inputType: z.enum(["boolean", "numeric", "text"]),
  isCritical: z.boolean(),
});

const updateTemplateSchema = z.object({
  items: z.array(itemSchema).min(1),
});

// PATCH /categories/:categoryId/checklist-template — Admin only. Full sync
// of the active template's items in one call: items with an `id` are
// updated in place, items without one are inserted new, and any existing
// active item whose `id` is missing from the new list is retired
// (is_active = 0) rather than deleted — this preserves referential
// integrity for historical inspection responses that reference it, per
// Architecture Doc 6.3's template-versioning intent.
router.patch("/:categoryId/checklist-template", requireAuth, requireRole("ADMIN", "GM_FIRE"), async (req, res) => {
  const parsed = updateTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const category = await db.prepare(`SELECT id FROM equipment_categories WHERE id = ?`).get(req.params.categoryId);
  if (!category) return res.status(404).json({ error: "Equipment category not found" });

  let template = (await db
    .prepare(`SELECT id FROM checklist_templates WHERE category_id = ? AND is_active = 1 ORDER BY version DESC LIMIT 1`)
    .get(req.params.categoryId)) as { id: string } | undefined;

  if (!template) {
    // No template exists yet for this category — create the first one.
    const templateId = newId();
    await db
      .prepare(`INSERT INTO checklist_templates (id, category_id, version, is_active) VALUES (?, ?, 1, 1)`)
      .run(templateId, req.params.categoryId);
    template = { id: templateId };
  }

  const existingItems = (await db
    .prepare(`SELECT id FROM checklist_items WHERE template_id = ? AND is_active = 1`)
    .all(template.id)) as { id: string }[];
  const existingIds = new Set(existingItems.map((i) => i.id));
  const keptIds = new Set<string>();

  for (let i = 0; i < parsed.data.items.length; i++) {
    const item = parsed.data.items[i];
    if (item.id && existingIds.has(item.id)) {
      await db
        .prepare(
          `UPDATE checklist_items SET section = ?, label = ?, input_type = ?, is_critical = ?, sort_order = ? WHERE id = ?`
        )
        .run(item.section, item.label, item.inputType, item.isCritical ? 1 : 0, i, item.id);
      keptIds.add(item.id);
    } else {
      const newItemId = newId();
      await db
        .prepare(
          `INSERT INTO checklist_items (id, template_id, section, label, input_type, is_critical, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(newItemId, template.id, item.section, item.label, item.inputType, item.isCritical ? 1 : 0, i);
      keptIds.add(newItemId);
    }
  }

  // Retire any active item that wasn't in the submitted list.
  for (const existingId of existingIds) {
    if (!keptIds.has(existingId)) {
      await db.prepare(`UPDATE checklist_items SET is_active = 0 WHERE id = ?`).run(existingId);
    }
  }

  await logAction(req.user!.userId, "CHECKLIST_TEMPLATE_UPDATED", "ChecklistTemplate", template.id, {
    categoryId: req.params.categoryId,
    itemCount: parsed.data.items.length,
  });

  res.json({ ok: true, templateId: template.id });
});

export default router;
