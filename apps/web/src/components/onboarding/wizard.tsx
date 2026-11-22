'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formSectionsFor, isOwnerEditableStatus, type ProviderSection } from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { Badge } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn, formatDateTime } from '@/lib/utils';
import { SectionEditor } from './sections';
import { ClinicDoctorsSection } from './clinic-sections';
import { ConsentSection } from './consent-section';
import { allSectionValues, initialSectionValues, isFieldVisible } from './section-values';
import type { CompletenessDto, ConsentOverviewDto, OrganizationDetailDto } from '@/lib/types';

type SectionState = 'empty' | 'in_progress' | 'complete' | 'has_errors';

const stateTone = {
  empty: 'neutral',
  in_progress: 'warning',
  complete: 'success',
  has_errors: 'danger',
} as const;

const stateLabel = {
  empty: 'Empty',
  in_progress: 'In progress',
  complete: 'Complete',
  has_errors: 'Has errors',
} as const;

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    return value.length === 0
      ? '—'
      : value
          .map((entry) =>
            typeof entry === 'object' ? Object.values(entry as object).join(' / ') : String(entry),
          )
          .join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined && entry !== '')
      .map(([key, entry]) => `${key}: ${String(entry)}`)
      .join(', ');
  }
  return String(value);
}

export function OnboardingWizard({ initial }: { initial: OrganizationDetailDto }) {
  const [detail, setDetail] = useState(initial);
  const [activeKey, setActiveKey] = useState<string>(() => {
    const first = formSectionsFor(initial.organization.providerType).find(
      (section) => !section.notInProviderForm,
    );
    return first?.key ?? 'review';
  });
  const [errorSections, setErrorSections] = useState<Set<string>>(new Set());
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const saveHandlers = useRef(new Map<string, () => Promise<void>>());
  const [version, setVersion] = useState(initial.organization.version);
  const [consentOverview, setConsentOverview] = useState<ConsentOverviewDto | null>(null);

  const organization = detail.organization;
  const editable = isOwnerEditableStatus(organization.status) && !conflict;
  const sections = useMemo(
    () =>
      formSectionsFor(organization.providerType).filter((section) => !section.notInProviderForm),
    [organization.providerType],
  );
  const values = useMemo(() => allSectionValues(sections, organization), [sections, organization]);
  const clinicDoctorsSection = useMemo(
    () =>
      organization.providerType === 'clinic'
        ? (formSectionsFor('clinic').find((section) => section.key === 'clinic_doctors') ?? null)
        : null,
    [organization.providerType],
  );
  const activeSection = sections.find((section) => section.key === activeKey) ?? null;
  const steps: Array<{ key: string; title: string }> = [
    ...sections.map((section) => ({ key: section.key, title: section.title })),
    ...(clinicDoctorsSection ? [{ key: 'clinic_doctors', title: 'Doctors' }] : []),
    { key: 'consent', title: 'Consent and agreement' },
    { key: 'review', title: 'Review and submit' },
  ];

  useEffect(() => {
    let active = true;
    api
      .get<ConsentOverviewDto>(`/api/v1/providers/${organization.id}/consents`)
      .then((response) => {
        if (active) setConsentOverview(response.data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [organization.id, organization.version]);
  const activeIndex = steps.findIndex((step) => step.key === activeKey);

  const refresh = useCallback(async () => {
    const response = await api.get<OrganizationDetailDto>(`/api/v1/providers/${organization.id}`);
    setDetail(response.data);
    setVersion(response.data.organization.version);
    setConflict(false);
  }, [organization.id]);

  const registerSave = useCallback((key: string, save: () => Promise<void>) => {
    saveHandlers.current.set(key, save);
  }, []);

  const registerDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((current) => {
      if (current.has(key) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent): void {
      if (dirtyKeys.size === 0) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirtyKeys]);

  function onError(caught: unknown): void {
    if (caught instanceof ApiClientError && caught.code === 'VERSION_CONFLICT') {
      setConflict(true);
      return;
    }
    setErrorSections((current) => new Set(current).add(activeKey));
    setError(caught instanceof ApiClientError ? caught.message : 'Something went wrong.');
  }

  async function saveDraft(): Promise<void> {
    setError(null);
    const handler = saveHandlers.current.get(activeKey);
    if (!handler) {
      setStatus('Use the save button inside this section.');
      return;
    }
    await handler();
  }

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/v1/providers/${organization.id}/submit`, { version });
      setStatus('Submitted for verification');
      await refresh();
      setActiveKey('review');
    } catch (caught) {
      onError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  const completeness: CompletenessDto = detail.completeness;
  const completed = completeness.sections.filter((section) => section.status === 'complete').length;
  const progress = sections.length === 0 ? 0 : Math.round((completed / sections.length) * 100);
  const clinicDoctors = detail.clinicDoctors ?? [];
  const inchargeId =
    typeof organization.typeData.clinic_incharge === 'string'
      ? organization.typeData.clinic_incharge
      : '';
  const clinicDoctorsReady =
    organization.providerType !== 'clinic' ||
    (clinicDoctors.length > 0 && clinicDoctors.some((row) => row.doctor.id === inchargeId));
  const missingLabels = completeness.missingRequiredFields.map((key) => {
    for (const section of sections) {
      const field = section.fields.find((entry) => entry.key === key);
      if (field) return field.label;
    }
    return key;
  });

  const onSaved = useCallback((key: string) => {
    setErrorSections((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setError(null);
  }, []);

  function stateFor(section: ProviderSection): SectionState {
    if (errorSections.has(section.key)) return 'has_errors';
    const report = completeness.sections.find((entry) => entry.key === section.key);
    return report?.status ?? 'empty';
  }

  const readOnly = !editable;

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div>
          <p className="text-xs text-muted-foreground">Progress</p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {completed} of {sections.length} sections complete · {progress}%
          </p>
        </div>
        <div className="lg:hidden">
          <label htmlFor="wizard-step" className="sr-only">
            Step
          </label>
          <select
            id="wizard-step"
            className="w-full rounded-md border border-input bg-card p-2 text-sm"
            value={activeKey}
            onChange={(event) => setActiveKey(event.target.value)}
          >
            {steps.map((step) => (
              <option key={step.key} value={step.key}>
                {step.title}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label="Form sections" className="hidden space-y-1 lg:block">
          {sections.map((section) => {
            const state = stateFor(section);
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveKey(section.key)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                  activeKey === section.key ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                )}
              >
                <span className="truncate">{section.title}</span>
                <Badge tone={stateTone[state]}>{stateLabel[state]}</Badge>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setActiveKey('consent')}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm',
              activeKey === 'consent' ? 'bg-accent font-medium' : 'hover:bg-accent/60',
            )}
          >
            <span className="truncate">Consent and agreement</span>
            <Badge
              tone={consentOverview && consentOverview.gaps.length === 0 ? 'success' : 'neutral'}
            >
              {consentOverview ? `${consentOverview.gaps.length} left` : '—'}
            </Badge>
          </button>
          {clinicDoctorsSection ? (
            <button
              type="button"
              onClick={() => setActiveKey('clinic_doctors')}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                activeKey === 'clinic_doctors' ? 'bg-accent font-medium' : 'hover:bg-accent/60',
              )}
            >
              <span className="truncate">Doctors</span>
              <Badge tone={clinicDoctorsReady ? 'success' : 'neutral'}>
                {clinicDoctors.length > 0 ? `${clinicDoctors.length}` : 'None'}
              </Badge>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setActiveKey('review')}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm',
              activeKey === 'review' ? 'bg-accent font-medium' : 'hover:bg-accent/60',
            )}
          >
            Review and submit
          </button>
        </nav>
      </aside>

      <div className="min-w-0 space-y-6 pb-24">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {organization.code} · {organization.providerType.replace('_', ' ')}
            </p>
            <h1 className="text-2xl font-semibold">{organization.legalName ?? 'Provider draft'}</h1>
          </div>
          <Badge tone={organization.status === 'SUBMITTED' ? 'info' : 'neutral'}>
            {organization.status.replace('_', ' ')}
          </Badge>
        </div>

        {detail.changeRequest ? (
          <div
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              Changes requested by the reviewer
            </p>
            <p className="mt-1 whitespace-pre-line">{detail.changeRequest.comment}</p>
            <p className="mt-1 text-xs text-amber-800">{formatDateTime(detail.changeRequest.at)}</p>
            {(detail.reviewComments ?? []).length > 0 ? (
              <ul className="mt-2 space-y-1.5 border-t border-amber-200 pt-2">
                {(detail.reviewComments ?? []).map((comment) => (
                  <li key={comment.id}>
                    <span className="font-medium capitalize">
                      {comment.sectionKey.replace(/_/g, ' ')}:
                    </span>{' '}
                    {comment.body}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {conflict ? (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <p>This provider changed since you loaded it. Reload to fetch the latest version.</p>
            <Button size="sm" onClick={() => void refresh()}>
              Reload provider
            </Button>
          </div>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {status ? (
          <p role="status" className="text-sm text-emerald-700">
            {status}
          </p>
        ) : null}

        {activeKey === 'review' ? (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Review and submit</h2>
              <p className="text-xs text-muted-foreground">
                Check each section, then submit. Submission locks the form until an administrator
                reviews it.
              </p>
            </div>
            {missingLabels.length > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Missing required items</p>
                <ul className="mt-1 list-disc pl-5">
                  {missingLabels.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-emerald-700">All required items are complete.</p>
            )}
            {consentOverview && consentOverview.gaps.length > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Consents still outstanding</p>
                <ul className="mt-1 list-disc pl-5">
                  {consentOverview.gaps.map((gap) => (
                    <li key={`${gap.kind}:${gap.key}`}>{gap.label}</li>
                  ))}
                </ul>
                <Button
                  variant="link"
                  size="sm"
                  className="px-0"
                  onClick={() => setActiveKey('consent')}
                >
                  Open consent and agreement
                </Button>
              </div>
            ) : null}
            {organization.providerType === 'clinic' && !clinicDoctorsReady ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Clinic doctors</p>
                <p>
                  Add at least one doctor and select the in-charge doctor in the Doctors step before
                  submitting.
                </p>
              </div>
            ) : null}
            <div className="space-y-3">
              {sections.map((section) => {
                const localValues = initialSectionValues(section, organization);
                const visible = section.fields.filter(
                  (field) =>
                    field.storage.kind !== 'related' &&
                    isFieldVisible(field, values, organization.providerType),
                );
                const related =
                  section.key === 'locations'
                    ? `${detail.locations.length} location(s)`
                    : section.key === 'contacts'
                      ? `${detail.contacts.length} contact(s)`
                      : section.key === 'insurance'
                        ? `${detail.insurance.length} policy(ies)`
                        : section.key === 'service_area'
                          ? `${detail.servicePins.length} PIN code(s)`
                          : section.key === 'registered_office'
                            ? detail.locations.some((row) => row.isPrimary)
                              ? 'Registered office saved'
                              : 'No registered office'
                            : null;
                return (
                  <div key={section.key} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">{section.title}</h3>
                      <Button variant="link" size="sm" onClick={() => setActiveKey(section.key)}>
                        Edit
                      </Button>
                    </div>
                    {related ? <p className="text-sm text-muted-foreground">{related}</p> : null}
                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      {visible.slice(0, 8).map((field) => (
                        <div key={field.key} className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">{field.label}</dt>
                          <dd className="text-right">{formatValue(localValues[field.key])}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                );
              })}
            </div>
            {organization.status === 'SUBMITTED' ? (
              <p className="text-sm text-muted-foreground">
                This provider is submitted and read-only until it is reviewed.
              </p>
            ) : (
              <Button
                onClick={submit}
                disabled={
                  submitting ||
                  !completeness.complete ||
                  !clinicDoctorsReady ||
                  !consentOverview ||
                  consentOverview.gaps.length > 0
                }
              >
                Submit for verification
              </Button>
            )}
          </section>
        ) : activeKey === 'consent' ? (
          <ConsentSection
            provider={detail}
            disabled={readOnly}
            overview={consentOverview}
            onChanged={(next) => {
              setConsentOverview(next);
              void refresh();
            }}
            onError={onError}
          />
        ) : activeKey === 'clinic_doctors' && clinicDoctorsSection ? (
          <ClinicDoctorsSection
            provider={detail}
            section={clinicDoctorsSection}
            values={values}
            disabled={readOnly}
            registerSave={registerSave}
            registerDirty={registerDirty}
            refresh={refresh}
            onError={onError}
            onSaved={onSaved}
          />
        ) : activeSection ? (
          <SectionEditor
            provider={detail}
            section={activeSection}
            values={values}
            disabled={readOnly}
            registerSave={registerSave}
            registerDirty={registerDirty}
            refresh={refresh}
            onError={onError}
            onSaved={onSaved}
          />
        ) : null}

        <footer className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 px-4 py-3 backdrop-blur lg:left-auto lg:right-0 lg:w-[calc(100%-16rem)]">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={activeIndex <= 0}
              onClick={() => setActiveKey(steps[Math.max(0, activeIndex - 1)]?.key ?? activeKey)}
            >
              Back
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={readOnly || activeKey === 'review'}
                onClick={() => void saveDraft()}
              >
                Save draft
              </Button>
              <Button
                size="sm"
                disabled={activeIndex >= steps.length - 1}
                onClick={() =>
                  setActiveKey(steps[Math.min(steps.length - 1, activeIndex + 1)]?.key ?? activeKey)
                }
              >
                Next
              </Button>
            </div>
          </div>
        </footer>

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/staff/providers" className={buttonVariants({ variant: 'link', size: 'sm' })}>
            Back to my providers
          </Link>
        </p>
      </div>
    </div>
  );
}
