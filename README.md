## 1.0.2

- Security: Thank‑you redirect is now gated server‑side. `/funded` only returns `order_received_url` when progress is FUNDED (0) or COMPLETE (30), or the order is already paid. Client redirects only when that URL is present.
- Client Guard: Removed UI fallback submission when finalize isn’t ready; checkout remains blocked with an inline message until funding completes.
- Order Resolution: Removed “recent Snap order” fallback from `/funded` to prevent cross‑session reuse. Resolution now relies on session `order_awaiting_payment`, explicit `order_key`, and the signed cookie.
- Attach Behavior: No more draft→pending promotion in `/attach`. Status changes happen only on FUNDED/COMPLETE.
- Progress 26 Handling: Note‑only (awaiting delivery); no status change.
- Observability: Added `funded_fetch_failed` and `funded_no_redirect` events to Woo logs for clear diagnostics.
- Version: Bumped to 1.0.2; assets use the version for cache‑busting.

## 0.5

## Architecture Overview

- Snap is a standard WooCommerce payment gateway with an eligibility/signing flow.
- Orders are created by WooCommerce; the plugin does not create new orders during finalize.
- Application IDs are attached to the current checkout order (latest in `_snap_application_id`, history in `_snap_application_ids`).
- Finalization is server-authenticated: the server calls Snap Status API and only returns a thank‑you URL for signed/complete states.

### Checkout Flow (Classic & Blocks)
- Customer selects Snap → clicks “Check eligibility” (opens Snap popup).
- Pre‑sign (approved/pending/docs): checkout remains blocked; inline messages guide the user.
- Signed (progress 26): server returns thank‑you URL; redirect to order confirmation; order is not marked paid; signed note added.
- Funded/Complete (progress 0/30): order is marked paid/complete; redirect to order confirmation.
- Declined/withdrawn/error: checkout remains blocked with clear messaging; merchant can switch methods.

### Endpoints and Security
- SDK URL (auto‑selects by Test mode):
  - Sandbox: `https://sandbox-sdk.snapfinance.co.uk/v1/snapuk.min.js`
  - Production: `https://sdk.snapfinance.co.uk/v1/snapuk.min.js`
- REST
  - `POST /wp-json/snap/v1/attach` — binds latest applicationId to the current draft order (no status promotion).
  - `POST /wp-json/snap/v1/funded` — calls Snap Status API; returns thank‑you URL only for progress 26/0/30.
  - `GET /wp-json/snap/v1/status` — server‑verified application status.
  - `POST /wp-json/snap/v1/journey` — optional stage logging (idempotent per stage).
- Security guards
  - REST nonces required for attach/funded/status/journey.
  - Finalize redirects only for progress ∈ {26, 0, 30}. Client does not fallback‑submit when not ready.
  - No recent‑order fallback (prevents cross‑session reuses). Resolution is session/order_key/cookie scoped.

### Status Mapping (Server)

| Code | Meaning                   | Order status change          | Order note                                                                                                      | Redirect? |
|------|---------------------------|------------------------------|------------------------------------------------------------------------------------------------------------------|-----------|
| 2    | PENDING                   | processing                   | Application pending. Awaiting decision.                                                                          | No        |
| 6    | APPROVED (pre‑sign)       | processing                   | Application approved. Awaiting customer actions.                                                                  | No        |
| 10   | APPROVED_WITH_CONDITIONS  | processing                   | Application approved with conditions.                                                                             | No        |
| 14   | DENIED                    | failed                       | Customer was declined by Snap. Try another lender or payment method. Customer can apply again in 30 days.        | No        |
| 18   | WITHDRAWN                 | cancelled                    | Application withdrawn by customer.                                                                                | No        |
| 22   | PENDING_DOCS              | processing                   | Application requires additional documents.                                                                        | No        |
| 26   | PENDING_DEL (signed)      | no change                    | Customer signed; awaiting merchant delivery. Confirm in Snap Merchant Portal for next day payment.               | Yes       |
| 30   | COMPLETE                  | completed (and paid)         | Snap lifecycle complete.                                                                                          | Yes       |
| -1   | ERROR/UNKNOWN             | on‑hold                      | Snap returned an error or unknown status. Manual check required.                                                  | No        |
| 0    | FUNDED                    | paid (ensure processing)     | Funded. Payment complete.                                                                                         | Yes       |

### Logs
- Unified CSV‑style Woo logs (source `snap`) include: `order_created`, `attach_ok`, `funded_start/done`, `journey`, `status_polled/ok`.
- Additional hardening events:
  - `funded_fetch_failed` — status fetch failed; finalize aborted.
  - `funded_no_redirect` — non‑funded state; no thank‑you URL returned.

### Versioning and Cache Busting
- All enqueued assets include `SNAP_FINANCE_PLUGIN_VERSION` as a query param.
- Bump the plugin header version to force cache refresh after releases.

### Testing Checklist
- Toggle Test mode: confirm SDK host switches (sandbox/prod).
- Declined flow blocks checkout and logs notes.
- Pre‑sign approved keeps checkout blocked; no redirect.
- Signed (26) redirects; note added; no status change.
- Funded/Complete (0/30) marks paid/complete; redirects.
- Hammer “Place order” cannot produce a thank‑you page unless signed/funded/complete.

- Security Hardening: Added nonce verification to wc-ajax `snap_save_application_cb`; removed insecure finalize AJAX (`ajax_mark_funded`) and consolidated on secured REST `/snap/v1/funded`.
- Code Cleanup: Removed deprecated `snap_seed_order` and duplicate class-based `handle_save_snap_application` to reduce redundancy.
- Audit Improvements: `/attach` now appends to `_snap_application_ids` while keeping the latest `_snap_application_id` for lookups.
- Robustness: Standardized localStorage keys to snake_case (`snap_application_id`, `snap_token`, `snap_application_status`, `snap_finance_approved`) and aligned Classic returning-customer detection.
- Finalize Robustness: Enhanced order resolution in `/attach` and `/funded` with pragmatic fallbacks (latest draft or most recent Snap order). Terminal guard preserved; no order creation in finalize.
- Observability: Added concise logs for fallback paths (`attach_fallback_recent`, `funded_fallback_draft`, `funded_fallback_recent`) to aid diagnostics without noise.
- Token Handling: Quiet rehydrate for expected 401s, plus a light pre-finalize token freshness check (status poll) to reduce `/funded` 401s.
# Snap Finance WooCommerce Plugin v1.0.0

A WordPress plugin that integrates Snap Finance UK's payment gateway with WooCommerce, allowing customers to apply for finance during checkout.

**Developed by:** James Doel  
**Company:** FinMatch  
**Website:** https://finmatch.co.uk  
**License:** GPL v2 or later

## ✅ **Compatibility**

- **WordPress**: 5.8+ (Tested up to 6.6)
- **WooCommerce**: 6.0+ (Tested up to 9.1)
- **PHP**: 7.4+
- **HPOS**: ✅ Fully compatible with WooCommerce High-Performance Order Storage

## 🏗️ **Architecture Overview (Updated)**

Highlights in 1.0.0
- Denied finalize no longer fails with order_not_seeded: fallback to latest Blocks draft order
- Server mapping hardened: failed/cancelled orders are not upshifted by attach/funded
- Production Status API base set to `https://prod-api.snapfinance.co.uk` via dynamic test mode
- Fix: Orders that reach failed/cancelled are not bumped back to pending by attach/funded flows
- Enforcement: Server-side process_payment blocks UI placement unless FUNDED/COMPLETE; DENIED fails with notice
- API Base: Production calls use `https://prod-api.snapfinance.co.uk` when not in test mode
- Attach → Enrich (no seed creation): The plugin no longer creates a new order onApplicationId. Instead it attaches Snap metadata to the existing Woo Blocks draft order.
- REST-first finalize: `POST /snap/v1/funded` verifies Snap status server‑side and transitions the same order. Idempotent and never creates.
- Limits enforcement: Snap is hidden when total is outside £250–£10,000 (Classic `is_available`, Blocks `is_active`). Frontend limits messaging removed; server finalize remains the final guard.
- Thank‑you page hardening: Blocks APIs are guarded so the order confirmation page doesn’t throw console errors.
- Server status logs and journey tracking added; DENIED maps to failed; PENDING_DEL note clarified; client sends DENIED to server without redirect.

## 🧭 Production diagnostics and logging

This plugin writes high‑signal, token‑safe diagnostics on both frontend and server. Use the guide below when supporting merchants.

| Source | Where to view | What it captures | PII/Security | Typical use |
|---|---|---|---|---|
| WooCommerce log: `snap` | WooCommerce → Status → Logs (select `snap`) | Server Status API replies (progressStatus), funded flow start/done, ATTACH outcomes, journey posts, idempotent finalizations, fallback to draft order | No bearer tokens; includes application_id, order_id, invoice_number | Trace application lifecycle; verify status mapping; ensure no duplicate orders; see which order finalized |
| WooCommerce log: `snap-finance` | WooCommerce → Status → Logs (select `snap-finance`) | Global order creation hook (“Order created #id (status, method)”) | No tokens | Detect unexpected order creation; correlate with attach/funded logs |
| WooCommerce log: `snap-debug` | WooCommerce → Status → Logs (select `snap-debug`) | Draft recovery warnings (e.g., total mismatches), attach/funded edge cases | No tokens | Investigate recovery logic and edge conditions |
| Order notes (per order) | Woo order admin → Order notes | Human‑readable notes for Snap statuses (DENIED, PENDING_DEL, FUNDED, COMPLETE), journey labels (“Reached Snap income”) | No tokens | See exact status transitions and journey waypoints for a specific order |
| Order meta (per order) | Woo order admin → Custom fields (or via code/DB) | `_snap_application_id`, `_snap_invoice_number`, `_snap_progress_status`, `_snap_journey_*` flags/timestamps, `_snap_journey_rows` array | Contains app ID/invoice; no tokens | Correlate with Snap; export journey footprints (CSV‑friendly) |
| REST route outcomes | Network logs / Woo logs above | `/wp-json/snap/v1/attach` ok/failed; `/wp-json/snap/v1/funded` success/idempotent/409 not seeded; `/wp-json/snap/v1/status` results | No tokens in logs; bearer used only server‑side | Verify attach/finalize paths, confirm idempotency, ensure no cart‑coupled creation |
| Frontend console (SnapRender/Blocks) | Browser devtools on merchant site | Render steps, validation guards, overlay clicks, SDK readiness, auto‑click, limits messages | Tokens are NOT logged; app IDs may appear | Reproduce UI flows and SDK callbacks; validate guard behavior |
| Diagnostic Utils (manual/auto) | Run `snapDiagnostic()` in console; auto 10s diagnostic | Focus/cursor, DOM path, selectable elements, click diagnostics, focus remediation | No tokens | Troubleshoot UX issues (focus traps, click handling) |
| WooCommerce notices | Checkout UI | Decline message and “complete your Snap application” warnings; limits messaging | End‑user only | Validate UX: declines blocked, pending not allowed, limits enforced |
| Web server access logs | Hosting/server logs | REST hits to `/wp-json/snap/v1/*`, timing, status codes | Standard web logs | Confirm traffic patterns and HTTP errors |

Security notes

- Frontend logging removes bearer tokens; server never logs tokens.
- Once an order is failed/cancelled, non‑funded updates only update meta/notes; status will not revert to pending/processing.

Optional exports

- Journey CSV: order_id with binary flags/timestamps can be exported from order meta (`_snap_journey_*`, `_snap_journey_rows`). A WP‑CLI export command can be added on request.

REST endpoints
- `POST /wp-json/snap/v1/attach` — binds `application_id` (and `invoice_number`, `order_key`) to the current draft order. No creation.
- `POST /wp-json/snap/v1/funded` — verifies with Snap, applies status/notes, and returns `order_received_url`. Idempotent.

```
snap-finance-payment-V2.2/
├── snap-finance.php               ← Main plugin file (PHP backend)
├── includes/
│   ├── class-wc-snap-finance-gateway.php  ← WooCommerce gateway class
│   ├── diagnostic-utils.js         ← Legacy debugging utilities (not currently used)
│   └── snap-focus-guard.js         ← Focus management for modals (future use)
├── assets/
│   ├── js/
│   │   ├── snap-render.js          ← Shared renderer (Classic + Blocks)
│   │   ├── checkout.js             ← Classic checkout driver
│   │   └── blocks.js               ← Blocks checkout driver
│   └── images/
│       ├── snap-finance-logo-primary.png
│       ├── snap-finance-logo-secondary.png
│       └── snap-finance-banner.jpg
└── README.md                       ← This documentation
```

## 🔧 **Technical Implementation**

### **Backend (PHP)**
- **Main Plugin**: `snap-finance.php` - WordPress plugin initialization
- **Gateway Class**: `includes/class-wc-snap-finance-gateway.php` - WooCommerce payment gateway
- **Database**: Creates `wp_snap_application_details` table for tracking applications
- **SDK Loading**: Enqueues Snap Finance UK SDK in `<head>` when gateway is enabled

### **Frontend (JavaScript)**
- **Shared Renderer**: `assets/js/snap-render.js` - Single source of truth for Snap SDK rendering
- **Classic Driver**: `assets/js/checkout.js` - Handles Classic WooCommerce checkout
- **Blocks Driver**: `assets/js/blocks.js` - Handles WooCommerce Blocks checkout
- **Payment Method Detector**: `assets/js/payment-method-detector.js` - Detects active payment method, publishes selection events
- **Form Monitoring (jQuery-free)**: `assets/js/form-monitor-util.js` - Event-driven validation mirroring (Classic + Blocks)
- **Transaction Data**: `assets/js/transaction-data.js` - Build/validate Snap transaction object
- **Legacy Utilities**: `includes/diagnostic-utils.js` (not currently used)
- **Future Utilities**: `includes/snap-focus-guard.js` (available for modal focus management)

### **Architecture Benefits**
- **Single Source of Truth**: Only `snap-render.js` calls the Snap SDK
- **Thin Drivers**: `checkout.js` and `blocks.js` only handle their respective checkout types
- **Clean Separation**: No duplicate logic between Classic and Blocks implementations
- **Minimal Footprint**: Only essential files with clear responsibilities

## 🚀 **Installation**

1. **Upload** the plugin folder to `/wp-content/plugins/`
2. **Activate** the plugin in WordPress admin
3. **Configure** credentials in WooCommerce → Settings → Payments → Snap Finance

## ⚙️ **Configuration**

### **Required Settings**
- **Enable/Disable**: Toggle the payment gateway
- **Title**: Payment method name shown to customers
- **Description**: Payment method description
- **Test Mode**: Toggle between sandbox and production
- **Merchant ID**: Your Snap Finance merchant ID (sandbox/production)
- **Client ID**: Your Snap Finance client ID (sandbox/production)
- **Button Theme**: Dark or Light theme for the Snap Finance button

### **SDK URLs**
- **Production**: `https://sdk.snapfinance.co.uk/v1/snapuk.min.js`
- **Sandbox**: `https://sandbox-sdk.snapfinance.co.uk/v1/snapuk.min.js`

## 🛒 **Checkout Flow**

### **Classic Checkout**
1. **Customer adds items** to cart (minimum £250, maximum £10,000)
2. **Selects Snap Finance** as payment method
3. **Snap Finance button** renders in checkout form
4. **Customer clicks button** → Snap Finance application modal opens
5. **Application completed** → Data saved via AJAX
6. **Order placed** → WooCommerce processes with Snap Finance data

### **Blocks Checkout**
1. **Customer adds items** to cart (minimum £250, maximum £10,000)
2. **Selects Snap Finance** as payment method in Blocks interface
3. **Snap Finance button** renders in Blocks payment method content
4. **Customer clicks button** → Snap Finance application modal opens
5. **Application completed** → Data saved via AJAX
6. **Order placed** → WooCommerce Blocks processes with Snap Finance data

## 🔄 UPDATED COMPREHENSIVE SNAP FINANCE PLUGIN FLOW (Chronological)

Phase 1: PHP Initialization (Page Load)
- Group 1: Credential lookup & test mode detection
  - 1.1 Test Mode Check → `$this->testmode` in `includes/class-wc-snap-finance-gateway.php`
  - 1.2 Sandbox vs Live SDK URL selection → `includes/class-wc-snap-finance-gateway.php`
  - 1.3 Credential assignment → `$this->client_id`, `$this->merchant_id`
- Group 2: PHP-side transaction object creation
  - 2.1 Invoice number generation → `WC' . time() . rand(100, 999)`
  - 2.2 Delivery date calculation → `$tomorrow->format('Y-m-d')`
  - 2.3 Cart products processing → `WC()->cart->get_cart()`
  - 2.4 Customer data extraction → `WC()->checkout->get_value()`
- Group 3: PHP → JS data transfer
  - 3.1 `snap_params` localization → `wp_localize_script('snap-render', 'snap_params', $params)`
  - 3.2 Credential transfer → `client_id`, `merchant_id`
  - 3.3 Transaction data transfer → transaction array

Phase 2: Payment Method Detection & Form Monitoring (User Interaction)
- Group 4: Payment method selection check
  - `PaymentMethodDetector.isSnapFinanceSelected()` (also dispatches `snapfinance:selected` / `snapfinance:deselected`)
  - Selection events & gating → `SnapRender.goIdle()` on deselect; `SnapRender.resumeActive()` on reselect (Blocks wires reselect to container-aware retry)
- Group 5: Event-driven form validation (mirrors WooCommerce validation)
  - 4.1 `FormMonitorUtil.monitorWooCommerceValidation()` observes Woo field classes and validation events (Blocks + Classic)
  - Classic is jQuery-free: native listeners + MutationObserver + `updated_checkout`/`checkout_error`

Phase 3: JavaScript Container Setup (User Selects Snap)
- Group 6: Container preparation & mounting
  - 4.2 Container creation → `ensureBlocksContainer()` in `assets/js/blocks.js`
  - 4.3 Container styling → `prepareContainer()` in `assets/js/snap-render.js`
  - 4.4 Readiness check → `containerIsReady()` in `assets/js/snap-render.js`

Phase 4: SDK Initialization & Availability
- Group 7: SDK wait/ready/init
  - 5.1 `waitForSDK()`
  - 5.2 SDK ready check → `typeof snapuk !== 'undefined' && snapuk.checkout.button`
  - 5.3 SDK initialization → `_sdkInitialized` flag

Phase 5: Transaction Data Processing (After SDK Ready)
- Group 8: JS-side transaction rebuild
  - 6.1 `window.SnapTransaction.build(snapParams)`
  - 6.2 Invoice caching → `makeInvoiceBasis()`, `__snapInvoiceCache`
  - 6.3 Customer data refresh → `getCustomer(snapParams)`
- Group 9: Final validation (pre-render)
  - 7.1 `window.SnapTransaction.validate(transaction, snapParams)`
  - 7.2 Amount limits check (Min £250, Max £10,000)
  - 7.3 Status update → `updateValidationStatus()`
  - 7.4 Stable transaction hash → `stableTxHash()`

Phase 6: Button Rendering (Final Step)
- Group 10: Theme detection & configuration
  - 8.1 `getSnapTheme(snapParams)`
  - 8.2 `theme: this.getSnapTheme(snapParams)` with fallback to DARK
- Group 11: SDK button rendering
  - 9.1 Button config creation → `buttonConfig`
  - 9.2 `snapuk.checkout.button(buttonConfig)`
  - 9.3 `_sdkButtonMounted = true`

Phase 7: Post-Render Setup (After Button Appears)
- Group 12: Immediate visibility & validation
  - 10.1 Immediate render call
  - 10.2 Validation overlay → `addValidationOverlay()` (handles Shadow DOM)
  - 10.3 Click handler → `addClickValidationHandler()` (blocks clicks if invalid)

### Shadow DOM & Button Mounting Assumptions (Critical)
- The Snap SDK mounts the checkout button by attaching a Shadow DOM to the host `#snap-uk-checkout`.
- A host element can only have one shadow root. Any subsequent `snapuk.checkout.button(...)` call on the SAME host that already has a shadow tree will throw:
  - `NotSupportedError: Failed to execute 'attachShadow' on 'Element': Shadow root cannot be created on a host which already hosts a shadow tree.`
- Our renderer therefore enforces the following contract:
  - If `#snap-uk-checkout.shadowRoot` exists, REPLACE the host with a fresh `<div id="snap-uk-checkout">` before calling the SDK again.
  - If there is no shadow root yet, we just clear `innerHTML` (no host replacement needed).
  - Post-render verification does NOT re-call the SDK on the same host; it only observes for presence of `shadowRoot`/button to avoid duplicate `attachShadow`.
  - Container readiness is checked and enforced before the SDK call to avoid SVG sizing issues (explicit 300×70 and visibility checks).

### Console Log Checklist (to validate the above)
- Selection & gating
  - `💤 SnapRender: idle (Snap not selected)` when switching away
  - `✅ SnapRender: active (Snap selected)` when switching back
- Container & readiness
  - `✅ STEP 1: Container found: <div id="snap-uk-checkout" ...>`
  - `🔍 Container not ready: ...` followed by enforced dimensions
  - `✅ Container is ready - proceeding with SDK call`
- Shadow handling
  - `🧹 Replacing host element to avoid duplicate shadow root` (only when `shadowRoot` already exists)
  - `🧹 Cleared container for fresh render`
- SDK availability & init
  - `✅ STEP 2: SDK fully available immediately (snapuk.checkout.button ready)`
  - `✅ STEP 3: Snap SDK initialized with client_id: ...`
- Transaction & validation
  - `📋 Transaction data for Snap SDK: { invoiceNumber: ..., validationStatus: ... }`
  - `↺ Stable transaction unchanged - updating validation messages only` (no full re-render)
- SDK call & post-checks
  - `🎯 STEP 5: Calling snapuk.checkout.button with config: ...`
  - `✅ STEP 5: Rendering Snap SDK button (deferred to next frames)`
  - `✅ STEP 5: SDK snapuk.checkout.button called successfully`
  - `⚠️ Post-render verification: shadow/button not observable yet (no retry to avoid duplicate attachShadow)` OR `✅ Post-render verification: shadow/button present`
- Overlay (invalid state)
  - `❌ VALIDATION FAILED: Adding transparent overlay to Snap button`
  - `✅ Validation overlay added successfully`
- Click guard
  - `🖱️ Snap button clicked - checking validation state...`
  - `❌ Validation overlay detected - blocking Snap application` (until fields fixed)

Notes
- Selection gating: `SnapRender` goes idle when Snap is not selected (cancels retries/timeouts, clears overlays/messages) and resumes cleanly on reselect.
- Validation mirroring: Snap warnings appear/disappear in lockstep with WooCommerce’s own field validation (Blocks + Classic), without duplicating business rules.
- jQuery-free: All monitoring uses native events and MutationObserver for maximum compatibility.

## 🔍 **Debugging**

### **Console Messages**
The plugin includes comprehensive step-by-step logging:
- `🎯 STEP 1: Starting Snap Finance render process`
- `✅ STEP 2: SDK fully available immediately (snapuk.checkout.button ready)`
- `✅ STEP 3: Snap SDK initialized with client_id`
- `🎯 STEP 4: Creating transaction data...`
- `✅ STEP 4: Built UK API transaction`
- `✅ STEP 5: SDK snapuk.checkout.button called successfully`

### **Common Issues**
- **SDK Not Loading**: Check console for `snapuk is undefined`
- **Button Not Appearing**: Verify `#snap-uk-checkout` container exists
- **Credentials Error**: Ensure Merchant ID and Client ID are correct
- **Minimum Amount**: Orders under £250 will be rejected
- **Maximum Amount**: Orders over £10,000 will be rejected
- **Pre-selected Method**: Button may not render immediately on page load (known issue)

## 📊 **Database Schema**

The plugin creates a `wp_snap_application_details` table:

```sql
CREATE TABLE wp_snap_application_details (
    id int(11) NOT NULL AUTO_INCREMENT,
    snap_application_id varchar(191) NOT NULL,
    customer_email varchar(255) NOT NULL,
    customer_first_name varchar(255) NOT NULL,
    customer_last_name varchar(255) NOT NULL,
    customer_phone varchar(20) NOT NULL,
    customer_address text NOT NULL,
    order_total decimal(10,2) NOT NULL,
    cart_id varchar(255) NOT NULL,
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY snap_application_id_unique (snap_application_id),
    KEY idx_customer_email (customer_email),
    KEY idx_cart_id (cart_id)
);
```

## 🔄 **Version History**

### 0.4
- Centralized version handling via `SNAP_FINANCE_PLUGIN_VERSION` (PHP) and `snap_params.plugin_version` (JS); removed hardcoded versions in logs and icon URLs
- Hide Snap outside limits at source (Classic `is_available`, Blocks `is_active`); removed frontend limits messaging
- Added STEP 4 logs and explicit max-amount rejection logging

### 0.3
- Added `/status` endpoint (server-verified progress logging) and client polling after session save
- Added `/journey` endpoint for per-stage notes + CSV-friendly binary flags
- Mapped DENIED (14) → failed with clear note; WITHDRAWN (18) remains cancelled
- Clarified PENDING_DEL (26) note for merchant delivery confirmation and next-day payout
- Client DENIED posts to `/funded` to sync server state without redirect; simplified code comments

### 0.2
- Removed seed creation; adopted attach → enrich architecture
- Added `/attach` endpoint; `/funded` is idempotent and non‑creating
- Hide Snap outside £250–£10,000 (Classic + Blocks); server finalize remains a guard
- Thank‑you page guards for Blocks APIs to avoid decodeEntities errors
- Logging: ATTACH/FUNDED start/done lines; global order creation logs

### 0.1
- Complete rewrite with modern architecture
- Proper WooCommerce gateway implementation
- Modular JavaScript structure
- Enhanced debugging and error handling
- Mobile compatibility improvements
- Security enhancements

## 📄 **License & Terms of Use**

**Proprietary Software License**

This Snap Finance Payment Gateway plugin ("the Software") is proprietary software owned by Expressive Consulting Limited t/a FinMatch ("FinMatch"), a company registered in the United Kingdom.

### **License Terms**

1. **Ownership**: The Software and all associated intellectual property rights are and shall remain the exclusive property of FinMatch.

2. **Limited License**: FinMatch grants you a limited, non-exclusive, non-transferable license to use the Software solely for the purpose of integrating Snap Finance payment services into your WooCommerce store.

3. **Restrictions**: You may not:
   - Copy, modify, adapt, or create derivative works of the Software
   - Reverse engineer, decompile, or disassemble the Software
   - Distribute, sublicense, or transfer the Software to third parties
   - Remove or alter any proprietary notices or branding

4. **Termination**: This license terminates automatically if you fail to comply with any of its terms and conditions.

5. **Warranty Disclaimer**: The Software is provided "as is" without warranty of any kind, either express or implied.

### **Intellectual Property**

All trademarks, service marks, and trade names used in connection with the Software are the property of their respective owners. Snap Finance is a trademark of Snap Finance UK Limited.

## 👨‍💻 **Support**

**Company**: FinMatch  
**Website**: https://finmatch.io  
**Email**: merchantsupport@finmatch.io

For technical support, feature requests, or licensing inquiries, please contact our merchant support team.

---

**© 2025 FinMatch. All rights reserved.**

---

**Status**: Production Ready ✅