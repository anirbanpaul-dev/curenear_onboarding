'use client';

import { useState, type ReactNode } from 'react';
import {
  councilKindLabels,
  councilKinds,
  providerTypeLabels,
  providerTypes,
  systemOfMedicineLabels,
  systemsOfMedicineCodes,
} from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  CouncilDto,
  DocumentTypeDto,
  PincodeStatsDto,
  ServiceCategoryDto,
  SpecialtyDto,
  StateDto,
} from '@/lib/types';
import { PincodePanel } from './pincode-panel';

/**
 * Admin master data: the four editable reference lists plus the read-only PIN
 * directory. Rows are retired rather than deleted so providers that already
 * reference them keep working; the API writes an audit row for every change.
 */

type TabId = 'specialties' | 'councils' | 'categories' | 'documents' | 'pincodes';

interface Toast {
  tone: 'success' | 'error';
  message: string;
}

function useCollection<T extends { id: string }>(initial: T[]) {
  const [rows, setRows] = useState<T[]>(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const upsert = (row: T): void => {
    setRows((previous) => {
      const exists = previous.some((entry) => entry.id === row.id);
      return exists
        ? previous.map((entry) => (entry.id === row.id ? row : entry))
        : [...previous, row];
    });
  };

  async function run(action: () => Promise<void>, success: string): Promise<void> {
    setBusy(true);
    setToast(null);
    try {
      await action();
      setToast({ tone: 'success', message: success });
    } catch (error) {
      setToast({
        tone: 'error',
        message: error instanceof ApiClientError ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  }

  return { rows, upsert, busy, toast, setToast, run };
}

function ToastLine({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return (
    <p
      role="status"
      className={
        toast.tone === 'success'
          ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
          : 'rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive'
      }
    >
      {toast.message}
    </p>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Retired'}</Badge>;
}

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-foreground/30"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="master-modal-title"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-5 shadow-xl"
      >
        <h2 id="master-modal-title" className="text-base font-semibold">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function ActionButtons({
  active,
  busy,
  onEdit,
  onToggle,
}: {
  active: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={onEdit}>
        Edit
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onToggle}>
        {active ? 'Retire' : 'Restore'}
      </Button>
    </div>
  );
}

// --- Specialties -----------------------------------------------------------

function SpecialtyTab({ initial }: { initial: SpecialtyDto[] }) {
  const collection = useCollection(initial);
  const [editing, setEditing] = useState<SpecialtyDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', systemOfMedicine: 'allopathy' });

  function openCreate(): void {
    setForm({ code: '', name: '', systemOfMedicine: 'allopathy' });
    setCreating(true);
  }

  function openEdit(row: SpecialtyDto): void {
    setForm({ code: row.code, name: row.name, systemOfMedicine: row.systemOfMedicine });
    setEditing(row);
  }

  async function save(): Promise<void> {
    await collection.run(
      async () => {
        if (editing) {
          const result = await api.patch<SpecialtyDto>(
            `/api/v1/admin/master/specialties/${editing.id}`,
            form,
          );
          collection.upsert(result.data);
        } else {
          const result = await api.post<SpecialtyDto>('/api/v1/admin/master/specialties', form);
          collection.upsert(result.data);
        }
        setEditing(null);
        setCreating(false);
      },
      editing ? 'Specialty updated.' : 'Specialty added.',
    );
  }

  async function toggle(row: SpecialtyDto): Promise<void> {
    await collection.run(
      async () => {
        const result = row.isActive
          ? await api.delete<SpecialtyDto>(`/api/v1/admin/master/specialties/${row.id}`)
          : await api.patch<SpecialtyDto>(`/api/v1/admin/master/specialties/${row.id}`, {
              isActive: true,
            });
        collection.upsert(result.data);
      },
      row.isActive ? 'Specialty retired.' : 'Specialty restored.',
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Specialties</CardTitle>
          <CardDescription>
            {collection.rows.length} rows, grouped by system of medicine.
          </CardDescription>
        </div>
        <Button onClick={openCreate} data-testid="add-specialty">
          Add specialty
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <ToastLine toast={collection.toast} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>System</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {collection.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>
                  {systemOfMedicineLabels[
                    row.systemOfMedicine as keyof typeof systemOfMedicineLabels
                  ] ?? row.systemOfMedicine}
                </TableCell>
                <TableCell>
                  <StatusBadge active={row.isActive} />
                </TableCell>
                <TableCell>
                  <ActionButtons
                    active={row.isActive}
                    busy={collection.busy}
                    onEdit={() => openEdit(row)}
                    onToggle={() => void toggle(row)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      {creating || editing ? (
        <Modal
          title={editing ? 'Edit specialty' : 'Add specialty'}
          description="Code is the stable key forms store; renaming it affects new selections only."
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div>
              <Label htmlFor="specialty-code" required>
                Code
              </Label>
              <Input
                id="specialty-code"
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="specialty-name" required>
                Name
              </Label>
              <Input
                id="specialty-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="specialty-system" required>
                System of medicine
              </Label>
              <Select
                id="specialty-system"
                value={form.systemOfMedicine}
                onChange={(event) => setForm({ ...form, systemOfMedicine: event.target.value })}
              >
                {systemsOfMedicineCodes.map((system) => (
                  <option key={system} value={system}>
                    {systemOfMedicineLabels[system]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={collection.busy}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Card>
  );
}

// --- Councils --------------------------------------------------------------

function CouncilTab({ initial, states }: { initial: CouncilDto[]; states: StateDto[] }) {
  const collection = useCollection(initial);
  const [editing, setEditing] = useState<CouncilDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', kind: 'medical', stateId: '' });

  function openCreate(): void {
    setForm({ code: '', name: '', kind: 'medical', stateId: '' });
    setCreating(true);
  }

  function openEdit(row: CouncilDto): void {
    setForm({ code: row.code, name: row.name, kind: row.kind, stateId: row.stateId ?? '' });
    setEditing(row);
  }

  async function save(): Promise<void> {
    const payload = { ...form, stateId: form.stateId || null };
    await collection.run(
      async () => {
        if (editing) {
          const result = await api.patch<CouncilDto>(
            `/api/v1/admin/master/councils/${editing.id}`,
            payload,
          );
          collection.upsert(result.data);
        } else {
          const result = await api.post<CouncilDto>('/api/v1/admin/master/councils', payload);
          collection.upsert(result.data);
        }
        setEditing(null);
        setCreating(false);
      },
      editing ? 'Council updated.' : 'Council added.',
    );
  }

  async function toggle(row: CouncilDto): Promise<void> {
    await collection.run(
      async () => {
        const result = row.isActive
          ? await api.delete<CouncilDto>(`/api/v1/admin/master/councils/${row.id}`)
          : await api.patch<CouncilDto>(`/api/v1/admin/master/councils/${row.id}`, {
              isActive: true,
            });
        collection.upsert(result.data);
      },
      row.isActive ? 'Council retired.' : 'Council restored.',
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Councils</CardTitle>
          <CardDescription>
            Registering authorities for doctors, pharmacists and nurses.
          </CardDescription>
        </div>
        <Button onClick={openCreate} data-testid="add-council">
          Add council
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <ToastLine toast={collection.toast} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {collection.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>
                  {councilKindLabels[row.kind as keyof typeof councilKindLabels] ?? row.kind}
                </TableCell>
                <TableCell>{row.stateName ?? 'National'}</TableCell>
                <TableCell>
                  <StatusBadge active={row.isActive} />
                </TableCell>
                <TableCell>
                  <ActionButtons
                    active={row.isActive}
                    busy={collection.busy}
                    onEdit={() => openEdit(row)}
                    onToggle={() => void toggle(row)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      {creating || editing ? (
        <Modal
          title={editing ? 'Edit council' : 'Add council'}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div>
              <Label htmlFor="council-code" required>
                Code
              </Label>
              <Input
                id="council-code"
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="council-name" required>
                Name
              </Label>
              <Input
                id="council-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="council-kind" required>
                  Kind
                </Label>
                <Select
                  id="council-kind"
                  value={form.kind}
                  onChange={(event) => setForm({ ...form, kind: event.target.value })}
                >
                  {councilKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {councilKindLabels[kind]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="council-state">State</Label>
                <Select
                  id="council-state"
                  value={form.stateId}
                  onChange={(event) => setForm({ ...form, stateId: event.target.value })}
                >
                  <option value="">National (no state)</option>
                  {states.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={collection.busy}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Card>
  );
}

// --- Service categories ----------------------------------------------------

function CategoryTab({ initial }: { initial: ServiceCategoryDto[] }) {
  const collection = useCollection(initial);
  const [editing, setEditing] = useState<ServiceCategoryDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', providerType: 'doctor' });

  function openCreate(): void {
    setForm({ code: '', name: '', providerType: 'doctor' });
    setCreating(true);
  }

  function openEdit(row: ServiceCategoryDto): void {
    setForm({ code: row.code, name: row.name, providerType: row.providerType });
    setEditing(row);
  }

  async function save(): Promise<void> {
    await collection.run(
      async () => {
        if (editing) {
          const result = await api.patch<ServiceCategoryDto>(
            `/api/v1/admin/master/service-categories/${editing.id}`,
            form,
          );
          collection.upsert(result.data);
        } else {
          const result = await api.post<ServiceCategoryDto>(
            '/api/v1/admin/master/service-categories',
            form,
          );
          collection.upsert(result.data);
        }
        setEditing(null);
        setCreating(false);
      },
      editing ? 'Service category updated.' : 'Service category added.',
    );
  }

  async function toggle(row: ServiceCategoryDto): Promise<void> {
    await collection.run(
      async () => {
        const result = row.isActive
          ? await api.delete<ServiceCategoryDto>(
              `/api/v1/admin/master/service-categories/${row.id}`,
            )
          : await api.patch<ServiceCategoryDto>(
              `/api/v1/admin/master/service-categories/${row.id}`,
              { isActive: true },
            );
        collection.upsert(result.data);
      },
      row.isActive ? 'Service category retired.' : 'Service category restored.',
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Service categories</CardTitle>
          <CardDescription>
            Offerings a provider type can list — home care, clinic, diagnostic and pharmacy
            categories from the field spec.
          </CardDescription>
        </div>
        <Button onClick={openCreate} data-testid="add-service-category">
          Add category
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <ToastLine toast={collection.toast} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Provider type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {collection.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>
                  {providerTypeLabels[row.providerType as keyof typeof providerTypeLabels] ??
                    row.providerType}
                </TableCell>
                <TableCell>
                  <StatusBadge active={row.isActive} />
                </TableCell>
                <TableCell>
                  <ActionButtons
                    active={row.isActive}
                    busy={collection.busy}
                    onEdit={() => openEdit(row)}
                    onToggle={() => void toggle(row)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      {creating || editing ? (
        <Modal
          title={editing ? 'Edit service category' : 'Add service category'}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div>
              <Label htmlFor="category-code" required>
                Code
              </Label>
              <Input
                id="category-code"
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="category-name" required>
                Name
              </Label>
              <Input
                id="category-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="category-provider" required>
                Provider type
              </Label>
              <Select
                id="category-provider"
                value={form.providerType}
                onChange={(event) => setForm({ ...form, providerType: event.target.value })}
              >
                {providerTypes.map((type) => (
                  <option key={type} value={type}>
                    {providerTypeLabels[type]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={collection.busy}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Card>
  );
}

// --- Document types --------------------------------------------------------

function DocumentTab({ initial }: { initial: DocumentTypeDto[] }) {
  const collection = useCollection(initial);
  const [editing, setEditing] = useState<DocumentTypeDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    providerTypes: [] as string[],
    requiresExpiry: false,
    reminderDays: '',
  });

  function openCreate(): void {
    setForm({
      code: '',
      name: '',
      providerTypes: [],
      requiresExpiry: false,
      reminderDays: '',
    });
    setCreating(true);
  }

  function openEdit(row: DocumentTypeDto): void {
    setForm({
      code: row.code,
      name: row.name,
      providerTypes: row.providerTypes,
      requiresExpiry: row.requiresExpiry,
      reminderDays: row.expiryReminderDays.join(', '),
    });
    setEditing(row);
  }

  function payload() {
    return {
      code: form.code,
      name: form.name,
      providerTypes: form.providerTypes,
      requiresExpiry: form.requiresExpiry,
      expiryReminderDays: form.requiresExpiry
        ? form.reminderDays
            .split(',')
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isInteger(value) && value >= 0)
        : [],
    };
  }

  async function save(): Promise<void> {
    await collection.run(
      async () => {
        if (editing) {
          const result = await api.patch<DocumentTypeDto>(
            `/api/v1/admin/master/document-types/${editing.id}`,
            payload(),
          );
          collection.upsert(result.data);
        } else {
          const result = await api.post<DocumentTypeDto>(
            '/api/v1/admin/master/document-types',
            payload(),
          );
          collection.upsert(result.data);
        }
        setEditing(null);
        setCreating(false);
      },
      editing ? 'Document type updated.' : 'Document type added.',
    );
  }

  async function toggle(row: DocumentTypeDto): Promise<void> {
    await collection.run(
      async () => {
        const result = row.isActive
          ? await api.delete<DocumentTypeDto>(`/api/v1/admin/master/document-types/${row.id}`)
          : await api.patch<DocumentTypeDto>(`/api/v1/admin/master/document-types/${row.id}`, {
              isActive: true,
            });
        collection.upsert(result.data);
      },
      row.isActive ? 'Document type retired.' : 'Document type restored.',
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Document types</CardTitle>
          <CardDescription>
            What each provider type must upload, and which of those expire.
          </CardDescription>
        </div>
        <Button onClick={openCreate} data-testid="add-document-type">
          Add document type
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <ToastLine toast={collection.toast} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Provider types</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {collection.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-xs">
                  {row.providerTypes
                    .map((type) => providerTypeLabels[type as keyof typeof providerTypeLabels])
                    .join(', ')}
                </TableCell>
                <TableCell className="text-xs">
                  {row.requiresExpiry
                    ? row.expiryReminderDays.length > 0
                      ? `${row.expiryReminderDays.join('/')} days before`
                      : 'Required'
                    : '—'}
                </TableCell>
                <TableCell>
                  <StatusBadge active={row.isActive} />
                </TableCell>
                <TableCell>
                  <ActionButtons
                    active={row.isActive}
                    busy={collection.busy}
                    onEdit={() => openEdit(row)}
                    onToggle={() => void toggle(row)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      {creating || editing ? (
        <Modal
          title={editing ? 'Edit document type' : 'Add document type'}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div>
              <Label htmlFor="document-code" required>
                Code
              </Label>
              <Input
                id="document-code"
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="document-name" required>
                Name
              </Label>
              <Input
                id="document-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <fieldset>
              <legend className="text-sm font-medium leading-none">Provider types</legend>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {providerTypes.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.providerTypes.includes(type)}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          providerTypes: event.target.checked
                            ? [...form.providerTypes, type]
                            : form.providerTypes.filter((value) => value !== type),
                        })
                      }
                    />
                    {providerTypeLabels[type]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.requiresExpiry}
                onChange={(event) => setForm({ ...form, requiresExpiry: event.target.checked })}
              />
              Has an expiry date
            </label>
            {form.requiresExpiry ? (
              <div>
                <Label htmlFor="document-reminders">Reminder days</Label>
                <Input
                  id="document-reminders"
                  placeholder="60, 30, 7"
                  value={form.reminderDays}
                  onChange={(event) => setForm({ ...form, reminderDays: event.target.value })}
                />
                <p className="field-help">Days before expiry, comma separated.</p>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={collection.busy}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Card>
  );
}

// --- Workspace -------------------------------------------------------------

export interface MasterDataWorkspaceProps {
  initialSpecialties: SpecialtyDto[];
  initialCouncils: CouncilDto[];
  initialServiceCategories: ServiceCategoryDto[];
  initialDocumentTypes: DocumentTypeDto[];
  states: StateDto[];
  pincodeStats: PincodeStatsDto;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'specialties', label: 'Specialties' },
  { id: 'councils', label: 'Councils' },
  { id: 'categories', label: 'Service categories' },
  { id: 'documents', label: 'Document types' },
  { id: 'pincodes', label: 'PIN codes' },
];

export function MasterDataWorkspace(props: MasterDataWorkspaceProps) {
  const [tab, setTab] = useState<TabId>('specialties');

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Master data lists" className="flex flex-wrap gap-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={
              tab === entry.id
                ? 'rounded-md border bg-accent px-3 py-1.5 text-sm font-medium'
                : 'rounded-md border border-transparent px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/60'
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'specialties' ? <SpecialtyTab initial={props.initialSpecialties} /> : null}
      {tab === 'councils' ? (
        <CouncilTab initial={props.initialCouncils} states={props.states} />
      ) : null}
      {tab === 'categories' ? <CategoryTab initial={props.initialServiceCategories} /> : null}
      {tab === 'documents' ? <DocumentTab initial={props.initialDocumentTypes} /> : null}
      {tab === 'pincodes' ? <PincodePanel stats={props.pincodeStats} /> : null}
    </div>
  );
}
