# T-Shirt Shop Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the course-based demo app with a t-shirt shop scenario, rename roles from learner/creator/admin to customer/seller/admin, and remove courses/courseAccess tables.

**Architecture:** Remove domain-specific tables (courses, courseAccess) and replace with a generic "purchase access" concept. Seed data changes from courses to t-shirt products (one-time tee + monthly subscription box). Roles rename throughout schema, seed, providers, nav, and pages.

**Tech Stack:** Convex, React, TypeScript, Stripe

---

### Task 1: Update schema — remove courses/courseAccess, rename roles

**Files:**

- Modify: `example/convex/schema.ts`

**Changes:**

- Remove `courses` table definition
- Remove `courseAccess` table definition
- Change role union from `'learner' | 'creator' | 'admin'` to `'customer' | 'seller' | 'admin'`

---

### Task 2: Update courses.ts — remove entirely

**Files:**

- Delete: `example/convex/courses.ts`

---

### Task 3: Update seed.ts — t-shirt products, renamed roles

**Files:**

- Modify: `example/convex/seed.ts`

**Changes:**

- Remove course creation from `seedDb`
- Rename users: "Alex Learner" → "Alex Customer" (role: customer), "Jordan Creator" → "Jordan Seller" (role: seller)
- Update `seedStripe` products:
  - Product 1: "Classic Tee" — one-time purchase at $29
  - Product 2: "Tee of the Month Club" — $19/month subscription, $189/year

---

### Task 4: Update stripe.ts triggers — remove course access logic

**Files:**

- Modify: `example/convex/stripe.ts`

**Changes:**

- Remove `internal.courses.listPublished` and `grantAccess` calls from subscription onCreate trigger
- Remove `revokeAllAccess` call from subscription onDelete trigger
- Keep the webhook logging, just remove course-specific logic

---

### Task 5: Update reset.ts — remove courseAccess reference

**Files:**

- Modify: `example/convex/reset.ts`

**Changes:**

- Remove `'courseAccess'` from the tables array
- Remove `'courses'` from the tables array if present

---

### Task 6: Update queries.ts — remove courses from getSeedStatus

**Files:**

- Modify: `example/convex/queries.ts`

**Changes:**

- Remove `courses` query from `getSeedStatus`, just return `{ userCount }`

---

### Task 7: Update users.ts — rename role type

**Files:**

- Modify: `example/convex/users.ts`

**Changes:**

- Change role union from `'learner' | 'creator' | 'admin'` to `'customer' | 'seller' | 'admin'`

---

### Task 8: Update role-context.tsx — rename roles and mock users

**Files:**

- Modify: `example/src/providers/role-context.tsx`

**Changes:**

- Role type: `'customer' | 'seller' | 'admin'`
- MOCK_USERS: rename learner→customer (Alex Customer), creator→seller (Jordan Seller)
- Default role: `'customer'`

---

### Task 9: Update role-switcher.tsx — rename role labels

**Files:**

- Modify: `example/src/components/role-switcher.tsx`

**Changes:**

- Rename role options: learner→Customer, creator→Seller

---

### Task 10: Update nav-sidebar.tsx — rename roles and routes

**Files:**

- Modify: `example/src/components/nav-sidebar.tsx`

**Changes:**

- Rename `learner` key to `customer`, keep /dashboard routes
- Rename `creator` key to `seller`, change routes from /creator/_ to /seller/_
- Update role labels in nav header

---

### Task 11: Update App.tsx — rename routes and imports

**Files:**

- Modify: `example/src/App.tsx`

**Changes:**

- Rename /creator/_ routes to /seller/_
- Update imports from `pages/creator/*` to `pages/seller/*`
- Rename component names (CreatorHome→SellerHome, etc.)

---

### Task 12: Rename creator pages directory to seller

**Files:**

- Rename: `example/src/pages/creator/` → `example/src/pages/seller/`
- Modify each file: update exported component names and any "creator" text in UI

Files to update inside:

- `index.tsx` — rename export, update UI text
- `onboarding.tsx` — rename export, update heading from "Creator Onboarding" to "Seller Onboarding"
- `products.tsx` — rename export, update "Learners will see this" references
- `payouts.tsx` — rename export
- `account.tsx` — rename export

---

### Task 13: Update dashboard/index.tsx — remove courses, update for t-shirt shop

**Files:**

- Modify: `example/src/pages/dashboard/index.tsx`

**Changes:**

- Remove `api.courses.list` query
- Remove courses section
- Update text to reference t-shirt products instead of courses

---

### Task 14: Update landing.tsx — t-shirt shop copy

**Files:**

- Modify: `example/src/pages/landing.tsx`

**Changes:**

- Update marketing copy from courses to t-shirt shop theme

---

### Task 15: Update admin/setup.tsx — remove courseCount, update labels

**Files:**

- Modify: `example/src/pages/admin/setup.tsx`

**Changes:**

- Remove courseCount from seed status display
- Update description text from "courses" to "t-shirt products"
- Update labels from "learner, creator, admin" to "customer, seller, admin"

---

### Task 16: Build and verify

**Steps:**

- Run `npm run build` from project root
- Verify Convex typecheck passes
- Verify no remaining references to courses, courseAccess, learner, or creator
