'use client';

import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Declaration {
  key: string;
  label: string;
  text: string;
}

export function ConfirmForm({
  token,
  declarations,
  hasDoctor,
  expiresAt,
}: {
  token: string;
  declarations: Declaration[];
  hasDoctor: boolean;
  expiresAt: string;
}) {
  const [fullName, setFullName] = useState('');
  const [designation, setDesignation] = useState('');
  const [method, setMethod] = useState<'LINK_CONFIRMATION' | 'OTP'>('LINK_CONFIRMATION');
  const [otpCode, setOtpCode] = useState('');
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [publication, setPublication] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const allTicked =
    checked.size === declarations.length && publication && privacy && fullName.trim().length >= 2;

  async function requestOtp(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ maskedPhone: string }>(
        `/api/v1/public/confirm/${token}/otp`,
        {},
      );
      setOtpSentTo(response.data.maskedPhone);
      setStatus(`We sent a six-digit code to ${response.data.maskedPhone}.`);
      setMethod('OTP');
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/public/confirm/${token}`, {
        full_name: fullName.trim(),
        ...(designation.trim() ? { designation: designation.trim() } : {}),
        method,
        ...(method === 'OTP' ? { otp_code: otpCode } : {}),
        declaration_keys: [...checked],
      });
      setDone(true);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not confirm.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Thank you — your confirmation is recorded</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            CureNear has recorded your publication permission, privacy acknowledgement and
            declarations with the text you reviewed. A copy of this confirmation is kept with the
            provider record.
          </p>
          <p className="text-xs">Confirmed at {formatDateTime(new Date().toISOString())}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-5 text-sm">
          <p className="text-muted-foreground">
            {hasDoctor
              ? 'You are confirming as the doctor listed by the clinic. CureNear staff cannot confirm this for you.'
              : 'Confirm that CureNear may publish the profile fields you approved and that the declarations below are true.'}
          </p>
          <p className="text-xs text-muted-foreground">
            This link expires {formatDateTime(expiresAt)} and can be used once.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who is confirming</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="confirm-name" required>
              Full name
            </Label>
            <Input
              id="confirm-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="As printed on your registration"
            />
          </div>
          <div>
            <Label htmlFor="confirm-designation">Designation</Label>
            <Input
              id="confirm-designation"
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
              placeholder="Proprietor, authorised signatory, doctor…"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="flex gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={publication}
              onChange={(event) => setPublication(event.target.checked)}
            />
            <span>
              I permit CureNear to publish the profile fields I approved in Schedule A, and I
              understand I can withdraw this permission later.
            </span>
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={privacy}
              onChange={(event) => setPrivacy(event.target.checked)}
            />
            <span>
              I have read the Privacy Notice and understand the data roles of CureNear and the
              provider.
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Declarations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {declarations.map((declaration) => (
            <label key={declaration.key} className="flex gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={checked.has(declaration.key)}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How would you like to confirm?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <Label htmlFor="confirm-method">Method</Label>
            <Select
              id="confirm-method"
              value={method}
              onChange={(event) => setMethod(event.target.value as 'LINK_CONFIRMATION' | 'OTP')}
            >
              <option value="LINK_CONFIRMATION">Confirm with this link</option>
              <option value="OTP">Send me a one-time code</option>
            </Select>
          </div>
          {method === 'OTP' ? (
            <div className="space-y-2">
              {otpSentTo ? (
                <p className="text-xs text-muted-foreground">Code sent to {otpSentTo}.</p>
              ) : null}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor="confirm-otp">Six-digit code</Label>
                  <Input
                    id="confirm-otp"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ''))}
                  />
                </div>
                <Button type="button" variant="outline" disabled={busy} onClick={requestOtp}>
                  {otpSentTo ? 'Resend code' : 'Send code'}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

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

      <Button
        className="w-full"
        disabled={busy || !allTicked || (method === 'OTP' && otpCode.length !== 6)}
        onClick={submit}
      >
        Confirm publication and declarations
      </Button>
      <p className="pb-6 text-center text-xs text-muted-foreground">
        Your name, the declarations you accepted and the time of confirmation are stored as
        evidence.
      </p>
    </div>
  );
}
