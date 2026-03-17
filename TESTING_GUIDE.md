# ValueMitra — Manual Testing Guide

> **Plain-language guide for testing the app end-to-end.**
> No technical knowledge required.

---

## What Is ValueMitra?

ValueMitra is a web application for **Registered Valuers (RVs)** — professionals who legally certify the market value of properties in India (required by banks for home loans, by courts, by income tax, etc.).

The app replaces paper-based workflows with a digital platform:

1. **Receive an assignment** from a bank or individual (e.g. "value this flat in Pune for a home loan")
2. **Collect property documents** (sale deed, 7/12, property card, etc.)
3. **Auto-extract data** from scanned documents using AI (OCR)
4. **Fetch government rates** (Maharashtra IGR, Gujarat Jantri)
5. **Run a valuation** using standard methods (Cost Approach, Market Comparison, Income Approach)
6. **Get AI guidance** from Claude (advisory only — the valuer always has final say)
7. **Generate a formal report** in the format required by the bank
8. **Review & deliver** the report digitally with a digital signature

---

## Where to Access the App

### Local (Development)
Run both servers first, then open your browser:

| | URL |
|---|---|
| **App (frontend)** | http://localhost:5173 |
| **Login page** | http://localhost:5173/login |
| **Register page** | http://localhost:5173/register |
| **API** | http://localhost:3006/api |

### Live (Production)
| | URL |
|---|---|
| **App (frontend)** | https://vmapps.techsahyogi.com |
| **Login page** | https://vmapps.techsahyogi.com/login |
| **Register page** | https://vmapps.techsahyogi.com/register |

---

## Demo Accounts

All three accounts belong to the same firm: **"ValueMitra Demo Firm"** (firm code: `VMDEMO`).
These accounts exist **on both local and live** — use the same email/password for both.

| Role | Email | Password | What they can do |
|---|---|---|---|
| **Firm Admin** (Tenant Admin) | `demo.admin@valuemitra.in` | `Demo@12345` | Full access — manage users, clients, assignments, generate & review reports |
| **Valuer** | `demo.valuer@valuemitra.in` | `Demo@12345` | Create assignments, upload docs, run valuations, generate reports — cannot delete users |
| **Viewer** | `demo.viewer@valuemitra.in` | `Demo@12345` | Read-only — can view assignments and reports but cannot create, edit, or upload anything |

> **Want your own isolated firm?** Just click **"Register here"** on the login page. Your account will be a Firm Admin for a completely fresh workspace with no shared data.

---

## Role Permissions at a Glance

| Feature | Firm Admin | Valuer | Viewer |
|---|---|---|---|
| View dashboard | ✅ | ✅ | ✅ |
| View clients & assignments | ✅ | ✅ | ✅ |
| Create / edit clients | ✅ | ✅ | ❌ |
| Create / edit assignments | ✅ | ✅ | ❌ |
| Upload documents | ✅ | ✅ | ❌ |
| Run valuation | ✅ | ✅ | ❌ |
| Request AI valuation advice | ✅ | ✅ | ❌ |
| Generate report | ✅ | ✅ | ❌ |
| Submit for review / approve | ✅ | ❌ | ❌ |
| Manage team members | ✅ | ❌ | ❌ |

---

## How to Test — Step by Step

### Step 1 — Log In

1. Open https://vmapps.techsahyogi.com/login
2. Enter `demo.admin@valuemitra.in` and `Demo@12345`
3. Click **Sign in**
4. You should land on the **Dashboard** showing a welcome message and summary stats

**What to verify:** Welcome heading shows "Welcome, Demo Admin". Sidebar shows: Dashboard, Assignments, Clients, Documents, Valuation, Reports.

---

### Step 2 — Add a Client

A client is whoever is requesting the valuation — usually a bank branch or an individual borrower.

1. Click **Clients** in the sidebar
2. Click **+ New Client** (top right)
3. Select **Client Type** → choose **Bank**
4. Fill in:
   - Bank Name: `Punjab National Bank`
   - Branch: `Andheri East Branch`
   - Email: `pnb.andheri@example.com`
   - Phone: `9876543210`
   - City: `Mumbai`
5. Click **Create Client**
6. You should land on the client's detail page

**What to verify:** Client record is saved and shows the bank name, branch, and contact details.

---

### Step 3 — Create an Assignment

An assignment is one valuation job — a specific property for a specific client.

1. Click **Assignments** in the sidebar
2. Click **+ New Assignment**
3. Select the client you just created (start typing "Punjab" in the search box)
4. Property Type → **Residential Flat**
5. Purpose → **Mortgage / Home Loan**
6. Property Address → `Flat 404, Sunrise Heights, Versova`
7. City → `Mumbai`, State → `Maharashtra`
8. Click **Create Assignment**
9. You land on the **Assignment Detail page** with 5 tabs: Overview, Documents, Valuation, Reports, Review

**What to verify:** Assignment number appears in format `VMDEMO/2025-26/0001`. Status shows **Initiated**.

---

### Step 4 — Upload Documents

1. On the assignment detail, click the **Documents** tab
2. Select document type from the dropdown (e.g. **Sale Deed**)
3. Click **Upload File** and choose any PDF from your computer
4. The file appears in the list below with OCR status **Queued** (OCR processing runs in background every 30 seconds)

**What to verify:** File name appears in the documents table. OCR status updates from Queued → Processing → Completed over the next 1–2 minutes.

---

### Step 5 — Run a Valuation

1. Click the **Valuation** tab
2. You see "Start Valuation" with 4 approach buttons
3. Click **COST APPROACH** (most common for residential properties)
4. Fill in the cost data:
   - Land Area: `400` (sq.m.)
   - Land Rate: `20000` (₹/sq.m.)
   - Building Plinth Area: `120` (sq.m.)
   - Construction Rate: `28000` (₹/sq.m.)
   - Age of Building: `8` (years)
5. Click **Save & Compute**
6. The computed value appears below: Land Value + Depreciated Building Value = **Cost Approach Value**
7. In the **Finalize Valuation** section, type a justification note in the text area
8. Click **Finalize Valuation**

**What to verify:** "✅ Finalized" badge appears. "Final Adopted Value" is shown in Indian Rupee format (e.g. ₹95,20,000).

---

### Step 6 — Generate a Report

1. Click the **Reports** tab
2. Select a report template from the dropdown (these are bank-specific DOCX templates)
3. Click **Generate Report**
4. After a few seconds, the report appears in the list as a PDF

**What to verify:** Report is listed with a download link. Status shows Generated.

> **Note:** For the full report to generate successfully, the assignment must have a finalized valuation run. If you skipped Step 5, generation will be blocked.

---

### Step 7 — Review Workflow

The review process has 4 stages: Internal Review → Client/Bank Review → Compliance Check → Approved.

1. Click the **Review** tab
2. The stepper shows where the assignment is in the review pipeline
3. Once a report is generated, the **Submit for Internal Review** button appears
4. Click it to advance the assignment through the review stages
5. Each stage can be **Approved** (advance) or **Rejected** (send back with comments)

**What to verify:** Status badge on the assignment updates at each stage (e.g. Initiated → Internal Review → Approved → Delivered).

---

### Step 8 — Test the Viewer Role

1. Log out (click the arrow icon at the bottom-left of the sidebar)
2. Log in as `demo.viewer@valuemitra.in` / `Demo@12345`
3. Navigate to Assignments and Clients — you can see everything
4. Try clicking **+ New Assignment** — the button should not appear or should be disabled
5. Open an existing assignment → Documents tab → the Upload File button should not be visible

**What to verify:** Viewer can browse all data but has no create/edit buttons.

---

### Step 9 — Test the Valuer Role

1. Log out, log in as `demo.valuer@valuemitra.in` / `Demo@12345`
2. Create a client and assignment — this should work
3. Navigate to any assignment → Review tab → there should be no "Approve / Reject" buttons (only Admin can review)

**What to verify:** Valuer can do all operational work but cannot approve/reject review stages.

---

## Testing Wrong Password (Error Handling)

1. Go to https://vmapps.techsahyogi.com/login
2. Enter `demo.admin@valuemitra.in` with password `WrongPassword123!`
3. Click **Sign in**
4. A red error box should appear: **"Invalid credentials"**

---

## Key Pages Reference

| Page | URL Pattern | Description |
|---|---|---|
| Login | `/login` | Sign in page |
| Register | `/register` | Create a new firm workspace |
| Dashboard | `/dashboard` | Home with stats and recent activity |
| Clients list | `/clients` | All clients for your firm |
| New client | `/clients/new` | Add a client |
| Client detail | `/clients/:id` | View/edit a specific client |
| Assignments list | `/assignments` | All assignments |
| New assignment | `/assignments/new` | Start a new valuation job |
| Assignment detail | `/assignments/:id` | Tabs: Overview, Documents, Valuation, Reports, Review |

---

## Things Worth Knowing

- **Multi-tenant**: Each firm gets its own isolated workspace. The demo firm's data is completely separate from any firm you register yourself.
- **IBBI Compliance**: Reports can only be generated if the valuer has a valid IBBI registration number and digital signature on file. (For demo purposes, these checks are in place but the demo user has not uploaded a signature — so report generation may show an IBBI gate error. This is expected.)
- **Audit trail**: Every action (create, update, upload, approve) is permanently logged and cannot be deleted. This is required by IBBI regulations.
- **OCR is async**: Document text extraction runs in the background. Give it 1–2 minutes after uploading.
- **Government rates**: The system can automatically fetch Ready Reckoner rates for Maharashtra and Gujarat properties by triggering a background job. Manual entry is also supported.

---

## Quick Test Checklist

- [ ] Log in as Admin — see Dashboard
- [ ] Create a Bank client
- [ ] Create an Assignment linked to that client
- [ ] Upload a PDF document
- [ ] Run Cost Approach valuation and finalize
- [ ] Go to Reports tab and attempt to generate
- [ ] Go to Review tab — see the stepper
- [ ] Log in as Viewer — verify read-only access
- [ ] Log in as Valuer — verify no review buttons
- [ ] Test wrong password — verify error message appears
