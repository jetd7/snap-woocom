<?php
/**
 * Plugin Name: Snap Finance Payment Gateway
 * Plugin URI:  https://finmatch.co.uk
 * Description: Allow customers to apply for finance through Snap Finance UK (Classic & Blocks).
 * Version:     1.0.17
 * Author:      FinMatch
 * Author URI:  https://finmatch.co.uk
 * Text Domain: snap-finance-gateway
 * Domain Path: /languages
 * Requires at least: 5.8
 * Tested up to: 6.6
 * Requires PHP: 7.4
 * WC requires at least: 6.0
 * WC tested up to: 9.1
 * License:     Proprietary
 * License URI: https://finmatch.co.uk/terms-and-conditions/
 */

// Define plugin version once by reading header metadata
if ( ! defined( 'SNAP_FINANCE_PLUGIN_VERSION' ) ) {
    if ( ! function_exists( 'get_file_data' ) ) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }
    $data = function_exists( 'get_file_data' ) ? get_file_data( __FILE__, array( 'Version' => 'Version' ) ) : array();
    define( 'SNAP_FINANCE_PLUGIN_VERSION', isset( $data['Version'] ) && $data['Version'] ? $data['Version'] : '1.0.17' );
}

/**
 * Declare HPOS compatibility.
 * This plugin is compatible with WooCommerce's High-Performance Order Storage (HPOS).
 */
add_action( 'before_woocommerce_init', function() {
    if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
    }
} );

/** ========================================================================
 * TERMINOLOGY & LOGGING DOCUMENTATION
 * ========================================================================
 * 
 * IMPORTANT: Understanding Invoice vs Order Numbers
 * --------------------------------------------------
 * - "invoice_number" / "Snap Invoice": Generated transaction ID for Snap API
 *   Format: WC1728405123456 (WC + timestamp + random)
 *   Purpose: Unique identifier for Snap Finance application/transaction
 *   Stored in: Order meta "_snap_invoice_number"
 * 
 * - "order_id" / "WooCommerce Order": WordPress/WooCommerce post ID
 *   Format: Integer (e.g., 131703)
 *   Purpose: WooCommerce's internal order identifier
 *   Stored in: wp_posts.ID where post_type = 'shop_order'
 * 
 * - "application_id" / "App ID": Snap Finance's application identifier
 *   Format: Integer from Snap API (e.g., 57235001)
 *   Purpose: Links to Snap's internal application system
 *   Stored in: Order meta "_snap_application_id"
 * 
 * Order Attachment Flow (Classic vs Blocks)
 * ------------------------------------------
 * 
 * KEY DIFFERENCES: Classic vs Blocks Checkout
 * +--------------------------------+---------------------------+---------------------------+
 * | Aspect                         | CLASSIC CHECKOUT          | BLOCKS CHECKOUT           |
 * +--------------------------------+---------------------------+---------------------------+
 * | Order Creation Timing          | On form submission        | On page load              |
 * | Draft Order Status             | Never created             | 'checkout-draft'          |
 * | Session order_awaiting_payment | Usually empty pre-submit  | Contains draft order ID   |
 * | Primary Attach Method          | snap_invoice_match        | latest_draft              |
 * +--------------------------------+---------------------------+---------------------------+
 * Note: Success rates for each method will be populated based on merchant data analysis.
 * 
 * CLASSIC CHECKOUT FLOW:
 * 1. Customer lands on checkout page
 * 2. Customer fills form fields
 * 3. Customer selects Snap Finance payment method
 * 4. Customer clicks Snap button
 * 5. Snap application created
 * 6. /attach endpoint attempts to find order (methods 1-5 below)
 * 7. Customer completes Snap application
 * 8. Customer submits form
 * 9. WooCommerce creates order
 * 10. /funded endpoint finalizes order
 * 
 * BLOCKS CHECKOUT FLOW:
 * 1. Customer lands on checkout page
 * 2. WooCommerce Blocks creates draft order immediately
 * 3. Draft order stored in session
 * 4. Customer fills form (draft order updates in real-time)
 * 5. Customer selects Snap Finance payment method
 * 6. Customer clicks Snap button
 * 7. Snap application created
 * 8. /attach endpoint finds draft order ✅
 * 9. Customer completes Snap application
 * 10. Customer submits form (draft becomes 'pending')
 * 11. /funded endpoint finalizes order
 * 
 * ATTACH ENDPOINT METHOD CASCADE (Priority Order):
 * 1. session: order_awaiting_payment
 * 2. order_key: wc_get_order_id_by_order_key()
 * 3. snap_invoice_number: order meta lookup
 * 4. latest_draft: Blocks-style draft order (checkout-draft status)
 * 5. fallback_recent_snap_order: Last Snap Finance order (ANY status)
 * 
 * Comprehensive Logging Strategy
 * -------------------------------
 * All events logged via snap_orders_log() with these fields:
 * - order_id: WooCommerce order number (may be empty if no order found)
 * - event: attach_attempt, attach_lookup, attach_failed, attach_ok, etc.
 * - source: rest|api|hook (where log originated)
 * - application_id: Snap application ID
 * - invoice_number: Snap transaction ID (WC-prefixed)
 * - progress: Snap progressStatus code (2,6,10,14,18,22,26,30,0,-1)
 * - wc_status: WooCommerce order status (pending, processing, etc.)
 * - method: Payment method (snapfinance_refined)
 * - stage: Journey stage (checkout_loaded, popup_opened, etc.)
 * - note: Additional context (lookup_method, error reasons, etc.)
 * 
 * Key Log Events:
 * - order_created: WooCommerce creates order (hook)
 * - attach_attempt: /attach endpoint called with parameters
 * - attach_lookup: Successfully found order via specific method
 * - attach_lookup_failed: Specific lookup method failed (with reason)
 * - attach_deferred: /attach stored data in session for later (new in v1.0.12)
 * - attach_failed: All lookup methods exhausted, no order found
 * - attach_ok: Successfully attached application to order
 * - attach_via_hook_fallback: Session fallback succeeded during order creation (new in v1.0.12)
 * - order_creation_hook_skipped: Hook skipped (data already attached)
 * - status_polled: Status check performed (diagnostics)
 * - status_ok: Status check successful
 * - funded_start: Finalization started
 * - funded_done: Order finalized and status updated
 * - session_cleared: All Snap session keys cleared after finalize (new in v1.0.12)
 * 
 * Debugging Checklist:
 * --------------------
 * 1. Check WooCommerce → Status → Logs → snap-* files
 * 2. Look for attach_attempt → should show all parameters
 * 3. Check attach_lookup_failed → shows which methods failed and why
 * 4. If attach_failed → no order exists at time of attachment
 * 5. Browser console shows client-side attach attempts with emojis
 * 6. Order notes show: "Snap Finance application started. App ID: X, Snap Invoice: Y, Lookup method: Z"
 * 
 * --------------------------------------------------------------------- */

/** ------------------------------------------------------------------------
 * Unified orders log helper (CSV-style) → source: snap-orders
 * --------------------------------------------------------------------- */
if ( ! function_exists( 'snap_orders_log' ) ) {
    function snap_orders_log( string $event, array $fields = array() ): void {
        try {
            $logger = wc_get_logger();
            // Write CSV header once per day
            $today = gmdate( 'Y-m-d' );
            $last  = get_option( 'snap_orders_header_date', '' );
            if ( $last !== $today ) {
                $header = 'order_id,event,source,application_id,invoice_number,progress,wc_status,method,stage,note';
                $logger->info( $header, array( 'source' => 'snap' ) );
                update_option( 'snap_orders_header_date', $today, false );
            }
            $defaults = array(
                'source'         => '',         // api | url | rest | hook | system
                'order_id'       => '',
                'application_id' => '',
                'invoice_number' => '',
                'progress'       => '',         // Snap progressStatus
                'wc_status'      => '',         // Woo order status
                'method'         => '',         // Woo payment method
                'stage'          => '',         // journey stage slug
                'note'           => '',
            );
            $data = array_merge( $defaults, $fields );
            foreach ( $data as $k => $v ) {
                if ( is_array( $v ) || is_object( $v ) ) {
                    $data[ $k ] = '';
                } else {
                    $s = (string) $v;
                    $s = str_replace( array("\n","\r","\t",','), array(' ',' ',' ',';'), $s );
                    $data[ $k ] = $s;
                }
            }
            $row = implode( ',', array(
                (string) $data['order_id'],
                $event,
                $data['source'],
                $data['application_id'],
                $data['invoice_number'],
                (string) $data['progress'],
                $data['wc_status'],
                $data['method'],
                $data['stage'],
                $data['note'],
            ) );
            $logger->info( $row, array( 'source' => 'snap' ) );
        } catch ( Throwable $e ) {
            // swallow
        }
    }
}


if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/** ------------------------------------------------------------------------
 * Lightweight logger (debug only)
 * --------------------------------------------------------------------- */
if ( ! function_exists( 'snap_log' ) ) {
    function snap_log( $msg ) {
        if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
            error_log( 'SNAP ▶ ' . $msg );
        }
    }
}
snap_log( 'Main plugin file loaded' );

/** ------------------------------------------------------------------------
 * i18n
 * --------------------------------------------------------------------- */
add_action( 'init', function () {
    load_plugin_textdomain(
        'snap-finance-gateway',
        false,
        dirname( plugin_basename( __FILE__ ) ) . '/languages'
    );
}, 10 );



/** ------------------------------------------------------------------------
 * Activation: ensure DB table for application tracking
 * --------------------------------------------------------------------- */
register_activation_hook( __FILE__, function () {
    global $wpdb;

    $table_name      = $wpdb->prefix . 'snap_application_details';
    $charset_collate = $wpdb->get_charset_collate();

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';

    $sql = "CREATE TABLE $table_name (
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
    ) $charset_collate;";

    dbDelta( $sql );
    snap_log( 'Activation: DB table ensured' );
});

/** ------------------------------------------------------------------------
 * WooCommerce bootstrap
 * --------------------------------------------------------------------- */
add_action( 'plugins_loaded', function () {
    if ( ! class_exists( 'WooCommerce' ) ) {
        snap_log( 'WooCommerce not active; abort init' );
        return;
    }
    if ( ! class_exists( 'WC_Payment_Gateway' ) ) {
        snap_log( 'WC_Payment_Gateway missing; abort init' );
        return;
    }

    // Delay loading your gateway class until 'init' to avoid early translation triggers
    add_action( 'init', function() {
        $base = plugin_dir_path( __FILE__ );

        // Load gateway class
        $gateway_file = $base . 'includes/class-wc-snap-finance-gateway.php';
        if ( file_exists( $gateway_file ) ) {
            require_once $gateway_file;
            snap_log( 'Gateway class loaded' );
        } else {
            snap_log( 'ERROR: includes/class-wc-snap-finance-gateway.php not found' );
            return;
        }

        // Load Blocks integration if available
        $blocks_file = $base . 'includes/class-wc-snap-finance-blocks.php';
        if ( file_exists( $blocks_file ) ) {
            require_once $blocks_file;
            snap_log( 'Blocks integration class loaded' );
        }
    }, 20 );
}, 20 );

/** ------------------------------------------------------------------------
 * Register gateway (Classic) - delayed to avoid early translation triggers
 * --------------------------------------------------------------------- */
add_action( 'init', function() {
    add_filter( 'woocommerce_payment_gateways', function ( $gateways ) {
        error_log( 'SNAP DEBUG: woocommerce_payment_gateways filter TOP of callback called' );
        error_log( 'SNAP DEBUG: woocommerce_payment_gateways filter called' );
        
        if ( class_exists( 'WC_Snap_Finance_Gateway' ) ) {
            $gateways[] = 'WC_Snap_Finance_Gateway';
            snap_log( 'Gateway registered with WooCommerce' );
            error_log( 'SNAP DEBUG: Gateway registered with WooCommerce' );
            
            // Test instantiation
            try {
                $test_gateway = new WC_Snap_Finance_Gateway();
                error_log( 'SNAP DEBUG: Gateway instantiation test successful' );
                
                // Test if gateway is available
                if (method_exists($test_gateway, 'is_available')) {
                    $available = $test_gateway->is_available();
                    error_log( 'SNAP DEBUG: Gateway availability test: ' . ($available ? 'available' : 'not available') );
                }
            } catch (Exception $e) {
                error_log( 'SNAP DEBUG: Gateway instantiation test failed: ' . $e->getMessage() );
            }
        } else {
            snap_log( 'ERROR: WC_Snap_Finance_Gateway not found at registration time' );
            error_log( 'SNAP DEBUG ERROR: WC_Snap_Finance_Gateway not found at registration time' );
        }
        return $gateways;
    }, 20 );
}, 30 ); // Run after gateway class is loaded (init priority 20)

// Add debugging to see all available gateways
add_action( 'wp_footer', function() {
    if (function_exists('WC') && WC()->payment_gateways()) {
        $gateways = WC()->payment_gateways()->payment_gateways();
        error_log( 'SNAP DEBUG: All registered gateways: ' . implode(', ', array_keys($gateways)) );
        
        if (isset($gateways['snapfinance_refined'])) {
            error_log( 'SNAP DEBUG: Snap Finance gateway found in registered gateways' );
        } else {
            error_log( 'SNAP DEBUG: Snap Finance gateway NOT found in registered gateways' );
        }
    }
}, 999);

/** ------------------------------------------------------------------------
 * Register payment method with WooCommerce Blocks (if available)
 * - Uses your Blocks integration class (either separate file or embedded)
 * --------------------------------------------------------------------- */
add_action( 'woocommerce_blocks_loaded', function () {
    if ( ! class_exists( '\Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry' ) ) {
        snap_log( 'Blocks registry not available' );
        return;
    }

    // Support either class name (based on your file): WC_Snap_Finance_Block_Support or WC_Snap_Finance_Blocks
    if ( class_exists( 'WC_Snap_Finance_Block_Support' ) ) {
        add_action(
            'woocommerce_blocks_payment_method_type_registration',
            function ( \Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry $registry ) {
                $registry->register( new WC_Snap_Finance_Block_Support() );
                snap_log( 'Blocks payment method registered (Support)' );
                error_log( 'SNAP DEBUG: Blocks: Successfully registered WC_Snap_Finance_Block_Support' );
            }
        );
    } elseif ( class_exists( 'WC_Snap_Finance_Blocks' ) ) {
        add_action(
            'woocommerce_blocks_payment_method_type_registration',
            function ( \Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry $registry ) {
                $registry->register( new WC_Snap_Finance_Blocks() );
                snap_log( 'Blocks payment method registered (Blocks)' );
                error_log( 'SNAP DEBUG: Blocks: Successfully registered WC_Snap_Finance_Blocks' );
            }
        );
    } else {
        snap_log( 'Blocks integration class not found (ok if using embedded registration elsewhere)' );
        error_log( 'SNAP DEBUG: Blocks: No integration class found' );
    }
}, 30 ); // Run after gateway class is loaded

// The gateway class loads the Snap SDK (keeps load order correct)

/** ------------------------------------------------------------------------
 * Note: Script enqueuing is now handled entirely by the gateway class
 * to ensure proper load order and avoid duplication.
 * --------------------------------------------------------------------- */

/** ------------------------------------------------------------------------
 * WooCommerce AJAX endpoint to persist app + call Status API (minimal)
 * --------------------------------------------------------------------- */
add_action('wc_ajax_snap_save_application', 'snap_save_application_cb');
add_action('wc_ajax_nopriv_snap_save_application', 'snap_save_application_cb');

function snap_save_application_cb() {
    // Require nonce for CSRF protection
    $nonce = isset($_POST['nonce']) ? sanitize_text_field( wp_unslash( $_POST['nonce'] ) ) : '';
    if ( ! $nonce || ! wp_verify_nonce( $nonce, 'snap_finance_nonce' ) ) {
        wp_send_json_error( array( 'message' => 'Invalid nonce' ), 403 );
    }
    $app_id = isset($_POST['application_id']) ? sanitize_text_field(wp_unslash($_POST['application_id'])) : '';
    $token  = isset($_POST['token']) ? sanitize_textarea_field(wp_unslash($_POST['token'])) : '';
    if (!$app_id || !$token) {
        wp_send_json_error(['message' => 'Missing parameters'], 400);
    }

    $default_base = 'https://sandbox-platform.snap-engineering.co.uk';
    $base         = apply_filters( 'snap_finance_status_base_url', $default_base );
    $base         = untrailingslashit( $base );
    $url          = $base . '/v1/applications/status?applicationId=' . rawurlencode($app_id);
    $resp = wp_remote_get($url, [
        'headers' => ['Authorization' => 'Bearer ' . $token],
        'timeout' => 15,
    ]);
    if (is_wp_error($resp)) {
        wp_send_json_error(['message' => $resp->get_error_message()], 502);
    }
    $code = wp_remote_retrieve_response_code($resp);
    $body_raw = wp_remote_retrieve_body($resp);
    $body = json_decode($body_raw, true);
    if ($code !== 200 || !isset($body['progressStatus'])) {
        wp_send_json_error(['message' => 'Bad status response', 'code' => $code, 'body' => $body], 502);
    }

    $status = (int) $body['progressStatus'];

    if (function_exists('WC') && WC()->session) {
        WC()->session->set('snap_application', [
            'id'     => $app_id,
            'token'  => $token,
            'status' => $status,
            'time'   => time(),
        ]);
    }

    wp_send_json_success(['progressStatus' => $status]);
}

/** ------------------------------------------------------------------------
 * Helpers for REST finalize mapping and cleanup
 * --------------------------------------------------------------------- */
if ( ! function_exists( 'snap_add_note' ) ) {
    function snap_add_note( WC_Order $order, string $msg ): void {
        $order->add_order_note( 'Snap: ' . $msg );
    }
}

if ( ! function_exists( 'snap_clear_wc_session_after_finalize' ) ) {
    function snap_clear_wc_session_after_finalize(): void {
        if ( function_exists( 'WC' ) && WC()->session ) {
            // Clear standard WooCommerce session keys
            WC()->session->__unset( 'order_awaiting_payment' );
            WC()->session->__unset( 'reload_checkout' );
            WC()->session->__unset( 'snap_seeded_order_id' );
            
            // Clear ALL Snap session keys (comprehensive cleanup)
            WC()->session->__unset( 'snap_application' ); // Main application object
            WC()->session->__unset( 'snap_application_id_pending' ); // Session fallback keys
            WC()->session->__unset( 'snap_invoice_number_pending' );
            WC()->session->__unset( 'billing_email' ); // Email cache for REST context
        }
        if ( isset( $_SESSION['snap_seeded_order_id'] ) ) {
            unset( $_SESSION['snap_seeded_order_id'] );
        }
        // Also clear the signed cookie so a future checkout cannot accidentally
        // associate a new draft order with a prior funded application.
        try { snap_clear_signed_cookie( 'snap_seeded_order_id' ); } catch ( Throwable $e ) {}
        
        // Log cleanup for debugging
        try {
            snap_orders_log( 'session_cleared', array(
                'source' => 'cleanup',
                'note' => 'all_snap_session_keys_cleared_after_finalize'
            ) );
        } catch ( Throwable $e ) {}
    }
}

if ( ! function_exists( 'snap_apply_progress_to_order' ) ) {
    /**
     * Map Snap application progressStatus → WooCommerce order status + attached note
     *
     * Mapping (source of truth):
     *   2  PENDING                      → processing    | Note: "Application pending. Awaiting decision."
     *   6  APPROVED                     → processing    | Note: "Application approved. Awaiting customer actions."
     *   10 APPROVED_WITH_CONDITIONS     → processing    | Note: "Application approved with conditions."
     *   22 PENDING_DOCS                 → processing    | Note: "Application requires additional documents."
     *   26 PENDING_DEL (signed; awaiting delivery) → pending | Note: "Customer signed; awaiting merchant delivery..."
     *   0  FUNDED  (treated as paid)    → payment_complete; ensure processing | Note: "Funded. Payment complete."
     *   30 COMPLETE (terminal success)  → payment_complete; completed         | Note: "Snap lifecycle complete."
     *   14 DENIED                       → failed       | Note: "Customer was declined by Snap..."
     *   18 WITHDRAWN                    → cancelled    | Note: "Application withdrawn by customer."
     *   -1/other ERROR/UNKNOWN          → on-hold      | Note: "Snap returned an error or unknown status..."
     *
     * Rules and guarantees:
     * - Never upshift failed/cancelled orders on non-funded updates (only update meta/notes).
     * - Only mark an order paid on 0 (FUNDED per our mapping) or 30 (COMPLETE).
     * - Always attach context notes for merchant visibility in order admin.
     */
    function snap_apply_progress_to_order( WC_Order $order, int $progressStatus, array $ctx = [] ): void {
        $app_id = isset( $ctx['application_id'] ) ? $ctx['application_id'] : null;
        $inv    = isset( $ctx['invoice_number'] ) ? $ctx['invoice_number'] : null;

        if ( $app_id ) { $order->update_meta_data( '_snap_application_id', $app_id ); }
        if ( $inv )    { $order->update_meta_data( '_snap_invoice_number', $inv ); }
        $order->update_meta_data( '_snap_progress_status', $progressStatus );

        // Harden: never upshift terminal orders (failed/cancelled) on non-funded updates
        $current_status = $order->get_status();
        if ( in_array( $current_status, array( 'failed', 'cancelled' ), true ) && ! in_array( (int) $progressStatus, array( 0, 30 ), true ) ) {
            // Keep meta up to date, but do not change status
            snap_add_note( $order, sprintf( 'Ignoring status update (%d) due to terminal order status (%s).', (int) $progressStatus, $current_status ) );
            $order->save();
            return;
        }

        switch ( $progressStatus ) {
            case 2: // PENDING → processing + note (awaiting decision)
                if ( 'processing' !== $order->get_status() ) { $order->update_status( 'processing' ); }
                snap_add_note( $order, 'Application pending. Awaiting decision.' );
                break;

            case 6: // APPROVED → processing + note (awaiting customer action)
                if ( 'processing' !== $order->get_status() ) { $order->update_status( 'processing' ); }
                snap_add_note( $order, 'Application approved. Awaiting customer actions.' );
                break;

            case 10: // APPROVED_WITH_CONDITIONS → processing + note
                if ( 'processing' !== $order->get_status() ) { $order->update_status( 'processing' ); }
                snap_add_note( $order, 'Application approved with conditions.' );
                break;

            case 22: // PENDING_DOCS → processing + note
                if ( 'processing' !== $order->get_status() ) { $order->update_status( 'processing' ); }
                snap_add_note( $order, 'Application requires additional documents.' );
                break;

            case 26: // PENDING_DEL (signed; awaiting delivery)
                // Promote Blocks draft to a real order, but do not mark paid
                if ( 'checkout-draft' === $order->get_status() ) {
                    $order->update_status( 'pending' );
                }
                snap_add_note( $order, 'Customer signed; awaiting merchant delivery. Once the customer has received goods/service please confirm in your Snap Merchant Portal for next day payment.' );
                break;

            case 0: // FUNDED → mark paid; ensure processing + note
                if ( ! $order->is_paid() ) {
                    $order->payment_complete();
                    snap_add_note( $order, 'Funded. Payment complete.' );
                } else {
                    if ( 'processing' !== $order->get_status() && 'completed' !== $order->get_status() ) {
                        $order->update_status( 'processing' );
                    }
                    snap_add_note( $order, 'Already paid; confirming FUNDED state.' );
                }
                break;

            case 30: // COMPLETE (terminal success) → mark paid; completed + note
                if ( ! $order->is_paid() ) { $order->payment_complete(); }
                if ( 'completed' !== $order->get_status() ) { $order->update_status( 'completed' ); }
                snap_add_note( $order, 'Snap lifecycle complete.' );
                break;

            case 14: // DENIED → failed + decline note
                if ( 'failed' !== $order->get_status() ) { $order->update_status( 'failed' ); }
                snap_add_note( $order, 'Customer was declined by Snap. Try another lender or payment method. Customer can apply again with Snap in 30 days' );
                break;

            case 18: // WITHDRAWN → cancelled + note
                if ( 'cancelled' !== $order->get_status() ) { $order->update_status( 'cancelled' ); }
                snap_add_note( $order, 'Application withdrawn by customer.' );
                break;

            case -1: // ERROR/UNKNOWN → on-hold + diagnostic note
            default:
                if ( 'on-hold' !== $order->get_status() ) { $order->update_status( 'on-hold' ); }
                snap_add_note( $order, 'Snap returned an error or unknown status. Manual check required.' );
                break;
        }

        $order->save();
    }
}

/** ------------------------------------------------------------------------
 * Signed cookie + invoice helpers for seed/funded recovery
 * --------------------------------------------------------------------- */
if ( ! function_exists( 'snap_cookie_sign' ) ) {
    function snap_cookie_sign( string $name, int $order_id ): string {
        $key = wp_salt( 'auth' );
        return hash_hmac( 'sha256', $name . '|' . $order_id, $key );
    }
}

if ( ! function_exists( 'snap_set_signed_cookie' ) ) {
    function snap_set_signed_cookie( string $name, int $order_id, int $ttl = DAY_IN_SECONDS ): void {
        $sig  = snap_cookie_sign( $name, $order_id );
        $val  = wp_json_encode( array( 'id' => $order_id, 'sig' => $sig ) );
        $host = parse_url( home_url(), PHP_URL_HOST );
        setcookie( $name, $val, time() + $ttl, '/', $host, is_ssl(), true ); // HttpOnly
    }
}

if ( ! function_exists( 'snap_get_signed_cookie' ) ) {
    function snap_get_signed_cookie( string $name ): ?int {
        if ( empty( $_COOKIE[ $name ] ) ) return null;
        $raw = wp_unslash( $_COOKIE[ $name ] );
        $obj = json_decode( $raw, true );
        if ( ! is_array( $obj ) || empty( $obj['id'] ) || empty( $obj['sig'] ) ) return null;
        $id  = (int) $obj['id'];
        $sig = (string) $obj['sig'];
        $exp = snap_cookie_sign( $name, $id );
        return hash_equals( $exp, $sig ) ? $id : null;
    }
}

if ( ! function_exists( 'snap_clear_signed_cookie' ) ) {
    function snap_clear_signed_cookie( string $name ): void {
        $host = parse_url( home_url(), PHP_URL_HOST );
        setcookie( $name, '', time() - 3600, '/', $host, is_ssl(), true );
    }
}

if ( ! function_exists( 'snap_link_invoice_to_order' ) ) {
    function snap_link_invoice_to_order( string $invoice_number, int $order_id ): void {
        if ( $invoice_number !== '' && $order_id > 0 ) {
            set_transient( 'snap_inv_' . $invoice_number, (int) $order_id, DAY_IN_SECONDS );
        }
    }
}

if ( ! function_exists( 'snap_find_order_by_invoice' ) ) {
    function snap_find_order_by_invoice( string $invoice_number ): ?WC_Order {
        if ( $invoice_number === '' ) return null;
        $id = (int) get_transient( 'snap_inv_' . $invoice_number );
        if ( $id > 0 ) {
            $order = wc_get_order( $id );
            if ( $order ) return $order;
        }
        return null;
    }
}

/** ------------------------------------------------------------------------
 * Find latest draft order (primarily for Blocks checkout)
 * 
 * BLOCKS CHECKOUT:
 * - WooCommerce Blocks creates orders with status 'checkout-draft' when 
 *   the checkout page is loaded
 * - Draft orders are updated as customer fills the form
 * - Draft becomes 'pending' when checkout is submitted
 * - This function has HIGH SUCCESS RATE for Blocks
 * 
 * CLASSIC CHECKOUT:
 * - Classic checkout does NOT create draft orders
 * - Orders only created when customer submits the form
 * - This function has VERY LOW SUCCESS RATE for Classic
 * - Will only succeed if a Blocks draft exists from different session
 * 
 * @param float|null $expected_total Optional total to validate against
 * @return int Order ID if found, 0 otherwise
 * --------------------------------------------------------------------- */
if ( ! function_exists( 'snap_find_blocks_draft_order_id' ) ) {
    function snap_find_blocks_draft_order_id( $expected_total = null ) : int {
        try {
            // Look for latest order with checkout-draft status
            $args = array(
                'limit'        => 1,
                'orderby'      => 'date',
                'order'        => 'DESC',
                'status'       => array( 'checkout-draft' ), // Blocks-specific status
                'return'       => 'ids',
            );
            $orders = wc_get_orders( $args );
            if ( empty( $orders ) ) { return 0; }
            $order_id = (int) $orders[0];
            $order    = wc_get_order( $order_id );
            if ( ! $order ) { return 0; }
            
            // Optional: validate order total matches expected
            if ( null !== $expected_total ) {
                if ( wc_format_decimal( $order->get_total() ) !== wc_format_decimal( $expected_total ) ) {
                    wc_get_logger()->warning( sprintf( 'Draft order total mismatch; expected %s, found %s (#%d)', $expected_total, $order->get_total(), $order_id ), array( 'source' => 'snap' ) );
                }
            }
            return $order_id;
        } catch ( Throwable $e ) {
            return 0;
        }
    }
}

/** ------------------------------------------------------------------------
 * Global debug hook: log all order creations (to Woo logs)
 * --------------------------------------------------------------------- */
if ( ! has_action( 'woocommerce_new_order', 'snap_log_new_order_creation' ) ) {
    function snap_log_new_order_creation( $order_id ) {
        $order = wc_get_order( $order_id );
        if ( $order ) {
            $method  = $order->get_payment_method();
            $status  = $order->get_status();
            snap_orders_log( 'order_created', array(
                'source'   => 'hook',
                'order_id' => (string) $order_id,
                'wc_status'=> $status,
                'method'   => $method ?: '(none)'
            ) );
        }
    }
    add_action( 'woocommerce_new_order', 'snap_log_new_order_creation', 10, 1 );
}

/** ------------------------------------------------------------------------
 * REST: POST /wp-json/snap/v1/funded
 * Finalize funded application by creating a WC order server-side and redirecting
 * --------------------------------------------------------------------- */
add_action( 'rest_api_init', function() {
    register_rest_route( 'snap/v1', '/funded', array(
        'methods'  => 'POST',
        'callback' => 'snap_rest_funded_cb',
        'permission_callback' => function( $request ) {
            // Allow REST nonce from logged-in and guest checkout
            $nonce = isset($_SERVER['HTTP_X_WP_NONCE']) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_WP_NONCE'] ) ) : '';
            return wp_verify_nonce( $nonce, 'wp_rest' );
        },
        'args' => array(
            'application_id' => array( 'required' => true ),
            'bearer'         => array( 'required' => false ),
            'invoice_number' => array( 'required' => false ),
            'progress_status'=> array( 'required' => false ),
        ),
    ) );


    // Attach: link application to existing checkout-draft order
    register_rest_route( 'snap/v1', '/attach', array(
        'methods'  => 'POST',
        'callback' => 'snap_rest_attach_cb',
        'permission_callback' => function() {
            $nonce = isset($_SERVER['HTTP_X_WP_NONCE']) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_WP_NONCE'] ) ) : '';
            return is_user_logged_in() || wp_verify_nonce( $nonce, 'wp_rest' );
        },
        'args' => array(
            'application_id' => array( 'required' => true ),
            'invoice_number' => array( 'required' => false ),
            'order_key'      => array( 'required' => false ),
            'cart_hash'      => array( 'required' => false ),
        ),
    ) );

    // Status: return server-verified application status
    register_rest_route( 'snap/v1', '/status', array(
        'methods'  => 'GET',
        'callback' => 'snap_rest_status_cb',
        'permission_callback' => function( $request ) {
            $nonce = isset($_SERVER['HTTP_X_WP_NONCE']) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_WP_NONCE'] ) ) : '';
            return is_user_logged_in() || wp_verify_nonce( $nonce, 'wp_rest' );
        },
        'args' => array(
            'application_id' => array( 'required' => true ),
            'bearer'         => array( 'required' => false ),
        ),
    ) );

    // Journey: record reached URL stages with timestamps
    register_rest_route( 'snap/v1', '/journey', array(
        'methods'  => 'POST',
        'callback' => 'snap_rest_journey_cb',
        'permission_callback' => function( $request ) {
            $nonce = isset($_SERVER['HTTP_X_WP_NONCE']) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_WP_NONCE'] ) ) : '';
            return is_user_logged_in() || wp_verify_nonce( $nonce, 'wp_rest' );
        },
        'args' => array(
            'stage'          => array( 'required' => true ),
            'application_id' => array( 'required' => false ),
        ),
    ) );
} );

// Removed deprecated seed handler; attach model is the single source of truth

// Attach handler: bind app to existing draft order (no order creation)
if ( ! function_exists( 'snap_rest_attach_cb' ) ) {
    function snap_rest_attach_cb( WP_REST_Request $r ) {
        try {
            $app_id  = sanitize_text_field( (string) ( $r->get_param( 'application_id' ) ?? '' ) );
            $invoice = sanitize_text_field( (string) ( $r->get_param( 'invoice_number' ) ?? '' ) );
            $order_key = sanitize_text_field( (string) ( $r->get_param( 'order_key' ) ?? '' ) );
            
            // Log attach attempt with all parameters
            try { 
                snap_orders_log( 'attach_attempt', array( 
                    'source' => 'rest', 
                    'application_id' => $app_id,
                    'invoice_number' => $invoice,
                    'order_key' => $order_key ?: '(none)',
                    'note' => 'Starting order lookup'
                ) ); 
            } catch ( Throwable $e ) {}
            
            if ( $app_id === '' ) {
                try { snap_orders_log( 'attach_failed', array( 'source' => 'rest', 'note' => 'missing_application_id' ) ); } catch ( Throwable $e ) {}
                return new WP_REST_Response( array( 'ok' => false, 'reason' => 'missing_application_id' ), 400 );
            }

            $order_id = 0;
            $lookup_method = '';
            
            // ========================================================================
            // ORDER LOOKUP CASCADE - Tries multiple methods in priority order
            // ========================================================================
            
            // Method 1: Session order_awaiting_payment - Primarily for Blocks checkout
            if ( function_exists( 'WC' ) && WC()->session ) {
                $order_id = (int) ( WC()->session->get( 'order_awaiting_payment' ) ?: 0 );
                if ( $order_id ) {
                    $lookup_method = 'session_order_awaiting_payment';
                    try { snap_orders_log( 'attach_lookup', array( 'source' => 'rest', 'method' => $lookup_method, 'order_id' => (string) $order_id, 'application_id' => $app_id ) ); } catch ( Throwable $e ) {}
                } else {
                    try { snap_orders_log( 'attach_lookup_failed', array( 'source' => 'rest', 'method' => 'session_order_awaiting_payment', 'note' => 'session_empty', 'application_id' => $app_id ) ); } catch ( Throwable $e ) {}
                }
            } else {
                try { snap_orders_log( 'attach_lookup_failed', array( 'source' => 'rest', 'method' => 'session_order_awaiting_payment', 'note' => 'wc_session_unavailable', 'application_id' => $app_id ) ); } catch ( Throwable $e ) {}
            }
            
            // Method 2: Order key lookup - Used by both Classic and Blocks
            if ( ! $order_id && $order_key !== '' ) {
                $order_id = (int) wc_get_order_id_by_order_key( $order_key );
                if ( $order_id ) {
                    $lookup_method = 'order_key';
                    try { snap_orders_log( 'attach_lookup', array( 'source' => 'rest', 'method' => $lookup_method, 'order_id' => (string) $order_id, 'order_key' => $order_key, 'application_id' => $app_id ) ); } catch ( Throwable $e ) {}
                } else {
                    try { snap_orders_log( 'attach_lookup_failed', array( 'source' => 'rest', 'method' => 'order_key', 'note' => 'no_match', 'order_key' => $order_key, 'application_id' => $app_id ) ); } catch ( Throwable $e ) {}
                }
            }
            
            // Method 3: Snap invoice number lookup - Used by both Classic and Blocks
            if ( ! $order_id && $invoice !== '' ) {
                $order = snap_find_order_by_invoice( $invoice );
                if ( $order ) { 
                    $order_id = (int) $order->get_id();
                    $lookup_method = 'snap_invoice_number';
                    try { snap_orders_log( 'attach_lookup', array( 'source' => 'rest', 'method' => $lookup_method, 'order_id' => (string) $order_id, 'invoice_number' => $invoice, 'application_id' => $app_id ) ); } catch ( Throwable $e ) {}
                } else {
                    try { snap_orders_log( 'attach_lookup_failed', array( 'source' => 'rest', 'method' => 'snap_invoice_number', 'note' => 'no_match', 'invoice_number' => $invoice, 'application_id' => $app_id ) ); } catch ( Throwable $e ) {}
                }
            }
            
            // Method 4: Latest draft order - Primarily for Blocks checkout
            if ( ! $order_id ) {
                $order_id = snap_find_blocks_draft_order_id( null );
                if ( $order_id ) {
                    $lookup_method = 'latest_draft';
                    try { snap_orders_log( 'attach_lookup', array( 'source' => 'rest', 'method' => $lookup_method, 'order_id' => (string) $order_id, 'application_id' => $app_id ) ); } catch ( Throwable $e ) {}
                } else {
                    try { snap_orders_log( 'attach_lookup_failed', array( 'source' => 'rest', 'method' => 'latest_draft', 'note' => 'no_draft_found', 'application_id' => $app_id ) ); } catch ( Throwable $e ) {}
                }
            }
            
            // Method 5: Identifier-based fallback - Primarily for Classic checkout
            if ( ! $order_id && $invoice !== '' ) {
                $args = array(
                    'limit'          => 5, // Check multiple recent orders for invoice match
                    'return'         => 'objects', // Need full object for meta checks
                    'payment_method' => 'snapfinance_refined', // HPOS-safe
                    'orderby'        => 'date',
                    'order'          => 'DESC',
                    'status'         => array( 'pending', 'on-hold', 'checkout-draft' ),
                );
                
                // Scope to current customer - CRITICAL for security
                if ( $customer_id = get_current_user_id() ) {
                    $args['customer_id'] = $customer_id;
                } else {
                    // Get email from session or request (NOT WC()->checkout->get_value in REST context)
                    $email = null;
                    if ( function_exists( 'WC' ) && WC()->session ) {
                        $email = WC()->session->get( 'billing_email' );
                    }
                    if ( ! $email && ! empty( $_POST['billing_email'] ) ) {
                        $email = sanitize_email( wp_unslash( $_POST['billing_email'] ) );
                    }
                    if ( $email ) {
                        $args['billing_email'] = $email;
                    }
                }
                
                $candidates = wc_get_orders( $args );
                
                // Find order matching Snap invoice number (unique identifier)
                foreach ( $candidates as $candidate_order ) {
                    $order_invoice = $candidate_order->get_meta( '_snap_invoice_number' );
                    
                    if ( $order_invoice === $invoice ) {
                        $order_id = $candidate_order->get_id();
                        $lookup_method = 'snap_invoice_match';
                        try { 
                            snap_orders_log( 'attach_lookup', array( 
                                'source' => 'rest', 
                                'method' => $lookup_method, 
                                'order_id' => (string) $order_id, 
                                'application_id' => $app_id,
                                'invoice_number' => $invoice,
                                'note' => 'matched_via_snap_invoice_METHOD5'
                            ) ); 
                        } catch ( Throwable $e ) {}
                        break;
                    }
                }
                
                if ( ! $order_id && ! empty( $candidates ) ) {
                    try { 
                        snap_orders_log( 'attach_lookup_failed', array( 
                            'source' => 'rest', 
                            'method' => 'identifier_based_fallback', 
                            'note' => 'customer_matched_but_no_invoice_match',
                            'application_id' => $app_id,
                            'invoice_number' => $invoice
                        ) ); 
                    } catch ( Throwable $e ) {}
                } elseif ( ! $order_id ) {
                    try { 
                        snap_orders_log( 'attach_lookup_failed', array( 
                            'source' => 'rest', 
                            'method' => 'identifier_based_fallback', 
                            'note' => 'no_customer_orders_found',
                            'application_id' => $app_id,
                            'invoice_number' => $invoice
                        ) ); 
                    } catch ( Throwable $e ) {}
                }
            }
            
            // Final check: no order found at all
            if ( ! $order_id ) {
                // Store in session as fallback for order creation hook
                if ( function_exists( 'WC' ) && WC()->session ) {
                    WC()->session->set( 'snap_application_id_pending', $app_id );
                    WC()->session->set( 'snap_invoice_number_pending', $invoice );
                    try { 
                        snap_orders_log( 'attach_deferred', array( 
                            'source' => 'rest', 
                            'application_id' => $app_id,
                            'invoice_number' => $invoice,
                            'note' => 'no_order_found_stored_in_session_for_creation_hook'
                        ) ); 
                    } catch ( Throwable $e ) {}
                } else {
                    try { 
                        snap_orders_log( 'attach_failed', array( 
                            'source' => 'rest', 
                            'application_id' => $app_id,
                            'invoice_number' => $invoice,
                            'note' => 'no_order_found_no_session'
                        ) ); 
                    } catch ( Throwable $e ) {}
                }
                return new WP_REST_Response( array( 'ok' => false, 'reason' => 'no_order_found', 'deferred' => true ), 200 );
            }

            $order = wc_get_order( $order_id );
            if ( ! $order ) {
                return new WP_REST_Response( array( 'ok' => false, 'reason' => 'order_load_failed' ), 200 );
            }

            $order->set_payment_method( 'snapfinance_refined' );
            $order->set_payment_method_title( 'Snap Finance' );
            if ( $invoice !== '' )  { $order->update_meta_data( '_snap_invoice_number', $invoice ); }
            // Update application id (latest) and append to history for auditability
            $app_ids = (array) $order->get_meta( '_snap_application_ids' );
            $app_ids[] = $app_id;
            $order->update_meta_data( '_snap_application_ids', array_values( array_unique( $app_ids ) ) );
            // Enforce lock: if order already locked to a different signed app, reject
            $locked_app = (string) $order->get_meta( '_snap_signed_lock_app_id' );
            if ( $locked_app && $locked_app !== $app_id ) {
                try { snap_orders_log( 'attach_failed', array( 'source' => 'rest', 'order_id' => (string) $order_id, 'application_id' => $app_id, 'note' => 'order_locked_signed' ) ); } catch ( Throwable $e ) {}
                return new WP_REST_Response( array( 'ok' => false, 'reason' => 'order_locked_signed' ), 423 );
            }
            $order->update_meta_data( '_snap_application_id', $app_id );
            // Do not promote draft to pending on attach; status changes only on funded/complete
            $order->add_order_note( sprintf( 'Snap Finance application started. App ID: %s, Snap Invoice: %s, Lookup method: %s', $app_id, $invoice, $lookup_method ) );
            $order->save();

            if ( function_exists( 'WC' ) && WC()->session ) {
                WC()->session->set( 'snap_seeded_order_id', (int) $order_id );
            }
            if ( $invoice !== '' ) { snap_link_invoice_to_order( $invoice, (int) $order_id ); }
            snap_set_signed_cookie( 'snap_seeded_order_id', (int) $order_id, DAY_IN_SECONDS );

            try {
                snap_orders_log( 'attach_ok', array(
                    'source'         => 'rest',
                    'order_id'       => (string) $order_id,
                    'application_id' => $app_id,
                    'invoice_number' => $invoice,
                    'wc_status'      => $order->get_status(),
                    'method'         => $order->get_payment_method(),
                    'note'           => 'lookup_via_' . $lookup_method,
                ) );
            } catch ( Throwable $e ) {}

            return new WP_REST_Response( array( 'ok' => true, 'order_id' => (int) $order_id, 'lookup_method' => $lookup_method ), 200 );
        } catch ( Throwable $e ) {
            return new WP_REST_Response( array( 'ok' => false, 'reason' => 'attach_exception' ), 500 );
        }
    }
}

if ( ! function_exists( 'snap_rest_funded_cb' ) ) {
function snap_rest_funded_cb( WP_REST_Request $request ) {
        if ( ! function_exists( 'WC' ) ) {
        return new WP_REST_Response( array( 'success' => false, 'error' => 'empty_cart_or_session' ), 400 );
    }

        $app_id          = sanitize_text_field( $request->get_param( 'application_id' ) );
        $bearer          = sanitize_text_field( $request->get_param( 'bearer' ) );
        $invoice_number  = $request->get_param( 'invoice_number' );
        $progress_status = $request->get_param( 'progress_status' );
    if ( empty( $app_id ) ) {
        return new WP_REST_Response( array( 'success' => false, 'error' => 'missing_application_id' ), 400 );
    }
    if ( empty( $bearer ) ) {
        return new WP_REST_Response( array( 'success' => false, 'error' => 'missing_bearer' ), 400 );
    }

        // Ask Snap for the latest application status (server-side check)
    $default_base = 'https://sandbox-platform.snap-engineering.co.uk';
        $base         = apply_filters( 'snap_finance_status_base_url', $default_base );
        $base         = untrailingslashit( $base );
        $status_url   = $base . '/v1/applications/status?applicationId=' . rawurlencode( $app_id );
        $resp         = wp_remote_get( $status_url, array(
        'headers' => array( 'Authorization' => 'Bearer ' . $bearer ),
        'timeout' => 20,
    ) );
    if ( is_wp_error( $resp ) ) {
        try { snap_orders_log( 'funded_fetch_failed', array( 'source' => 'rest', 'application_id' => $app_id, 'note' => 'HTTP error: ' . $resp->get_error_message() ) ); } catch ( Throwable $e ) {}
        return new WP_REST_Response( array( 'success' => false, 'error' => 'snap_status_http', 'details' => $resp->get_error_message() ), 502 );
    }
        $code     = (int) wp_remote_retrieve_response_code( $resp );
        $body     = json_decode( wp_remote_retrieve_body( $resp ), true );
    if ( $code !== 200 || ! is_array( $body ) || ! isset( $body['progressStatus'] ) ) {
        try { snap_orders_log( 'funded_fetch_failed', array( 'source' => 'rest', 'application_id' => $app_id, 'note' => 'Bad response', 'progress' => '' ) ); } catch ( Throwable $e ) {}
        return new WP_REST_Response( array( 'success' => false, 'error' => 'snap_status_bad_response', 'http' => $code, 'body' => $body ), 502 );
    }
        $progress  = (int) $body['progressStatus'];
        try { snap_orders_log( 'status_ok', array( 'source' => 'api', 'application_id' => $app_id, 'progress' => (string) $progress ) ); } catch ( Throwable $e ) {}

        // First choice: use the checkout-draft order we already attached in this session
        $seeded_id = null;
        if ( function_exists( 'WC' ) && WC()->session ) {
            $seeded_id = (int) ( WC()->session->get( 'snap_seeded_order_id' ) ?: 0 );
        }
        if ( ! $seeded_id && session_status() === PHP_SESSION_ACTIVE && ! empty( $_SESSION['snap_seeded_order_id'] ) ) {
            $seeded_id = (int) $_SESSION['snap_seeded_order_id'];
        }
        if ( $seeded_id ) {
            $seeded_order = wc_get_order( $seeded_id );
        if ( $seeded_order ) {
            try { snap_orders_log( 'funded_start', array( 'source' => 'api', 'order_id' => (string) $seeded_order->get_id(), 'application_id' => $app_id, 'progress' => (string) $progress, 'wc_status' => $seeded_order->get_status(), 'method' => $seeded_order->get_payment_method() ) ); } catch ( Throwable $e ) {}
                // If this order is already paid, return success (no duplicate actions)
        if ( $seeded_order->is_paid() || $seeded_order->get_transaction_id() ) {
                    if ( ! empty( $invoice_number ) ) { $seeded_order->update_meta_data( '_snap_invoice_number', (string) $invoice_number ); }
                    $seeded_order->update_meta_data( '_snap_progress_status', (int) $progress );
                    $seeded_order->save();
                try { wc_get_logger()->info( sprintf( 'Snap funded done (idempotent): order#%d status=%s method=%s', $seeded_order->get_id(), $seeded_order->get_status(), $seeded_order->get_payment_method() ), array( 'source' => 'snap' ) ); } catch ( Throwable $e ) {}
                return new WP_REST_Response( array(
                    'success'            => true,
                    'idempotent'         => true,
                    'order_id'           => $seeded_order->get_id(),
                    'progress_status'    => (int) $progress,
                    'status_payload'     => $body,
                    // Only expose order_received_url when funded/complete or marked paid
                'order_received_url' => ( in_array( (int) $progress, array( 26, 0, 30 ), true ) ) ? $seeded_order->get_checkout_order_received_url() : null,
                    ), 200 );
                }

                // Apply the new status to this order (only mark paid on FUNDED)
                // Do not upshift status away from failed/cancelled; only update meta/notes in that case
                if ( in_array( $seeded_order->get_status(), array( 'failed', 'cancelled' ), true ) && (int) $progress !== 0 && (int) $progress !== 30 ) {
                    $seeded_order->update_meta_data( '_snap_progress_status', (int) $progress );
                    $seeded_order->save();
                } else {
                snap_apply_progress_to_order( $seeded_order, (int) $progress, [ 'application_id' => $app_id, 'invoice_number' => (string) $invoice_number ] );
                }
                // Lock order to this application once signed/funded/complete
                if ( in_array( (int) $progress, array( 26, 0, 30 ), true ) ) {
                    $seeded_order->update_meta_data( '_snap_signed_lock_app_id', (string) $app_id );
                    $seeded_order->save();
                }
                if ( function_exists( 'WC' ) && WC()->cart ) { WC()->cart->empty_cart( false ); }
                snap_clear_wc_session_after_finalize();
                try { snap_orders_log( 'funded_done', array( 'source' => 'rest', 'order_id' => (string) $seeded_order->get_id(), 'application_id' => $app_id, 'progress' => (string) $progress, 'wc_status' => $seeded_order->get_status(), 'method' => $seeded_order->get_payment_method() ) ); } catch ( Throwable $e ) {}
                $resp_arr = array(
                    'success'            => true,
                    'order_id'           => $seeded_order->get_id(),
                    'progress_status'    => (int) $progress,
                'order_received_url' => ( in_array( (int) $progress, array( 26, 0, 30 ), true ) ) ? $seeded_order->get_checkout_order_received_url() : null,
                );
                if ( empty( $resp_arr['order_received_url'] ) ) {
                    try { snap_orders_log( 'funded_no_redirect', array( 'source' => 'rest', 'order_id' => (string) $seeded_order->get_id(), 'application_id' => $app_id, 'progress' => (string) $progress, 'note' => 'Non-funded; no redirect' ) ); } catch ( Throwable $e ) {}
                }
                return new WP_REST_Response( $resp_arr, 200 );
            }
        }

        // Short lock so two finalize calls can't run at the same time
        $lock_key = 'snap_funded_lock_' . md5( $app_id );
        if ( get_transient( $lock_key ) ) {
            // Another finalize is running; try to return the existing order
            $existing = wc_get_orders( array(
                'limit'      => 1,
                'return'     => 'objects',
                'meta_key'   => '_snap_application_id',
                'meta_value' => $app_id,
                'orderby'    => 'date',
                'order'      => 'DESC',
            ) );
            if ( ! empty( $existing ) ) {
                $order = $existing[0];
                $resp_arr = array(
                    'success'            => true,
                    'idempotent'         => true,
                    'order_id'           => $order->get_id(),
                    'progress_status'    => (int) $progress,
                    'status_payload'     => $body,
                    'order_received_url' => ( in_array( (int) $progress, array( 26, 0, 30 ), true ) ) ? $order->get_checkout_order_received_url() : null,
                );
                if ( empty( $resp_arr['order_received_url'] ) ) {
                    try { snap_orders_log( 'funded_no_redirect', array( 'source' => 'rest', 'order_id' => (string) $order->get_id(), 'application_id' => $app_id, 'progress' => (string) $progress, 'note' => 'Non-funded; no redirect' ) ); } catch ( Throwable $e ) {}
                }
                return new WP_REST_Response( $resp_arr, 200 );
            }
        }
        set_transient( $lock_key, 1, 60 );

        // Fallback: find the order by this application id (no new orders are created)
    $existing = wc_get_orders( array(
        'limit'      => 1,
        'return'     => 'objects',
        'meta_key'   => '_snap_application_id',
        'meta_value' => $app_id,
        'orderby'    => 'date',
        'order'      => 'DESC',
    ) );
    if ( ! empty( $existing ) ) {
        $order = $existing[0];
            try { wc_get_logger()->info( sprintf( 'Snap funded start (by app): order#%d app=%s progress=%d', $order->get_id(), $app_id, (int) $progress ), array( 'source' => 'snap' ) ); } catch ( Throwable $e ) {}
        if ( $order->is_paid() || $order->get_transaction_id() ) {
                try { wc_get_logger()->info( sprintf( 'Snap funded done (idempotent): order#%d status=%s method=%s', $order->get_id(), $order->get_status(), $order->get_payment_method() ), array( 'source' => 'snap' ) ); } catch ( Throwable $e ) {}
                return new WP_REST_Response( array(
                    'success'            => true,
                    'idempotent'         => true,
                    'order_id'           => $order->get_id(),
                    'order_received_url' => $order->get_checkout_order_received_url(),
                ), 200 );
            }
            if ( in_array( $order->get_status(), array( 'failed', 'cancelled' ), true ) && (int) $progress !== 0 && (int) $progress !== 30 ) {
                $order->update_meta_data( '_snap_progress_status', (int) $progress );
                $order->save();
            } else {
                snap_apply_progress_to_order( $order, (int) $progress, [ 'application_id' => $app_id, 'invoice_number' => (string) $invoice_number ] );
            }
            // Lock order to this application once signed/funded/complete
            if ( in_array( (int) $progress, array( 26, 0, 30 ), true ) ) {
                $order->update_meta_data( '_snap_signed_lock_app_id', (string) $app_id );
                $order->save();
            }
            if ( function_exists( 'WC' ) && WC()->cart ) { WC()->cart->empty_cart( false ); }
            snap_clear_wc_session_after_finalize();
            try { snap_orders_log( 'funded_done', array( 'source' => 'rest', 'order_id' => (string) $order->get_id(), 'application_id' => $app_id, 'progress' => (string) $progress, 'wc_status' => $order->get_status(), 'method' => $order->get_payment_method() ) ); } catch ( Throwable $e ) {}
            return new WP_REST_Response( array(
                'success'            => true,
                'order_id'           => $order->get_id(),
                'order_received_url' => ( in_array( (int) $progress, array( 26, 0, 30 ), true ) ) ? $order->get_checkout_order_received_url() : null,
                'progress_status'    => (int) $progress,
                'status_payload'     => $body,
            ), 200 );
        }

        // Fallback B: try latest draft order
        $draft_id = snap_find_blocks_draft_order_id( null );
        if ( $draft_id > 0 ) {
            $order = wc_get_order( (int) $draft_id );
            if ( $order ) {
                try { snap_orders_log( 'funded_fallback_draft', array( 'source' => 'rest', 'order_id' => (string) $draft_id, 'application_id' => $app_id ) ); } catch ( Throwable $e ) {}
                // Ensure payment method and meta are set, then apply progress
                $order->set_payment_method( 'snapfinance_refined' );
                $order->set_payment_method_title( 'Snap Finance' );
                if ( ! empty( $invoice_number ) ) { $order->update_meta_data( '_snap_invoice_number', (string) $invoice_number ); }
                $order->update_meta_data( '_snap_application_id', $app_id );
                $order->save();

                snap_apply_progress_to_order( $order, (int) $progress, [ 'application_id' => $app_id, 'invoice_number' => (string) $invoice_number ] );
                if ( function_exists( 'WC' ) && WC()->cart ) { WC()->cart->empty_cart( false ); }
                snap_clear_wc_session_after_finalize();
                try { snap_orders_log( 'funded_done', array( 'source' => 'rest', 'order_id' => (string) $order->get_id(), 'application_id' => $app_id, 'progress' => (string) $progress, 'wc_status' => $order->get_status(), 'method' => $order->get_payment_method() ) ); } catch ( Throwable $e ) {}
                $resp_arr = array(
                    'success'            => true,
                    'order_id'           => $order->get_id(),
                    'progress_status'    => (int) $progress,
                    'status_payload'     => $body,
                    'order_received_url' => ( in_array( (int) $progress, array( 26, 0, 30 ), true ) ) ? $order->get_checkout_order_received_url() : null,
                );
                if ( empty( $resp_arr['order_received_url'] ) ) {
                    try { snap_orders_log( 'funded_no_redirect', array( 'source' => 'rest', 'order_id' => (string) $order->get_id(), 'application_id' => $app_id, 'progress' => (string) $progress, 'note' => 'Non-funded; no redirect' ) ); } catch ( Throwable $e ) {}
                }
                return new WP_REST_Response( $resp_arr, 200 );
            }
        }

        // Fallback C removed to prevent cross-session order reuse; require session/draft/app match

        // If we can't find anything, tell the client to retry/attach
        return new WP_REST_Response( array( 'success' => false, 'error' => 'order_not_seeded' ), 409 );
    }
}

// Status handler implementation
if ( ! function_exists( 'snap_rest_status_cb' ) ) {
    function snap_rest_status_cb( WP_REST_Request $request ) {
        $app_id = sanitize_text_field( $request->get_param( 'application_id' ) );
        if ( empty( $app_id ) ) {
            return new WP_REST_Response( array( 'ok' => false, 'error' => 'missing_params' ), 400 );
        }

        // Prefer server-side session token; allow explicit bearer as fallback for edge cases
        $bearer = '';
        if ( function_exists( 'WC' ) && WC()->session ) {
            $sess = WC()->session->get( 'snap_application' );
            if ( is_array( $sess ) && ! empty( $sess['token'] ) ) {
                $bearer = (string) $sess['token'];
            }
        }
        if ( empty( $bearer ) ) {
            $maybe = sanitize_text_field( (string) ( $request->get_param( 'bearer' ) ?? '' ) );
            if ( $maybe !== '' ) { $bearer = $maybe; }
        }
        if ( empty( $bearer ) ) {
            return new WP_REST_Response( array( 'ok' => false, 'error' => 'no_server_token' ), 403 );
        }

        $default_base = 'https://sandbox-platform.snap-engineering.co.uk';
        $base         = apply_filters( 'snap_finance_status_base_url', $default_base );
        $base         = untrailingslashit( $base );
        $status_url   = $base . '/v1/applications/status?applicationId=' . rawurlencode( $app_id );
        $resp         = wp_remote_get( $status_url, array(
            'headers' => array( 'Authorization' => 'Bearer ' . $bearer ),
            'timeout' => 20,
        ) );
        if ( is_wp_error( $resp ) ) {
            return new WP_REST_Response( array( 'ok' => false, 'error' => 'http_error', 'details' => $resp->get_error_message() ), 502 );
        }
        $code = (int) wp_remote_retrieve_response_code( $resp );
        $body = json_decode( wp_remote_retrieve_body( $resp ), true );
        if ( $code !== 200 || ! is_array( $body ) || ! isset( $body['progressStatus'] ) ) {
            return new WP_REST_Response( array( 'ok' => false, 'error' => 'bad_response', 'http' => $code, 'body' => $body ), 502 );
        }
        
        // Try to find associated order for logging context
        $order_id_for_log = '';
        try {
            // Check session first
            if ( function_exists( 'WC' ) && WC()->session ) {
                $session_order_id = (int) ( WC()->session->get( 'snap_seeded_order_id' ) ?: 0 );
                if ( $session_order_id > 0 ) {
                    $order_id_for_log = (string) $session_order_id;
                }
            }
            // Fallback: lookup by application_id meta
            if ( ! $order_id_for_log && $app_id !== '' ) {
                $found = wc_get_orders( array(
                    'limit'      => 1,
                    'return'     => 'ids',
                    'meta_key'   => '_snap_application_id',
                    'meta_value' => $app_id,
                    'orderby'    => 'date',
                    'order'      => 'DESC',
                ) );
                if ( ! empty( $found ) ) {
                    $order_id_for_log = (string) $found[0];
                }
            }
        } catch ( Throwable $e ) {}
        
        try {
            // Record optional trigger method from querystring for analytics (e.g., callback:onApproved, url:approved)
            $method = (string) ( $request->get_param( 'method' ) ?? '' );
            snap_orders_log( 'status_polled', array(
                'source'        => 'api',
                'order_id'      => $order_id_for_log,
                'application_id'=> $app_id,
                'progress'      => (string) (int) $body['progressStatus'],
                'method'        => $method
            ) );
        } catch ( Throwable $e ) {}
        
        return new WP_REST_Response( array( 'ok' => true, 'application_id' => $app_id, 'progress_status' => (int) $body['progressStatus'], 'payload' => $body ), 200 );
    }
}

// Journey handler: record URL stages per order with timestamps; idempotent per stage
if ( ! function_exists( 'snap_rest_journey_cb' ) ) {
    function snap_rest_journey_cb( WP_REST_Request $request ) {
        $stage   = sanitize_text_field( (string) ( $request->get_param( 'stage' ) ?? '' ) );
        $app_id  = sanitize_text_field( (string) ( $request->get_param( 'application_id' ) ?? '' ) );
        if ( $stage === '' ) {
            return new WP_REST_Response( array( 'ok' => false, 'error' => 'missing_stage' ), 400 );
        }

        // Resolve order via session, cookie, or app meta
        $order = null;
        $order_id = 0;
        if ( function_exists( 'WC' ) && WC()->session ) {
            $order_id = (int) ( WC()->session->get( 'snap_seeded_order_id' ) ?: 0 );
        }
        if ( ! $order_id ) {
            $cookie_id = snap_get_signed_cookie( 'snap_seeded_order_id' );
            if ( $cookie_id ) { $order_id = (int) $cookie_id; }
        }
        if ( $order_id > 0 ) { $order = wc_get_order( $order_id ); }
        if ( ! $order && $app_id !== '' ) {
            $found = wc_get_orders( array(
                'limit'      => 1,
                'return'     => 'objects',
                'meta_key'   => '_snap_application_id',
                'meta_value' => $app_id,
                'orderby'    => 'date',
                'order'      => 'DESC',
            ) );
            if ( ! empty( $found ) ) { $order = $found[0]; }
        }
        if ( ! $order ) {
            return new WP_REST_Response( array( 'ok' => false, 'error' => 'order_not_found' ), 404 );
        }

        // Keep a CSV-friendly footprint in order meta (binary flags per known stage)
        $known = array(
            'otp/verify',
            'about-you',
            'address-details',
            'income',
            'build-your-loans/approved',
            'build-your-loans/bnpl-deposit',
            'pay-and-sign/direct-debit',
            'pay-and-sign/deposit-payment',
            'pay-and-sign/deposit-payment/payment-success',
            'pay-and-sign/bnpl-signing',
            'you-have-done-it',
        );
        $slug = $stage;
        $meta_key_stage = '_snap_journey_' . sanitize_key( $slug );
        $timestamp_key  = $meta_key_stage . '_ts';

        if ( ! $order->get_meta( $meta_key_stage ) ) {
            $order->update_meta_data( $meta_key_stage, 1 );
            $order->update_meta_data( $timestamp_key, current_time( 'mysql', true ) );
            // Also keep a compact log line for CSV export later
            $arr = (array) maybe_unserialize( $order->get_meta( '_snap_journey_rows' ) );
            $arr[] = array( 'stage' => $slug, 'ts' => current_time( 'mysql', true ) );
            $order->update_meta_data( '_snap_journey_rows', $arr );
            $order->save();
        }

        // Friendly label in order notes once per stage
        $map = array(
            'otp/verify'                            => 'Reached Snap otp/verify',
            'about-you'                             => 'Reached Snap about-you',
            'address-details'                       => 'Reached Snap address-details',
            'income'                                => 'Reached Snap income',
            'build-your-loans/approved'             => 'Reached Snap build-your-loans/approved',
            'build-your-loans/bnpl-deposit'         => 'Reached Snap build-your-loans/bnpl-deposit',
            'pay-and-sign/direct-debit'             => 'Reached Snap pay-and-sign/direct-debit',
            'pay-and-sign/deposit-payment'          => 'Reached Snap pay-and-sign/deposit-payment',
            'pay-and-sign/deposit-payment/payment-success' => 'Reached Snap pay-and-sign/deposit-payment/payment-success',
            'pay-and-sign/bnpl-signing'             => 'Reached Snap pay-and-sign/bnpl-signing',
            'you-have-done-it'                      => 'Reached Snap you-have-done-it',
        );
        $label = isset( $map[ $slug ] ) ? $map[ $slug ] : ( 'Reached Snap ' . $slug );
        if ( ! $order->get_meta( $meta_key_stage . '_noted' ) ) {
            $order->add_order_note( 'Snap: ' . $label );
            $order->update_meta_data( $meta_key_stage . '_noted', 1 );
        $order->save();
        }

        try { snap_orders_log( 'journey', array( 'source' => 'url', 'order_id' => (string) $order->get_id(), 'stage' => $slug, 'application_id' => $app_id ) ); } catch ( Throwable $e ) {}

        // Provide a CSV-ready binary vector across known stages
        $vector = array();
        foreach ( $known as $k ) {
            $vector[ $k ] = $order->get_meta( '_snap_journey_' . sanitize_key( $k ) ) ? 1 : 0;
        }

        return new WP_REST_Response( array(
            'ok' => true,
            'order_id' => $order->get_id(),
            'stage' => $slug,
            'label' => $label,
            'binary' => $vector,
        ), 200 );
    }
}

/** ------------------------------------------------------------------------
 * Attach Snap Finance data during order creation (fallback)
 * If /attach endpoint didn't find an order, this hook ensures data is saved
 * Applies to both Classic and Blocks checkout
 * --------------------------------------------------------------------- */
add_action( 'woocommerce_checkout_create_order', function( $order, $data ) {
    // Only process Snap Finance orders
    if ( $order->get_payment_method() !== 'snapfinance_refined' ) {
        return;
    }
    
    // Check if order already has application_id (from successful /attach)
    $existing_app_id = $order->get_meta( '_snap_application_id' );
    if ( $existing_app_id ) {
        // /attach already succeeded, nothing to do
        try {
            snap_orders_log( 'order_creation_hook_skipped', array(
                'source' => 'hook',
                'order_id' => (string) $order->get_id(),
                'application_id' => $existing_app_id,
                'note' => 'data_already_attached_via_rest'
            ) );
        } catch ( Throwable $e ) {}
        return;
    }
    
    // Fallback: pull from session if /attach failed
    if ( ! function_exists( 'WC' ) || ! WC()->session ) {
        return;
    }
    
    $app_id = WC()->session->get( 'snap_application_id_pending' );
    $invoice = WC()->session->get( 'snap_invoice_number_pending' );
    
    if ( $app_id ) {
        // Attach data from session
        $order->update_meta_data( '_snap_application_id', $app_id );
        if ( $invoice ) {
            $order->update_meta_data( '_snap_invoice_number', $invoice );
        }
        $order->add_order_note( sprintf( 
            'Snap Finance application attached via session fallback. App ID: %s, Snap Invoice: %s', 
            $app_id, 
            $invoice 
        ) );
        
        try {
            snap_orders_log( 'attach_via_hook_fallback', array(
                'source' => 'hook',
                'order_id' => (string) $order->get_id(),
                'application_id' => $app_id,
                'invoice_number' => $invoice,
                'note' => 'session_fallback_succeeded'
            ) );
        } catch ( Throwable $e ) {}
        
        // Clear session data after successful attachment
        WC()->session->__unset( 'snap_application_id_pending' );
        WC()->session->__unset( 'snap_invoice_number_pending' );
    }
}, 10, 2 );

/** ------------------------------------------------------------------------
 * Settings link in Plugins screen
 * --------------------------------------------------------------------- */
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
    $url = admin_url( 'admin.php?page=wc-settings&tab=checkout&section=snapfinance_refined' );
    array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'snap-finance-gateway' ) . '</a>' );
    return $links;
});

