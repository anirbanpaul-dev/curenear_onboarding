# CureNear Provider Onboarding Portal – Field Specification

Derived from the four uploaded partner agreements (Doctor, Pharmacy, Diagnostic Centre, Home-Care) as of 19 Nov 2026, **revision 2: client decisions incorporated** (see Section 11). Intended to be pasted or attached directly into an AI coding tool.

## 1. How to use this spec

**Provider types (5):** `doctor`, `clinic`, `pharmacy`, `diagnostic_centre`, `care_provider`.

**Important gaps to know before building:**

- **No Clinic agreement exists yet.** Section 6 is a Clinic form proposed by us, modelled on the Doctor, Diagnostic and Home-Care agreements. Build it as written; when counsel drafts the Clinic agreement, reconcile any differences.
- All four agreements are **drafts for legal review**. Field lists follow the Schedules (A = profile/services, B = commercial, C = verification/compliance/contacts) and the warranty clauses. Expect changes after legal review.
- **Do not build any upload for patient records, prescriptions or clinical reports** in the onboarding portal. The agreements (Home-Care 12.3, Diagnostic Schedule C, Doctor 13.4) say CureNear should not receive clinical records except through a separately approved workflow. This portal collects business and professional verification data only.

**Column conventions used in the field tables:**

| Column | Meaning |
|---|---|
| Key | suggested snake_case field name / DB column |
| Type | `text`, `textarea`, `email`, `phone`, `url`, `number`, `money`, `date`, `time`, `select`, `multiselect`, `boolean`, `file`, `address`, `pin`, `geo`, `repeater` (repeating group) |
| Req | `Y` = mandatory, `N` = optional, `C` = conditional (see Notes) |
| Source | agreement clause or schedule the field comes from; *inferred* = not in agreements, added for a working portal |

**Global UI/validation rules:**

- Every `file` field: PDF/JPG/PNG, max 10 MB, store `uploaded_at`, `uploaded_by`.
- Every licence/registration has: number, issuing authority, issue date, expiry date, document upload. Expiry dates drive reminders and auto-flagging (see Section 11).
- PIN code: 6 digits. Mobile: 10-digit Indian number with OTP verification.
- All sections allow **Save as draft**; final **Submit for verification** locks the data until admin responds.
- Providers can only publish fields they approve (publication consent per field group, see 3.8).
- **Minimum data only (client decision).** Do not collect Aadhaar, ID-proof copies, date of birth or gender. PAN, GSTIN and bank details are deferred (Appendix A). Collect only what the agreements' schedules and the verification checklist need.

## 2. Onboarding flow and status workflow

1. Provider registers: selects provider type, verifies mobile (OTP) and email.
2. Provider completes common sections (Section 3).
3. Provider completes the type-specific section (Sections 4 to 8).
4. Provider reviews the Profile Preview and ticks publication permissions.
5. Provider accepts the partner agreement (Section 9) via e-sign or uploads signed copy.
6. Provider submits; admin verifies documents (Section 10), then approves, requests changes or rejects.
7. On approval, profile goes live per location/PIN once the consumer app launches. Until then it stays `approved_not_live`.

**Clinics can add their own doctors** (Section 6.5). A doctor added by a clinic must confirm via OTP before the profile can be published, and is verified separately by admin.

**One organization = one provider type** (client decision). A hospital with a clinic, pharmacy and lab onboards three separate organizations.

**Provider status values:** `draft`, `submitted`, `under_review`, `changes_requested`, `approved_not_live`, `live`, `suspended`, `rejected`, `terminated`.

**Suggested data model (entities):**

- `provider_account` (login) 1 → 1 `organization` (legal entity, exactly one provider type) 1 → many `location` (branch/premises) 1 → many `service`
- `doctor_profile` is its own record. It links to many `location` (practice locations) through `doctor_location` and can be created by the doctor or by a clinic (`created_by_org_id`)
- `clinic` → many `doctor_location` links (a doctor can be linked to several clinics)
- `document` (generic, polymorphic: belongs to organization, location, doctor or staff)
- `agreement_acceptance`, `verification_record`, `audit_log` (commercial terms deferred, Appendix A)

## 3. Common fields (all provider types)

### 3.1 Account and login

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Provider type | `provider_type` | select | Y | doctor / clinic / pharmacy / diagnostic_centre / care_provider |
| Registrant full name | `registrant_name` | text | Y | person creating the account |
| Mobile number | `mobile` | phone | Y | OTP verified |
| Email | `email` | email | Y | verified by link; also used as legal notice email (all agreements have a Notices clause) |
| Password or OTP login | `auth_secret` | secret | Y | |
| Terms of Use / Privacy Notice accepted | `portal_terms_accepted` | boolean | Y | platform-level terms; agreements say partner agreement does not replace patient-facing Terms/Privacy Notice |

### 3.2 Legal entity details

Doctor: treat as an individual; use the Doctor section for identity and show only the fields marked below.

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Legal name | `legal_name` | text | Y | Home-Care/Diagnostic/Pharmacy preamble |
| Trade / display name | `trade_name` | text | Y | Pharmacy trade name, Home-Care trading name |
| Constitution type | `constitution_type` | select | Y | individual, sole proprietorship, partnership, LLP, private limited, public limited, trust, society, other |
| Registration number | `registration_number` | text | C | CIN / LLPIN / partnership reg. no. Not required for individual doctors |
| Date of incorporation / establishment | `established_on` | date | N | *inferred* |
| Website | `website` | url | N | |

### 3.3 Registered office address

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Address line 1 | `reg_addr_line1` | text | Y | |
| Address line 2 | `reg_addr_line2` | text | N | |
| Landmark | `reg_landmark` | text | N | |
| City / town | `reg_city` | text | Y | |
| District | `reg_district` | text | Y | |
| State | `reg_state` | select | Y | default West Bengal; agreements reference WB licensing |
| PIN code | `reg_pin` | pin | Y | |

### 3.4 Locations / branches (repeater, at least one)

Pharmacy: one location = one licensed premises. Diagnostic: one location = one branch/collection centre. Doctor: practice locations are captured in the Doctor section but reuse this component.

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Location name | `loc_name` | text | Y | |
| Location type | `loc_type` | select | Y | clinic, pharmacy store, lab, collection centre, imaging centre, home-care office, hospital OPD, other |
| Address (line 1, 2, landmark, city, district, state) | `loc_address` | address | Y | |
| PIN code | `loc_pin` | pin | Y | drives location-wise discovery |
| Map pin | `loc_geo` | geo | Y | lat/lng via map picker; needed for location-wise search |
| Branch ID (internal / client's own) | `branch_ref` | text | N | Pharmacy Schedule A "branch ID" |
| Operating hours | `loc_hours` | repeater | Y | day of week, open time, close time, closed flag; allow multiple slots/day |
| Public booking/appointment phone | `loc_booking_phone` | phone | Y | Schedule A "booking contact / public appointment contact" |
| Is this location publicly listed? | `loc_public` | boolean | Y | |

### 3.5 Authorized signatory

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Name | `sig_name` | text | Y | agreements: "represented by [AUTHORIZED SIGNATORY]" |
| Designation / capacity | `sig_designation` | text | Y | |
| Mobile | `sig_mobile` | phone | Y | OTP for e-sign |
| Email | `sig_email` | email | Y | |
| Authority document | `sig_authority_doc` | file | C | board resolution / partnership authority / power of attorney; not needed for individual doctors or sole proprietors |

### 3.5a Designated contacts

Each agreement names several escalation contacts. Capture them for every provider; one person may fill several roles.

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Booking / orders contact (name, phone, email) | `contact_booking` | repeater | Y | |
| Complaint / grievance officer (name, phone, email) | `contact_grievance` | repeater | Y | Home-Care 13.1, Diagnostic 18, Pharmacy 15, Doctor Sch. B "patient complaint contact" |
| Emergency / clinical incident escalation contact | `contact_emergency` | repeater | C | mandatory for care_provider, diagnostic_centre, clinic; Pharmacy: "compliance and incident escalation" |
| Data security / breach contact | `contact_security` | repeater | Y | Home-Care Sch. C, Diagnostic Sch. C, Pharmacy privacy addendum |
| Billing / finance contact | `contact_billing` | repeater | N | *inferred* for reconciliation |
| Legal notice address and email | `notice_address`, `notice_email` | address, email | Y | Notices clauses |

### 3.6 Insurance (repeater)

Required types vary per provider (see type sections). Doctor: optional unless Schedule B makes it mandatory.

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Insurance type | `ins_type` | select | C | professional indemnity, public liability, product liability, cyber, employer/worker (workmen), other |
| Insurer | `ins_insurer` | text | C | |
| Policy number | `ins_policy_no` | text | C | |
| Sum insured / limit (INR) | `ins_limit` | money | C | |
| Valid from / valid to | `ins_from`, `ins_to` | date | C | alert on expiry; providers must report cancellation or material reduction (Home-Care 16.2) |
| Policy document | `ins_doc` | file | C | |

### 3.7 Service area

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Serviceable PIN codes | `service_pins` | multiselect/tags | C | required for pharmacy delivery, home collection, home care. Allow bulk paste/CSV |
| Home service / delivery offered | `offers_home_service` | boolean | C | |
| Service area notes | `service_area_notes` | textarea | N | |

### 3.8 Public profile and publication permission

Agreements allow publication only of fields the provider has approved in Schedule A.

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Display name | `profile_display_name` | text | Y | |
| Short description (factual) | `profile_description` | textarea | Y | max 500 chars; no guaranteed-cure or superiority claims (Doctor 8.2, Pharmacy 8, Home-Care 9.1) |
| Logo | `profile_logo` | file | N | |
| Photographs | `profile_photos` | file (multi) | N | |
| Languages spoken | `profile_languages` | multiselect | N | |
| Publish photograph | `consent_publish_photo` | boolean | Y | Doctor Sch. A, Home-Care Sch. A |
| Approved public fields | `public_fields` | multiselect | Y | provider ticks each field to be public; default unticked |
| Profile approved on | `profile_approved_on` | date | system | set by admin |

### 3.9 Declarations (all required; store version, timestamp, IP, user)

| Declaration | Key |
|---|---|
| All submitted information is accurate and complete | `decl_accuracy` |
| I have authority to sign for this entity | `decl_authority` |
| I hold all licences/registrations required for my actual activities | `decl_licences` |
| I will notify CureNear of suspension, expiry, cancellation or regulatory action within the period set for my provider type (Doctor 48 h, Diagnostic 48 h, Pharmacy 24 h, Home-Care "promptly") | `decl_notify_changes` |
| I consent to CureNear verifying my credentials with registries and authorities | `decl_verification` |
| I will not offer or accept unlawful referral commissions, fee-splitting or inducements | `decl_no_referral_incentive` |
| I will not make guaranteed-cure, false accreditation or misleading claims | `decl_no_misleading_claims` |
| I have read the Privacy Notice and understand the data roles | `decl_privacy_ack` |

## 4. Doctor

*Source: Doctor Partner Agreement, clauses 4, 9, 10, 14, 18 and Schedules A, B, C.*

A doctor can self-onboard or be added by a clinic (Section 6.5). In both cases every field below ends up on the same `doctor_profile`, and the doctor must personally confirm publication consent and declarations.

### 4.1 Identity and registration

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Full name (with title) | `doc_full_name` | text | Y | Doctor "Dr. [FULL NAME]" |
| Photograph | `doc_photo` | file | N | publication only if consented |
| Medical registration number | `doc_reg_no` | text | Y | |
| Registering authority / council | `doc_reg_council` | select | Y | NMC / State Medical Council (list) / State AYUSH Council etc. |
| Registration date | `doc_reg_date` | date | Y | *inferred* |
| Registration valid until / renewal date | `doc_reg_valid_to` | date | C | where the council requires renewal |
| Registration certificate | `doc_reg_doc` | file | Y | |
| System of medicine | `doc_system` | select | Y | allopathy, dental, ayurveda, homeopathy, unani, siddha, other. Doctor 4.1: "valid registration for the relevant system of medicine" |
| Registration verified source and date | | | admin | see Section 10 |

### 4.2 Qualifications and specialty

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Qualifications | `doc_qualifications` | repeater | Y | degree, university/institution, year, certificate upload |
| Recognized specialty | `doc_specialty` | select | C | must match a recognized specialty. Doctor 4.1, Sch. A |
| Super-specialty / areas of interest | `doc_subspecialty` | multiselect | N | |
| Specialty qualification certificate | `doc_specialty_doc` | file | C | |
| Years of experience | `doc_experience_years` | number | N | |
| Languages | `doc_languages` | multiselect | N | |

### 4.3 Practice locations (repeater, at least one)

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Practice type | `prac_type` | select | Y | own clinic, clinic/hospital (linked), visiting consultant |
| Linked establishment | `prac_clinic_id` | select | C | choose an onboarded Clinic, or add new |
| Location (address, PIN, map pin) | `prac_location` | address | Y | reuse 3.4 component |
| Consultation timings | `prac_timings` | repeater | Y | day, start, end, slot duration |
| In-clinic consultation fee (INR) | `prac_fee` | money | Y | Doctor 14.3: doctor sets fees independently |
| Follow-up fee / validity | `prac_followup_fee`, `prac_followup_days` | money, number | N | *inferred* |
| Public appointment contact | `prac_contact` | phone/email | Y | Schedule A |
| Establishment licence of the location | `prac_establishment_licence` | text, file | C | Doctor Sch. C "establishment compliance checked"; N/A for own non-registered practice |

### 4.4 Appointments, fees and operations (Schedule B)

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Who confirms appointments | `appt_confirmer` | select | Y | doctor / authorized establishment (Doctor 2.4, 10.1) |
| Appointment confirmation method | `appt_confirm_method` | select | Y | call, WhatsApp, portal dashboard, email |
| Reliable response contact | `appt_contact` | repeater | Y | |
| Cancellation process | `appt_cancel_policy` | textarea | Y | |
| Deposits / cancellation charges | `appt_deposit` | text | N | Doctor 10.4: must be disclosed |
| Consultation fee collection | `fee_collection` | select | Y | default: doctor / authorized establishment (Schedule B) |
| Patient complaint contact | `doc_complaint_contact` | repeater | Y | Schedule B |
| Professional indemnity insurance | `doc_pi_insurance` | repeater | N | see 3.6; mandatory only if Schedule B requires |

### 4.5 Disclosures and future flags

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Any suspension, cancellation or material restriction on registration? | `doc_restriction_flag` | boolean | Y | Doctor 4.1 "disclosure of material restrictions" |
| Details if yes | `doc_restriction_details` | textarea | C | |
| Pending disciplinary proceedings? | `doc_disciplinary_flag` | boolean | N | *inferred* |
| Interested in teleconsultation later? | `doc_tele_interest` | boolean | N | Doctor 12.1: teleconsultation not activated; separate addendum needed. Store as interest only, do not enable |
| Declaration: no testimonials / before-after photos / prohibited advertising | `decl_doc_ethics` | boolean | Y | Doctor 8.2, 8.3 |

## 5. Care Provider (home care)

*Source: Home-Care Provider Partner Agreement, clauses 2 to 6, 8, 16 and Schedules A, C.* Verification is **per service category** (Home-Care 2.2), so model each service category as a repeater item.

### 5.1 Entity and licences

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Registration / licence(s) | `cp_licences` | repeater | Y | name, number, authority, valid to, document. Includes clinical establishment registration (West Bengal CE Act 2017) where applicable (Home-Care 3.2) |
| Biomedical waste authorization | `cp_bmw` | text, file | C | where applicable |
| Labour/employment compliance declaration | `cp_labour_decl` | boolean | Y | Home-Care 3.2, 4.1 |
| Employer/worker insurance | | | Y | see 3.6, Schedule C |

### 5.2 Service categories (repeater)

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Service category | `cp_category` | select | Y | non-clinical attendant, registered nursing, physiotherapy, post-discharge assistance, elder support, palliative support, equipment assistance, other (Home-Care 2.1) |
| Specific services offered | `cp_services` | multiselect | Y | list per category; no invasive procedures or medication administration without qualified personnel (2.3) |
| Authorized professional scope | `cp_scope` | textarea | Y | Schedule A "authorized professional scopes" |
| Qualified staff available (count) | `cp_staff_count` | number | Y | |
| Staff qualification mix | `cp_staff_quals` | repeater | C | e.g. GNM/B.Sc Nursing count, BPT count, attendant count |
| Professional registrations of clinical staff | `cp_staff_regs` | repeater | C | name, role, registration number, council, valid to. Required for nursing/physio categories |
| Clinical supervisor | `cp_supervisor` | repeater | C | name, qualification, registration number; required for clinical categories (Schedule C "clinical supervision") |
| Price | `cp_price` | money | Y | Schedule A "public prices" |
| Pricing unit | `cp_price_unit` | select | Y | per hour, per shift (8h/12h), per day, per visit, per week/month |
| Minimum booking duration | `cp_min_booking` | text | N | *inferred* |
| Equipment provided / operated | `cp_equipment` | multiselect | N | equipment assistance category |
| Service limitations | `cp_limitations` | textarea | Y | disclosed to user before service (5.3) |
| Supervision arrangements | `cp_supervision_notes` | textarea | Y | disclosed to user (5.3) |
| Cancellation rules | `cp_cancel_policy` | textarea | Y | 5.3 |
| Replacement process | `cp_replacement_process` | textarea | Y | Home-Care 4.4, 8.3 |
| Operating hours / 24x7 | `cp_hours` | repeater | Y | |
| Covered PIN codes | `cp_pins` | pin list | Y | Schedule A |

### 5.3 Personnel, safeguarding and incident readiness

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Staff are employed / contracted / via agency | `cp_staff_model` | select | Y | |
| Uses subcontractors or staffing agencies? | `cp_subcontract_flag` | boolean | Y | Home-Care 8.1 disclosure |
| Subcontractor/agency details | `cp_subcontractors` | repeater | C | name, registration, services covered |
| Background check policy | `cp_bg_policy_doc` | file | Y | 4.2, Schedule C |
| Safeguarding policy | `cp_safeguarding_doc` | file | Y | 4.3 (abuse, neglect, harassment, theft, vulnerable adults) |
| Training and competency records maintained | `cp_training_decl` | boolean | Y | 4.2 |
| Incident and emergency escalation protocol | `cp_incident_protocol_doc` | file | Y | 6.2 |
| Emergency escalation contact | | | Y | see 3.5a |
| Complaint officer | | | Y | see 3.5a |
| Data security contact | | | Y | see 3.5a |

## 6. Clinic

*Proposed form: there is no Clinic agreement yet. Modelled on the Doctor agreement (Schedule C "establishment compliance checked"), the Home-Care agreement (West Bengal Clinical Establishments Act) and the Diagnostic agreement. Build as written.*

### 6.1 Establishment details and licences

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Clinic type | `clinic_type` | select | Y | single-doctor clinic, multi-specialty clinic, polyclinic, dental clinic, AYUSH clinic, physiotherapy/rehab centre, day-care/minor procedure centre, other |
| Systems of medicine practised | `clinic_systems` | multiselect | Y | allopathy, dental, ayurveda, homeopathy, unani, siddha, physiotherapy, other |
| Ownership | `clinic_ownership` | select | Y | doctor-owned, partnership, company, trust/charitable, corporate chain |
| Owner / proprietor name | `clinic_owner` | text | Y | |
| Clinical establishment registration applicable? | `clinic_ce_applicable` | select | Y | yes / exempt / not sure. If exempt, `clinic_ce_exempt_reason` (text) is required |
| Clinical establishment registration number | `clinic_ce_reg_no` | text | C | required when applicable (West Bengal CE Act 2017 or other state law) |
| Registering authority | `clinic_ce_authority` | text | C | |
| Registration category | `clinic_ce_category` | text | C | |
| Valid from / valid to | `clinic_ce_from`, `clinic_ce_to` | date | C | expiry drives reminders |
| Registration certificate | `clinic_ce_doc` | file | C | |
| Biomedical waste authorization | `clinic_bmw` | text, file | C | required if the clinic generates biomedical waste (injections, dressings, procedures) |
| AERB permission | `clinic_aerb` | text, file | C | required if X-ray or other radiation equipment is on site |
| Other licences (trade, fire, etc.) | `clinic_other_licences` | repeater | N | name, number, valid-to, document |
| Medical director / in-charge doctor | `clinic_incharge` | select | Y | pick from the clinic's doctors (6.5); must have a registration number |

### 6.2 Services and facilities

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Specialties offered | `clinic_specialties` | multiselect | Y | |
| Services / procedures offered | `clinic_services` | multiselect | N | OPD, minor procedures, vaccination, dressing, physiotherapy, dental procedures, etc. |
| Facilities | `clinic_facilities` | multiselect | N | parking, wheelchair access, waiting area, lift, on-site pharmacy, on-site sample collection, etc. |
| Number of consultation rooms | `clinic_rooms` | number | N | |
| Observation / day-care beds | `clinic_beds` | number | N | |
| Home visits offered | `clinic_home_visit` | boolean | N | |
| Languages spoken at clinic | `clinic_languages` | multiselect | N | |
| Insurance / cashless panels accepted | `clinic_insurance_panels` | multiselect/text | N | |
| Interested in teleconsultation later? | `clinic_tele_interest` | boolean | N | capture interest only; not activated (see Doctor 12.1) |
| Provides emergency or casualty care? | `clinic_emergency_flag` | boolean | N | information only; the platform is not an emergency service |

### 6.3 Appointments, fees and operations

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Who confirms appointments | `clinic_appt_confirmer` | select | Y | clinic front desk / individual doctor |
| Confirmation method | `clinic_appt_method` | select | Y | call, WhatsApp, portal dashboard, email |
| Front desk / booking contact | | | Y | see 3.5a |
| Consultation fee schedule | `clinic_fees` | repeater | Y | doctor or service, fee (INR), follow-up fee, follow-up validity (days) |
| Deposits and cancellation charges | `clinic_deposit_policy` | text | N | |
| Cancellation and rescheduling policy | `clinic_cancel_policy` | textarea | Y | |
| Fee collection at clinic | `clinic_fee_collection` | select | Y | default: clinic collects directly (payment flows deferred, Appendix A) |
| Patient support number | `clinic_support_phone` | phone | Y | |
| Complaint officer | | | Y | see 3.5a |
| Emergency / incident escalation contact | | | Y | see 3.5a |
| Insurance (professional / public liability) | | | N | see 3.6 |
| Operating hours and locations | | | Y | see 3.4 |

### 6.4 Clinic declarations

| Declaration | Key |
|---|---|
| All doctors listed are registered and have agreed to be listed | `decl_clinic_doctors` |
| The clinic holds all registrations required for its actual activities | `decl_clinic_licences` |
| The clinic will not use testimonials, before-and-after photographs or prohibited advertising | `decl_clinic_ethics` |
| The clinic will not pay or accept referral commissions or fee-splitting | `decl_clinic_no_referral` |

(All common declarations in 3.9 also apply.)

### 6.5 Clinic adds doctors (client decision)

A clinic can create doctor profiles itself. The Doctor agreement is between CureNear and the individual doctor, and the doctor authorizes publication of their profile fields (Doctor 9.1), so the doctor must confirm before publication.

**Fields the clinic enters:**

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Doctor full name | `doc_full_name` | text | Y | |
| Doctor mobile | `cd_mobile` | phone | Y | invitation and OTP go here |
| Doctor email | `cd_email` | email | N | |
| Registration number | `doc_reg_no` | text | Y | used to detect duplicates (same number and council = same doctor) |
| Registering council | `doc_reg_council` | select | Y | |
| System of medicine | `doc_system` | select | Y | |
| Registration certificate | `doc_reg_doc` | file | Y | |
| Specialty | `doc_specialty` | select | C | |
| Qualifications | `doc_qualifications` | repeater | Y | degree, institution, year, certificate |
| Role at this clinic | `cd_role` | select | Y | in-charge, full-time consultant, visiting consultant, resident |
| Consultation timings at this clinic | `prac_timings` | repeater | Y | |
| Consultation fee at this clinic | `prac_fee` | money | Y | |
| Photograph | `doc_photo` | file | N | publication only after doctor consent |
| Clinic attestation | `cd_clinic_attestation` | boolean | Y | "This doctor has agreed to be listed and I am authorized to add them" |

**Fields only the doctor can complete or confirm** (via the invite link): publication consent for profile and photograph, doctor declarations (3.9 and `decl_doc_ethics`), disclosure of registration restrictions (4.5), teleconsultation interest, professional indemnity insurance, acceptance of the Doctor agreement (Section 9).

**Rules:**

1. Status flow for a clinic-added doctor: `invited` → `doctor_confirmed` → `under_review` → `approved` (or `changes_requested` / `rejected`). Store `created_by_org_id` and `doctor_confirmed_at`.
2. A clinic-added doctor profile cannot be published until the doctor confirms and admin verifies the registration.
3. If a doctor with the same registration number and council already exists, link instead of duplicating. Linking to an existing doctor needs that doctor's approval.
4. A doctor can be linked to several clinics, with timings and fees per clinic. Each clinic can only edit its own link (role, timings, fee), not the doctor's core profile.
5. If a clinic removes a doctor, only that link is removed; the doctor's own profile stays.
6. Admin verification runs per doctor (Section 10), not per clinic.

## 7. Pharmacy

*Source: Pharmacy Partner Agreement, clauses 4 to 11, 14, 19 and Schedules A, B, C.*

### 7.1 Licences and premises

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Licensed premises address | `ph_premises` | address | Y | must match licence |
| Drug licence(s) | `ph_licences` | repeater | Y | licence number, form type(s) as printed on licence, licensing authority, scope (retail/wholesale, categories), issue date, valid-to, document. Agreement 4: "applicable licence forms" |
| Licence retention / validity evidence | `ph_licence_retention_doc` | file | N | Pharmacy cl. 4 mentions "validity/retention evidence" |
| Authorized person named on licence | `ph_authorized_person` | text | Y | cl. 4 |
| Pharmacy has Schedule H/H1/X permissions? | `ph_sched_flags` | multiselect | Y | Schedule H, H1, X, narcotics/psychotropics, none |
| Cold-chain products handled? | `ph_cold_chain` | boolean | Y | cl. 7 |
| FSSAI (if nutrition/food products sold) | `ph_fssai` | text, file | C | *inferred* |

### 7.2 Registered pharmacist

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Registered pharmacist (repeater; at least one) | `ph_pharmacists` | repeater | Y | name, qualification (D.Pharm/B.Pharm/M.Pharm), registration number, State Pharmacy Council, valid to, certificate upload, mobile. Cl. 5 and Schedule A |
| Pharmacist works full time at this premises | `ph_pharmacist_ft` | boolean | Y | *inferred* from "legally required supervision" |

### 7.3 Products, ordering and fulfilment

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Permitted product categories | `ph_categories` | multiselect | Y | Schedule A |
| Restricted categories handled | `ph_restricted` | multiselect | Y | Schedule A; admin may block categories pending legal review (cl. 6) |
| Prescription review and dispensing process | `ph_rx_process` | textarea | Y | Schedule A |
| Stock/availability update method | `ph_stock_method` | select | N | manual, daily upload, API; *inferred* |
| Delivery offered | `ph_delivery` | boolean | Y | |
| Delivery PIN codes | `ph_delivery_pins` | pin list | C | Schedule A |
| Delivery hours | `ph_delivery_hours` | repeater | C | |
| Service standards (delivery time, packaging) | `ph_service_standards` | textarea | C | |
| Delivery method | `ph_courier` | select | C | own staff / third-party courier / both |
| Courier details | `ph_courier_details` | repeater | C | name, insurance, data-access terms (cl. 10) |
| Delivery charges | `ph_delivery_charges` | text | C | cl. 11: must be disclosed |
| Price control compliance (DPCO) declaration | `ph_dpco_decl` | boolean | Y | cl. 11 |
| Returns, refunds, cancellation policy | `ph_returns_policy` | textarea | Y | Schedule A |
| Pharmacovigilance / adverse event contact | `ph_pv_contact` | repeater | N | cl. 16 |
| Product liability / public liability insurance | | | C | if agreed in Schedule A; see 3.6 |

### 7.4 Pharmacy declarations

| Declaration | Key |
|---|---|
| I will not supply expired, counterfeit, spurious, recalled or unlawfully stocked medicines | `decl_ph_quality` |
| I will source only from lawful suppliers and keep statutory records | `decl_ph_sourcing` |
| I understand CureNear may block categories or workflows pending legal review | `decl_ph_blocking` |
| No general online-sale authorization is implied | `decl_ph_no_online_sale` |

### 7.5 Online sale and prescription workflows (TBD)

Client has not decided which categories or prescription workflows will be enabled. Capture interest only and keep everything disabled.

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Interested in receiving online orders? | `ph_online_interest` | boolean | N | |
| Online orders enabled | `ph_online_enabled` | boolean | admin | default **false**; admin-only |
| Categories enabled for online orders | `ph_online_categories` | multiselect | admin | empty until the client decides |

## 8. Diagnostic Centre

*Source: Diagnostic Centre Partner Agreement (Revised), clauses 3 to 8, 14, 17 and Schedules A, B, C.*

### 8.1 Licences and regulatory verification (Schedule A)

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Establishment licence number, authority, status, valid-to, document | `dc_establishment` | repeater | Y | West Bengal clinical establishment licensing where applicable |
| NABL accredited? | `dc_nabl_flag` | boolean | Y | cl. 4: NABL is not mandatory; claim only if valid |
| NABL certificate number, validity, scope, document | `dc_nabl_details` | text, date, file | C | required if NABL = yes; scope must cover claimed tests |
| PC-PNDT registration | `dc_pcpndt` | text, file | C | required for prenatal diagnostic facilities/activities |
| AERB permissions | `dc_aerb` | repeater | C | required for radiation equipment (X-ray, CT, etc.): equipment, permission number, valid-to, document |
| Biomedical waste authorization / arrangement | `dc_bmw` | text, file | Y | |
| Medical / lab director and credentials | `dc_director` | repeater | Y | name, qualification (e.g. MD Pathology), registration number, council, document. Cl. 5 and Schedule A |
| Qualified report signatories | `dc_signatories` | repeater | Y | name, qualification, registration number, tests/department. Cl. 5 |
| Other licences | `dc_other_licences` | repeater | N | |

### 8.2 Services and workflow approvals

Higher-risk workflows require affirmative operational approval and additional written terms (cl. 3). Capture the request; keep them disabled until admin approves.

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Services offered | `dc_services` | multiselect | Y | pathology, radiology, ultrasound, prenatal diagnostics, cardiology tests, health packages, other |
| Home collection requested | `dc_home_collection` | boolean | Y | Schedule A |
| Higher-risk workflows requested | `dc_highrisk_requests` | multiselect | N | radiology, ultrasound, prenatal diagnostics, telehealth, report hosting, payments. Status per item: requested / approved / not approved (admin) |
| Report delivery channel | `dc_report_channel` | select | Y | provider's own portal/app, email, WhatsApp, in-person; CureNear does not host reports by default |

### 8.3 Test catalogue and pricing (repeater or bulk CSV import)

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Test name | `test_name` | text | Y | |
| Test code (internal) | `test_code` | text | N | |
| Category / department | `test_category` | select | Y | |
| Price (INR) | `test_price` | money | Y | |
| Sample type | `test_sample` | select | N | *inferred* |
| Preparation requirements | `test_prep` | textarea | Y | cl. 6 |
| Expected turnaround time | `test_tat` | text | Y | cl. 6 |
| Prescription required? | `test_rx_required` | boolean | Y | cl. 5 |
| Where performed | `test_performed_at` | select | Y | on site / parent laboratory / third-party lab (cl. 3) |
| Performing laboratory name and accreditation | `test_perf_lab` | text | C | required when outsourced; Schedule A "tests outsourced and performing laboratory" |
| Home collection available for this test | `test_home` | boolean | C | |
| Price-list version and effective date | `price_list_version`, `price_effective_from` | text, date | Y | cl. 6 |
| Packages | `dc_packages` | repeater | N | name, included tests, price, validity |

Provide a CSV template for bulk upload with the columns above. **Never include or allow sex-determination tests** (cl. 6); add a server-side blocklist and admin review for prenatal items.

### 8.4 Home collection and patient communication

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Home collection PIN codes | `dc_collection_pins` | pin list | C | |
| Home collection hours | `dc_collection_hours` | repeater | C | |
| Home collection charges | `dc_collection_charges` | money | C | |
| Sample collectors trained and background-verified | `dc_collector_decl` | boolean | C | cl. 7 |
| Booking confirmation method | `dc_booking_confirm` | select | Y | Schedule B |
| Patient support number | `dc_support_phone` | phone | Y | |
| Cancellation / refund policy | `dc_cancel_policy` | textarea | Y | |
| Service-level expectations | `dc_sla` | textarea | N | Schedule B |
| Clinical incident escalation contact | | | Y | 3.5a |
| Insurance coverage and expiry | | | Y | professional negligence + public liability; see 3.6 |

### 8.5 Data and security responsibilities (Schedule C)

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Data categories sent to CureNear | `dc_data_categories` | multiselect | Y | default: booking data only |
| Purpose and legal basis / notice | `dc_data_purpose` | textarea | Y | |
| Data recipients | `dc_data_recipients` | text | N | |
| CureNear access to clinical reports permitted? | `dc_report_access` | select | Y | default **No unless separately approved**; read-only for provider, admin-controlled |
| Subprocessors | `dc_subprocessors` | repeater | N | |
| Retention and deletion schedule | `dc_retention` | text | N | |
| Patient complaint and rights contact | `dc_rights_contact` | repeater | Y | |
| Separate data processing addendum required? | `dc_dpa_required` | boolean | Y | admin decides |

## 9. Agreement acceptance and consents

Commercial terms (Schedule B) and bank details are **deferred** (Appendix A). Each agreement says no rate is implied and no commission accrues until Schedule B is signed, so the agreement can be accepted now with Schedule B signed later. Counsel should confirm this approach.

### 9.1 Agreement acceptance and execution

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Agreement template and version | `agr_version` | text | system | e.g. Pharmacy v1.0, 14 Nov 2026 |
| Agreement document (pre-filled PDF) | `agr_doc` | file | system | generate from the template with the data collected |
| Execution method | `agr_method` | select | Y | e-sign (OTP-based, provider choice to be confirmed), upload signed copy |
| Signed by, timestamp, IP, device | `agr_signed_meta` | system | system | audit |
| Signed agreement upload | `agr_signed_doc` | file | C | for physical execution |
| Place and date of execution | `agr_place`, `agr_date` | text, date | Y | Doctor execution block |
| Stamp duty paid / e-stamp reference | `agr_stamp_ref` | text | admin | all agreements: "subject to applicable stamp requirements"; counsel to confirm for West Bengal |
| Witness 1 / 2 (name, address, signature) | `agr_witnesses` | repeater | C | "if required" |
| CureNear signatory, designation, date | `agr_cn_signatory` | repeater | system | |
| Agreement template for provider type | `agr_template` | select | system | doctor, pharmacy, diagnostic, home-care templates exist. **Clinic template pending**; until then clinics accept the platform terms only (3.1) |

### 9.2 Privacy and data-processing consent

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Privacy notice version acknowledged | `priv_notice_version` | text | Y | Doctor Sch. C "privacy notice acknowledged" |
| Data-processing addendum version | `priv_dpa_version` | text | C | Pharmacy Sch. C, Home-Care 12.4, Diagnostic Sch. C |
| Provider data roles (controller / processor) | `priv_roles` | select | C | filled by admin after legal input |

## 10. Admin verification checklist and audit fields (internal)

One `verification_record` per document or claim.

| Field | Key | Type | Notes |
|---|---|---|---|
| Item verified | `vr_item` | select | e.g. medical registration, qualification, drug licence, pharmacist registration, NABL, PC-PNDT, AERB, establishment licence, BMW, insurance, address, signatory authority |
| Status | `vr_status` | select | pending / verified / rejected / expired / not applicable |
| Verified by | `vr_by` | user | Schedule C "reviewer", "licence verified by", "approval officer" |
| Verified on | `vr_date` | date | |
| Verification source | `vr_source` | text | e.g. NMC register, State Medical Council, State Pharmacy Council, NABL site, licensing authority |
| Evidence reference | `vr_evidence_ref` | text/file | |
| Rejection / change-request reason | `vr_reason` | textarea | |
| Next verification date | `vr_next_date` | date | Doctor Sch. C |
| Overall final approval | `final_status` | select | approved / rejected / pending (Doctor Sch. C) |
| Approval officer and date | `approved_by`, `approved_on` | user, date | Home-Care Sch. C |

**Doctor Schedule C checks to mirror:** registration verified (Y/N, source, date), qualifications verified, practice location verified, establishment compliance checked (Y/N/NA), profile reviewed, authorization obtained, privacy notice acknowledged.

**Suspension / change management:**

| Field | Key | Type | Notes |
|---|---|---|---|
| Suspension reason | `susp_reason` | select/text | invalid licence, safety risk, safeguarding allegation, false information, regulatory direction, serious privacy risk (all agreements) |
| Suspended on / by | `susp_on`, `susp_by` | date, user | |
| Scope suspended | `susp_scope` | select | whole profile, one location, one service category, one test/category |
| Provider response and review outcome | `susp_response`, `susp_outcome` | textarea | agreements require reasons and an opportunity to respond where practicable |
| Provider change notice | `change_notice` | repeater | provider can report suspension/expiry/loss of staff etc.; deadline timers: Pharmacy 24 h, Doctor 48 h, Diagnostic 48 h |
| Termination date and reason | `term_on`, `term_reason` | date, text | notice period 30 days; 15 days for curable breach |

Add automatic reminders at 60/30/7 days before expiry of any licence, registration or insurance, and set the provider to `suspended` or hide affected services on expiry (admin-configurable).

## 11. Client decisions and remaining open items

### 11.1 Decisions recorded (19 Nov 2026)

| # | Topic | Decision | Effect on this spec |
|---|---|---|---|
| 1 | Clinic agreement | None available; we propose the fields | Section 6 written in full |
| 2 | Doctor-to-clinic | Clinic can add doctors | Section 6.5; doctor must confirm before publication |
| 3 | Settlement flow | Deferred to main application | Bank details moved to Appendix A |
| 4 | Commission model | Deferred to main application | Commercial fields moved to Appendix A |
| 5 | E-pharmacy restrictions | TBD | Section 7.5: capture interest only, disabled by default |
| 6 | Teleconsultation | Capture interest only | `doc_tele_interest`, `clinic_tele_interest` |
| 7 | Sensitive data | Minimum data | No ID proofs, DOB, gender, PAN or GSTIN |
| 8 | State rules | Acknowledged | State is a select (default West Bengal); licence authority is free text so other states work |
| 9 | Liability floor, stamp duty | Admin-filled | `agr_stamp_ref` admin-only; liability floor in Appendix A |
| 10 | Provider-type mix | Keep separate | One organization = one provider type |

### 11.2 Still open

1. **Pharmacy online-sale categories and prescription workflow** (decision 5 is TBD).
2. **Clinic-added doctors.** Counsel should confirm that a doctor's own OTP confirmation is enough authorization for publication, since the Doctor agreement is between CureNear and the doctor.
3. **Clinic agreement.** Counsel should draft one to match Section 6, including the clinic-adds-doctors terms.
4. **Same person, several provider types.** A doctor who owns a clinic needs a doctor profile and a clinic organization. Decide whether one login can own both (recommended: yes, one login, separate records) or two logins are required.
5. **Signing now or later.** Confirm with counsel that agreements can be accepted before Schedule B is signed.

## Appendix A. Deferred to the main application

Do not build these in the onboarding portal. They are kept here so nothing from the agreements is lost.

### A.0 Tax identifiers

| Field | Key | Type | Notes |
|---|---|---|---|
| PAN | `pan` | text | `AAAAA9999A` |
| PAN document | `pan_doc` | file | |
| GSTIN | `gstin` | text | 15 characters; if GST-registered |
| GST certificate | `gst_doc` | file | |

### A.1 Commercial terms (Schedule B), admin-only

Providers should see the agreed terms read-only. Rates are **never implied** by the agreements, and no commission accrues until Schedule B is signed. Rate changes need written acceptance by both parties; keep versioned history.

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Commercial model | `com_model` | select | Y | commission %, per-transaction INR, revenue share, subscription/other, none |
| Commission rate (%) | `com_rate_pct` | number | C | |
| Commission per eligible transaction (INR) | `com_rate_inr` | money | C | |
| Revenue-share rate(s) and recipient(s) | `com_revshare` | text | C | |
| Covered service categories / locations | `com_scope` | multiselect | Y | |
| Qualifying event | `com_event` | select | Y | completed and paid service, accepted order, other (Diagnostic Sch. B) |
| Calculation base | `com_base` | select | Y | gross, net, collected / net realized |
| GST / TDS treatment | `com_tax` | text | Y | |
| Discounts, delivery charges, exclusions | `com_exclusions` | textarea | N | |
| Patient payment collector | `com_collector` | select | Y | provider direct / CureNear. If CureNear collects: payments addendum needed (Pharmacy 13, Home-Care 11.2) |
| Settlement cycle and due date | `com_settlement` | text | Y | |
| Invoice and reconciliation process | `com_recon_process` | textarea | Y | |
| Reconciliation dispute window (days) | `com_recon_days` | number | N | Pharmacy cl. 13 |
| Refund / chargeback adjustments | `com_refund_adj` | textarea | Y | |
| Activation date | `com_activation` | date | Y | |
| Effective date, rate-change process | `com_effective`, `com_change_process` | date, text | Y | "written agreement only" |
| Joining fee (INR) | `com_joining_fee` | money | N | Doctor Sch. B: INR 0 "if agreed" |
| Introductory commission-free period (months) | `com_intro_months` | number | N | Doctor Sch. B: 12 months, INR 0. Not promised to other provider types (Home-Care 10.3) |
| Agreed CureNear liability floor (INR) | `com_liability_floor` | money | N | all agreements |
| Legal review confirmation (commercial model) | `com_legal_review_ref` | text | Y | Pharmacy Sch. B, Diagnostic cl. 14, Home-Care Sch. B |

**Business rule:** for `doctor` (and for any registered medical practitioner, clinic or diagnostic arrangement involving referrals), block per-lead or percentage models until `com_legal_review_ref` is filled. Agreements prohibit referral commissions, fee-splitting and patient-procurement payments.

### A.2 Settlement bank details (*inferred*; needed to pay out)

| Field | Key | Type | Req | Notes |
|---|---|---|---|---|
| Account holder name | `bank_holder` | text | C | must match legal name or PAN |
| Account number | `bank_acc_no` | secret | C | encrypt at rest; mask in UI |
| IFSC | `bank_ifsc` | text | C | validate format, auto-fill bank/branch |
| Cancelled cheque / bank statement | `bank_doc` | file | C | |
| UPI ID | `bank_upi` | text | N | |

Required only when CureNear will settle money to the provider or the provider settles to CureNear via set-off. Confirm with the client.


*This is a product/field specification derived from draft documents, not legal advice. Have Indian healthcare counsel review the final forms.*
