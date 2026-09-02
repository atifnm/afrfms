import { useEffect, useState } from "react";
import { api, ApiRequestError } from "../api/client";
import type { ChecklistItem, EquipmentCategory, InputType } from "../api/types";
import { Button, Card, EmptyState, ErrorBanner, Field, LoadingSpinner, PageHeader, inputClass } from "../components/ui";
import { newLocalId } from "../utils/localId";

interface EditableItem extends ChecklistItem {
  isNew?: boolean;
}

const INPUT_TYPES: InputType[] = ["boolean", "numeric", "text"];

export function ChecklistAdminPage() {
  const [categories, setCategories] = useState<EquipmentCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [items, setItems] = useState<EditableItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [renamingCategory, setRenamingCategory] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [categoryActionError, setCategoryActionError] = useState<string | null>(null);
  const [categoryBusy, setCategoryBusy] = useState(false);

  function loadCategories(selectId?: string) {
    return api.categories().then((list) => {
      setCategories(list);
      if (selectId) setCategoryId(selectId);
      else if (list.length > 0 && !categoryId) setCategoryId(list[0].id);
      return list;
    });
  }

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    if (!categoryId) return;
    setLoading(true);
    setError(null);
    setSuccess(false);
    api
      .checklistTemplate(categoryId)
      .then((t) => setItems(t.items))
      .catch((err) => {
        if (err instanceof ApiRequestError && err.status === 404) {
          setItems([]); // no template yet for this category — start fresh
        } else {
          setError(err instanceof Error ? err.message : "Failed to load checklist");
        }
      })
      .finally(() => setLoading(false));
  }, [categoryId]);

  async function handleCreateCategory() {
    setCategoryBusy(true);
    setCategoryActionError(null);
    try {
      const created = await api.createCategory(newCategoryName);
      setNewCategoryName("");
      setShowNewCategory(false);
      await loadCategories(created.id);
    } catch (err) {
      setCategoryActionError(err instanceof ApiRequestError ? err.message : "Failed to create category");
    } finally {
      setCategoryBusy(false);
    }
  }

  async function handleRenameCategory() {
    setCategoryBusy(true);
    setCategoryActionError(null);
    try {
      await api.renameCategory(categoryId, renameValue);
      setRenamingCategory(false);
      await loadCategories(categoryId);
    } catch (err) {
      setCategoryActionError(err instanceof ApiRequestError ? err.message : "Failed to rename category");
    } finally {
      setCategoryBusy(false);
    }
  }

  function updateItem(id: string, patch: Partial<EditableItem>) {
    setItems((prev) => (prev ? prev.map((i) => (i.id === id ? { ...i, ...patch } : i)) : prev));
  }

  function removeItem(id: string) {
    setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
  }

  function addItem() {
    setItems((prev) => [
      ...(prev ?? []),
      { id: newLocalId(), section: "General", label: "", inputType: "boolean", isCritical: false, isNew: true },
    ]);
  }

  async function handleSave() {
    if (!items) return;
    const emptyLabels = items.filter((i) => !i.label.trim() || !i.section.trim());
    if (emptyLabels.length > 0) {
      setError("Every item needs a section and a label.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api.updateChecklistTemplate(
        categoryId,
        items.map((i) => ({
          id: i.isNew ? undefined : i.id,
          section: i.section,
          label: i.label,
          inputType: i.inputType,
          isCritical: i.isCritical,
        }))
      );
      setSuccess(true);
      const refreshed = await api.checklistTemplate(categoryId);
      setItems(refreshed.items);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save checklist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Checklist Templates"
        subtitle="Configure the equipment categories and their inspection checklists"
        action={<Button onClick={() => setShowNewCategory((v) => !v)}>{showNewCategory ? "Cancel" : "New category"}</Button>}
      />

      {categoryActionError && (
        <div className="mb-4">
          <ErrorBanner message={categoryActionError} />
        </div>
      )}

      {showNewCategory && (
        <Card className="mb-4">
          <p className="mb-3 font-display text-sm font-semibold text-ink-primary">New equipment category</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Category name">
              <input
                className={inputClass}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g. Rescue Boat"
              />
            </Field>
            <Button disabled={categoryBusy || !newCategoryName.trim()} onClick={handleCreateCategory}>
              {categoryBusy ? "Creating…" : "Create"}
            </Button>
          </div>
        </Card>
      )}

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="max-w-xs">
          <Field label="Equipment category">
            <select
              className={inputClass}
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setRenamingCategory(false);
              }}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {categoryId && !renamingCategory && (
          <button
            onClick={() => {
              setRenameValue(categories.find((c) => c.id === categoryId)?.name ?? "");
              setRenamingCategory(true);
            }}
            className="pb-2.5 text-xs font-medium text-brand underline"
          >
            Rename category
          </button>
        )}
        {renamingCategory && (
          <>
            <div className="max-w-xs">
              <Field label="New name">
                <input className={inputClass} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
              </Field>
            </div>
            <Button disabled={categoryBusy || !renameValue.trim()} onClick={handleRenameCategory} className="text-xs">
              {categoryBusy ? "Saving…" : "Save name"}
            </Button>
            <Button variant="ghost" onClick={() => setRenamingCategory(false)} className="text-xs">
              Cancel
            </Button>
          </>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-md border border-status-active/30 bg-status-active/5 px-4 py-3 text-sm text-status-active">
          Checklist saved. Removed items are retired, not deleted — past inspections that used them stay intact.
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : !items ? null : items.length === 0 ? (
        <div className="mb-4">
          <EmptyState title="No checklist template yet for this category" hint="Add items below to create one." />
        </div>
      ) : (
        <>
          {/* Desktop / wide screens: table */}
          <Card className="mb-4 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-surface-hairline text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="pb-2 pr-3">Section</th>
                  <th className="pb-2 pr-3">Label</th>
                  <th className="pb-2 pr-3">Input type</th>
                  <th className="pb-2 pr-3">Critical</th>
                  <th className="pb-2">Remove</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-surface-hairline last:border-0">
                    <td className="py-2 pr-3">
                      <input
                        className={inputClass}
                        value={item.section}
                        onChange={(e) => updateItem(item.id, { section: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input className={inputClass} value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className={inputClass}
                        value={item.inputType}
                        onChange={(e) => updateItem(item.id, { inputType: e.target.value as InputType })}
                      >
                        {INPUT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3 text-center">
                      <input
                        type="checkbox"
                        checked={item.isCritical}
                        onChange={(e) => updateItem(item.id, { isCritical: e.target.checked })}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="py-2">
                      <button onClick={() => removeItem(item.id)} className="text-xs font-medium text-status-critical underline">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Phone screens: stacked cards */}
          <div className="mb-4 space-y-3 sm:hidden">
            {items.map((item) => (
              <Card key={item.id}>
                <div className="space-y-3">
                  <Field label="Section">
                    <input
                      className={inputClass}
                      value={item.section}
                      onChange={(e) => updateItem(item.id, { section: e.target.value })}
                    />
                  </Field>
                  <Field label="Label">
                    <input className={inputClass} value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} />
                  </Field>
                  <Field label="Input type">
                    <select
                      className={inputClass}
                      value={item.inputType}
                      onChange={(e) => updateItem(item.id, { inputType: e.target.value as InputType })}
                    >
                      {INPUT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-ink-primary">
                    <input
                      type="checkbox"
                      checked={item.isCritical}
                      onChange={(e) => updateItem(item.id, { isCritical: e.target.checked })}
                      className="h-4 w-4"
                    />
                    Critical
                  </label>
                  <button onClick={() => removeItem(item.id)} className="text-xs font-medium text-status-critical underline">
                    Remove
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {items && (
        <div className="flex gap-3">
          <Button variant="secondary" onClick={addItem}>
            + Add item
          </Button>
          <Button onClick={handleSave} disabled={saving || items.length === 0}>
            {saving ? "Saving…" : "Save checklist"}
          </Button>
        </div>
      )}
    </div>
  );
}
