'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { consentMethodLabels, consentTextVersion, type ConsentMethod } from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/utils';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DocumentUploader } from '@/components/documents/document-uploader';
import type {
  ConsentMethodDto,
  ConsentOverviewDto,
  DocumentTypeDto,
  OrganizationDetailDto,
} from '@/lib/types';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

/** Uploads evidence and registers it against the provider document list. */
function EvidenceUploader({
  providerId,
  role,
  label,
  onUploaded,
}: {
  providerId: string;
  role: string;
  label: string;
  onUploaded: (documentId: string) => void;
}) {
  const [types, setTypes] = useState<DocumentTypeDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<DocumentTypeDto[]>('/api/v1/master/document-types')
      .then((response) => setTypes(response.data))
      .catch(() => setTypes([]));
  }, []);

  const documentType = types[0];

  async function register(document: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string | null;
  }): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string }>(`/api/v1/providers/${providerId}/documents`, {
        file_name: document.fileName,
        mime_type: document.mimeType,
        size_bytes: document.sizeBytes,
        ...(document.storageKey ? { storage_key: document.storageKey } : {}),
        role,
      });
      onUploaded(created.data.id);
    } catch (caught) {
      setError(messageFor(caught, 'Uploaded, but the evidence could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  if (!documentType) {
    return (
      <p className="text-xs text-muted-foreground">
        Upload the file from the Documents step, then pick it here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <DocumentUploader
        ownerType="provider_organization"
        ownerId={providerId}
        requirement={{
          key: role,
          label,
          requirement: 'required',
          section: 'consent',
          clause: '3.9',
        }}
        documentType={{
          id: documentType.id,
          code: documentType.code,
          name: documentType.name,
          requiresExpiry: false,
        }}
        onUploaded={(document) => void register(document)}
      />
      {busy ? <p className="text-xs text-muted-foreground">Recording evidence…</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function ConsentSection({
  provider,
  disabled,
  overview,
  onChanged,
  onError,
}: {
  provider: OrganizationDetailDto;
  disabled: boolean;
  overview: ConsentOverviewDto | null;
  onChanged: (overview: ConsentOverviewDto) => void;
  onError: (error: unknown) => void;
}) {
  const organizationId = provider.organization.id;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [publication, setPublication] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [method, setMethod] = useState<ConsentMethod>('IN_PERSON_ATTESTATION');
  const [attestationName, setAttestationName] = useState('');
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState('');
  const [signedOn, setSignedOn] = useState('');
  const [place, setPlace] = useState('');
  const [signatoryName, setSignatoryName] = useState('');
  const [designation, setDesignation] = useState('');
  const [signedDocumentId, setSignedDocumentId] = useState<string | null>(null);
  const [stampReference, setStampReference] = useState('');
  const [witnessName, setWitnessName] = useState('');
  const [witnessAddress, setWitnessAddress] = useState('');
  const [agreementMethod, setAgreementMethod] = useState<ConsentMethod>('SIGNED_FORM_UPLOAD');

  const [confirmationDoctor, setConfirmationDoctor] = useState('');
  const [confirmationUrl, setConfirmationUrl] = useState<string | null>(null);
  const [confirmationExpiry, setConfirmationExpiry] = useState<string | null>(null);

  const activeTemplate = overview?.activeTemplate ?? null;
  const declarations = overview?.declarations ?? [];

  const signatoryContact = useMemo(
    () => provider.contacts.find((contact) => contact.role === 'signatory') ?? null,
    [provider.contacts],
  );

  useEffect(() => {
    if (!activeTemplate) return;
    setTemplateId((current) => current || activeTemplate.id);
    setSignatoryName((current) => current || (signatoryContact?.name ?? ''));
    setDesignation((current) => current || (signatoryContact?.designation ?? ''));
    setPlace((current) => current || provider.locations.find((row) => row.isPrimary)?.city || '');
  }, [activeTemplate, provider.locations, signatoryContact]);

  const recordConsents = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    try {
      const items = [
        ...(publication ? [{ consent_type: 'publication' as const }] : []),
        ...(privacy ? [{ consent_type: 'data_privacy_notice' as const }] : []),
        ...[...checked].map((key) => ({
          consent_type: 'declarations' as const,
          declaration_key: key,
        })),
      ];
      if (items.length === 0) {
        setStatus('Tick at least one item to record.');
        return;
      }
      const response = await api.post<ConsentOverviewDto>(
        `/api/v1/providers/${organizationId}/consents`,
        {
          method,
          ...(evidenceId ? { evidence_document_id: evidenceId } : {}),
          ...(method === 'IN_PERSON_ATTESTATION' ? { attestation_name: attestationName } : {}),
          items,
        },
      );
      onChanged(response.data);
      setChecked(new Set());
      setPublication(false);
      setPrivacy(false);
      setEvidenceId(null);
      setStatus('Consent recorded with the text version shown.');
    } catch (error) {
      onError(error);
      setStatus(messageFor(error, 'Could not record the consent.'));
    } finally {
      setSaving(false);
    }
  }, [
    attestationName,
    checked,
    evidenceId,
    method,
    onChanged,
    onError,
    organizationId,
    privacy,
    publication,
  ]);

  async function acceptAgreement(): Promise<void> {
    setSaving(true);
    setStatus(null);
    try {
      const response = await api.post<ConsentOverviewDto>(
        `/api/v1/providers/${organizationId}/agreements`,
        {
          template_id: templateId,
          method: agreementMethod,
          signed_on: signedOn,
          place,
          signatory_name: signatoryName,
          signatory_designation: designation,
          ...(signedDocumentId ? { signed_document_id: signedDocumentId } : {}),
          ...(stampReference ? { stamp_reference: stampReference } : {}),
          ...(witnessName
            ? {
                witnesses: [
                  { name: witnessName, ...(witnessAddress ? { address: witnessAddress } : {}) },
                ],
              }
            : {}),
        },
      );
      onChanged(response.data);
      setStatus('Signed agreement recorded.');
    } catch (error) {
      onError(error);
      setStatus(messageFor(error, 'Could not record the agreement.'));
    } finally {
      setSaving(false);
    }
  }

  async function generateLink(): Promise<void> {
    setSaving(true);
    setStatus(null);
    try {
      const response = await api.post<{ url: string; expiresAt: string }>(
        `/api/v1/providers/${organizationId}/confirmation-requests`,
        confirmationDoctor ? { doctor_profile_id: confirmationDoctor } : {},
      );
      setConfirmationUrl(response.data.url);
      setConfirmationExpiry(response.data.expiresAt);
      setStatus('Confirmation link created. It can be used once and expires in 48 hours.');
    } catch (error) {
      onError(error);
      setStatus(messageFor(error, 'Could not create a confirmation link.'));
    } finally {
      setSaving(false);
    }
  }

  async function revoke(consentId: string): Promise<void> {
    const reason = window.prompt('Why is this consent being revoked?');
    if (!reason || reason.trim().length < 5) return;
    setSaving(true);
    try {
      const response = await api.post<ConsentOverviewDto>(
        `/api/v1/providers/${organizationId}/consents/${consentId}/revoke`,
        { reason: reason.trim() },
      );
      onChanged(response.data);
      setStatus('Consent revoked. Publication permission is off.');
    } catch (error) {
      onError(error);
      setStatus(messageFor(error, 'Could not revoke the consent.'));
    } finally {
      setSaving(false);
    }
  }

  async function openEvidence(consentId: string): Promise<void> {
    try {
      const response = await api.get<{ url: string }>(
        `/api/v1/providers/${organizationId}/consents/${consentId}/evidence`,
      );
      window.open(response.data.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      onError(error);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Consent and agreement</h2>
        <p className="text-xs text-muted-foreground">
          Section 3.9 and 9.1 · declarations are stored with the exact text version{' '}
          {consentTextVersion}.
        </p>
      </div>

      {overview ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-secondary/30 px-3 py-2 text-sm">
          <Badge tone={overview.gaps.length === 0 ? 'success' : 'warning'}>
            {overview.gaps.length === 0
              ? 'Consents complete'
              : `${overview.gaps.length} outstanding`}
          </Badge>
          {overview.gaps.map((gap) => (
            <span key={`${gap.kind}:${gap.key}`} className="text-xs text-muted-foreground">
              {gap.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading the consent record…</p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Declarations, publication and privacy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={publication}
              disabled={disabled}
              onChange={(event) => setPublication(event.target.checked)}
            />
            <span>
              Publication permission: CureNear may publish only the profile fields approved in
              Schedule A.
            </span>
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={privacy}
              disabled={disabled}
              onChange={(event) => setPrivacy(event.target.checked)}
            />
            <span>Privacy Notice read and data roles understood ({consentTextVersion}).</span>
          </label>

          <div className="space-y-2">
            {declarations.map((declaration) => (
              <label key={declaration.key} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked.has(declaration.key)}
                  disabled={disabled}
                  onChange={(event) =>
                    setChecked((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(declaration.key);
                      else next.delete(declaration.key);
                      return next;
                    })
                  }
                />
                <span>{declaration.text}</span>
              </label>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="consent-method">How was it captured?</Label>
              <Select
                id="consent-method"
                value={method}
                disabled={disabled}
                onChange={(event) => setMethod(event.target.value as ConsentMethod)}
              >
                {(
                  [
                    'IN_PERSON_ATTESTATION',
                    'SIGNED_FORM_UPLOAD',
                    'LINK_CONFIRMATION',
                    'OTP',
                  ] as const
                ).map((value) => (
                  <option key={value} value={value}>
                    {consentMethodLabels[value]}
                  </option>
                ))}
              </Select>
            </div>
            {method === 'IN_PERSON_ATTESTATION' ? (
              <div>
                <Label htmlFor="attested-by" required>
                  Attested by
                </Label>
                <Input
                  id="attested-by"
                  value={attestationName}
                  disabled={disabled}
                  onChange={(event) => setAttestationName(event.target.value)}
                  placeholder="Staff member who witnessed it"
                />
              </div>
            ) : null}
          </div>

          {method === 'SIGNED_FORM_UPLOAD' ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Upload the signed declaration form. Every access to the evidence is audited.
              </p>
              {evidenceId ? (
                <p className="text-xs text-emerald-700">Evidence attached.</p>
              ) : (
                <EvidenceUploader
                  providerId={organizationId}
                  role="consent_evidence"
                  label="Signed declaration form"
                  onUploaded={setEvidenceId}
                />
              )}
            </div>
          ) : null}

          <Button
            size="sm"
            onClick={() => void recordConsents()}
            disabled={
              disabled || saving || (method === 'IN_PERSON_ATTESTATION' && !attestationName)
            }
          >
            Record consent
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Partner agreement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {activeTemplate ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-secondary/20 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">
                    {activeTemplate.name} · {activeTemplate.version}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Effective {formatDate(activeTemplate.effectiveFrom)}
                  </p>
                </div>
                <a
                  href={`/api/v1/providers/${organizationId}/agreement-templates/${activeTemplate.id}/document`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Button variant="outline" size="sm">
                    Download pre-filled PDF
                  </Button>
                </a>
              </div>
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {overview?.agreementDeferredNote}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="agreement-date" required>
                    Date signed
                  </Label>
                  <Input
                    id="agreement-date"
                    type="date"
                    value={signedOn}
                    disabled={disabled}
                    onChange={(event) => setSignedOn(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="agreement-place" required>
                    Place
                  </Label>
                  <Input
                    id="agreement-place"
                    value={place}
                    disabled={disabled}
                    onChange={(event) => setPlace(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="agreement-name" required>
                    Signed by
                  </Label>
                  <Input
                    id="agreement-name"
                    value={signatoryName}
                    disabled={disabled}
                    onChange={(event) => setSignatoryName(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="agreement-designation" required>
                    Designation
                  </Label>
                  <Input
                    id="agreement-designation"
                    value={designation}
                    disabled={disabled}
                    onChange={(event) => setDesignation(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="agreement-method">Execution method</Label>
                  <Select
                    id="agreement-method"
                    value={agreementMethod}
                    disabled={disabled}
                    onChange={(event) => setAgreementMethod(event.target.value as ConsentMethod)}
                  >
                    <option value="SIGNED_FORM_UPLOAD">Upload signed copy</option>
                    <option value="IN_PERSON_ATTESTATION">Collected in person</option>
                    <option value="OTP">E-sign with OTP</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="agreement-stamp">Stamp / e-stamp reference</Label>
                  <Input
                    id="agreement-stamp"
                    value={stampReference}
                    disabled={disabled}
                    onChange={(event) => setStampReference(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="witness-name">Witness name</Label>
                  <Input
                    id="witness-name"
                    value={witnessName}
                    disabled={disabled}
                    onChange={(event) => setWitnessName(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="witness-address">Witness address</Label>
                  <Input
                    id="witness-address"
                    value={witnessAddress}
                    disabled={disabled}
                    onChange={(event) => setWitnessAddress(event.target.value)}
                  />
                </div>
              </div>
              {agreementMethod === 'SIGNED_FORM_UPLOAD' ? (
                signedDocumentId ? (
                  <p className="text-xs text-emerald-700">Signed copy attached.</p>
                ) : (
                  <EvidenceUploader
                    providerId={organizationId}
                    role="agreement_signed"
                    label="Signed agreement copy"
                    onUploaded={setSignedDocumentId}
                  />
                )
              ) : null}
              <Button
                size="sm"
                onClick={() => void acceptAgreement()}
                disabled={
                  disabled ||
                  saving ||
                  !signedOn ||
                  !place ||
                  !signatoryName ||
                  !designation ||
                  (agreementMethod === 'SIGNED_FORM_UPLOAD' && !signedDocumentId)
                }
              >
                Record signed agreement
              </Button>
              {overview?.agreements.length ? (
                <ul className="divide-y rounded-md border text-sm">
                  {overview.agreements.map((agreement) => (
                    <li key={agreement.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="font-medium">
                        {agreement.templateName} {agreement.templateVersion}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {agreement.signatoryName} · {agreement.place} ·{' '}
                        {formatDate(agreement.signedOn)}
                      </span>
                      {agreement.revokedAt ? <Badge tone="danger">Revoked</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
              The {provider.organization.providerType.replace('_', ' ')} agreement template is
              pending counsel. Until it exists, this provider accepts the platform terms only.
            </p>
          )}
        </CardContent>
      </Card>

      {overview?.linksEnabled ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Public confirmation link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Lets the doctor or an authorised contact confirm publication and declarations without
              a portal login. Single use, expires in 48 hours.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              {provider.organization.providerType === 'clinic' &&
              overview.clinicDoctors.length > 0 ? (
                <div className="min-w-48">
                  <Label htmlFor="confirmation-doctor">Doctor</Label>
                  <Select
                    id="confirmation-doctor"
                    value={confirmationDoctor}
                    onChange={(event) => setConfirmationDoctor(event.target.value)}
                  >
                    <option value="">Provider contact</option>
                    {overview.clinicDoctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.fullName}
                        {doctor.confirmed ? ' (confirmed)' : ''}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void generateLink()}
                disabled={saving}
              >
                Create link
              </Button>
            </div>
            {confirmationUrl ? (
              <div className="space-y-1 rounded-md border bg-secondary/20 p-2 text-xs">
                <p className="break-all font-mono">{confirmationUrl}</p>
                {confirmationExpiry ? (
                  <p className="text-muted-foreground">
                    Expires {formatDateTime(confirmationExpiry)}.
                  </p>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void navigator.clipboard.writeText(confirmationUrl)}
                >
                  Copy link
                </Button>
              </div>
            ) : null}
            {overview.confirmations.length > 0 ? (
              <ul className="divide-y rounded-md border text-xs">
                {overview.confirmations.map((link) => (
                  <li key={link.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="font-mono">{link.id.slice(0, 8)}</span>
                    <span className="text-muted-foreground">
                      {link.usedAt
                        ? `Used ${formatDateTime(link.usedAt)}`
                        : link.revokedAt
                          ? 'Revoked'
                          : `Expires ${formatDateTime(link.expiresAt)}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {overview && overview.consents.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Recorded consents</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y text-sm">
              {overview.consents.map((record) => {
                const declaration =
                  typeof record.confirmationMeta.declarationKey === 'string'
                    ? declarations.find(
                        (entry) => entry.key === record.confirmationMeta.declarationKey,
                      )
                    : null;
                return (
                  <li
                    key={record.id}
                    className="flex flex-wrap items-center gap-2 px-4 py-2.5 odd:bg-secondary/20"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {declaration?.label ??
                          (record.consentType === 'data_privacy_notice'
                            ? 'Privacy notice'
                            : record.consentType === 'doctor_confirmation'
                              ? 'Doctor confirmation'
                              : record.consentType === 'agreement'
                                ? 'Partner agreement'
                                : 'Publication permission')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {consentMethodLabels[record.method as ConsentMethodDto]} ·{' '}
                        {formatDateTime(record.capturedAt)} · v{record.textVersion}
                      </p>
                    </div>
                    {record.revokedAt ? <Badge tone="danger">Revoked</Badge> : null}
                    {record.evidenceDocumentId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7"
                        onClick={() => void openEvidence(record.id)}
                      >
                        Evidence
                      </Button>
                    ) : null}
                    {!record.revokedAt && !disabled ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={() => void revoke(record.id)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {status ? (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      ) : null}
    </section>
  );
}
