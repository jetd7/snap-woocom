<?php
/**
 * WC_Snap_Finance_Gateway Class (final tidy-ups)
 *
 * @package Snap Finance Gateway
 * @since 2.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}

if (!class_exists('WC_Snap_Finance_Gateway')) {
class WC_Snap_Finance_Gateway extends WC_Payment_Gateway {

    // Shared business limits (for both Classic and Blocks)
    const MIN_AMOUNT = 250.0;    // £250
    const MAX_AMOUNT = 10000.0;  // £10,000

    // PHP 8.2+ explicit properties
    public $sandbox_merchant_id;
    public $sandbox_client_id;
    public $production_merchant_id;
    public $production_client_id;
    public $button_theme;
    public $testmode;
    public $merchant_id;
    public $client_id;

    public function __construct() {
        $this->id                 = 'snapfinance_refined';
        
        // Fix icon URL to handle spaces in folder names properly
        $plugin_dir = dirname( __FILE__ );
        $this->icon = plugins_url('assets/images/snap-logo.svg', dirname(__FILE__)) . '?v=' . ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' );
        
        // Debug icon path
        error_log('SNAP GATEWAY: Icon path set to: ' . $this->icon);
        
        $this->has_fields         = true;
        // Method title and description will be set with translations on 'init'
        $this->supports           = array( 'products' );

        // Initialize form fields immediately (needed for admin settings page)
        $this->init_form_fields();
        
        // Load settings immediately so WooCommerce can check enabled status
        $this->init_settings();
        
        // Load all options immediately
        $this->sandbox_merchant_id    = $this->get_option( 'sandbox_merchant_id', '' );
        $this->sandbox_client_id      = $this->get_option( 'sandbox_client_id', '' );
        $this->production_merchant_id = $this->get_option( 'production_merchant_id', '' );
        $this->production_client_id   = $this->get_option( 'production_client_id', '' );
        $this->button_theme           = $this->get_option( 'button_theme', 'DARK' );
        $this->testmode               = 'yes' === $this->get_option( 'testmode', 'yes' );
        $this->enabled                = $this->get_option( 'enabled', 'no' );
        
        // Debug logging for gateway status
        error_log('SNAP GATEWAY: Constructor - enabled=' . $this->enabled . ' testmode=' . ($this->testmode ? 'yes' : 'no'));

        // Set merchant and client IDs based on test mode
        $this->merchant_id = $this->testmode ? $this->sandbox_merchant_id : $this->production_merchant_id;
        $this->client_id   = $this->testmode ? $this->sandbox_client_id   : $this->production_client_id;
        
        // Update title and description
        $this->title = $this->get_option( 'title', 'Snap Finance' );
        $this->description = $this->get_option( 'description', 'Apply for finance through Snap Finance UK.' );
        
        // Delay translated strings until 'init' to avoid early translation triggers
        add_action( 'init', array( $this, 'set_translated_strings' ), 20 );
        
        // Debug gateway status on admin pages
        if (is_admin()) {
            add_action('admin_init', array($this, 'debug_gateway_status'));
            add_action('admin_footer', array($this, 'debug_admin_icon'));
            add_action('admin_head', array($this, 'add_admin_styles'));
        }

        // Add icon display hooks
        add_filter('woocommerce_gateway_icon', array($this, 'filter_gateway_icon'), 10, 2);

        // Snap API base URL: pick sandbox/production dynamically; allow override via filter
        add_filter('snap_finance_status_base_url', array($this, 'filter_status_base_url'));

        // Hooks
        add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
        add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_checkout_assets' ), 20 );
        add_action( 'wp_head', array( $this, 'add_content_protection_whitelist' ) );
        add_action( 'wp_head', array( $this, 'add_snap_styles' ) );

		// Removed duplicate save handler; wc_ajax version in plugin handles this securely
        add_action( 'wp_ajax_snap_set_chosen', array( $this, 'ajax_set_chosen_method' ) );
        add_action( 'wp_ajax_nopriv_snap_set_chosen', array( $this, 'ajax_set_chosen_method' ) );
		// Removed insecure finalize AJAX endpoint; rely on secured REST route instead

        // [REMOVED] Hiding gateway by total; see the new method below which is now a no-op
        add_filter( 'woocommerce_available_payment_gateways', array( $this, 'restrict_payment_methods_by_cart_total' ) );

        // Ensure the container renders even if some theme overrides descriptions
        add_filter( 'woocommerce_gateway_description', function( $description, $gateway_id ) {
            if ( $gateway_id === 'snapfinance_refined' ) {
                ob_start();
                $this->payment_fields();
                return $description . ob_get_clean();
            }
            return $description;
        }, 10, 2 );
    }

    /**
     * Decide Snap API base URL based on test mode; allows external override via filter
     *
     * @param string $default_base
     * @return string
     */
    public function filter_status_base_url( $default_base ) {
        // Prefer explicit mapping; fall back to provided default
        $sandbox = 'https://sandbox-platform.snap-engineering.co.uk';
        $live    = 'https://prod-api.snapfinance.co.uk';
        // Choose by test mode; if unknown, return default
        if ( isset( $this->testmode ) ) {
            return $this->testmode ? $sandbox : $live;
        }
        return $default_base ?: $sandbox;
    }

    /**
     * Set translated strings after text domain is loaded (for translations)
     */
    public function set_translated_strings() {
        $this->method_title = __( 'Snap Finance', 'snap-finance-gateway' );
        $this->method_description = __( 'Allow customers to apply for finance through Snap Finance UK.', 'snap-finance-gateway' );
        
        // Update title and description with translations
        $this->title = $this->get_option( 'title', __( 'Snap Finance', 'snap-finance-gateway' ) );
        $this->description = $this->get_option( 'description', __( 'Flexible payments with Snap Finance. Check eligibility, get an instant decision.', 'snap-finance-gateway' ) );
    }

    public function init_form_fields() {
        $this->form_fields = array(
            'enabled' => array(
                'title'       => __( 'Enable/Disable', 'snap-finance-gateway' ),
                'type'        => 'checkbox',
                'label'       => __( 'Enable Snap Finance gateway', 'snap-finance-gateway' ),
                'default'     => 'no',
                'desc_tip'    => false,
            ),
            'testmode' => array(
                'title'       => 'Test Mode',
                'type'        => 'checkbox',
                'label'       => 'Enable Test Mode (Sandbox)',
                'default'     => 'yes',
            ),
            'title' => array(
                'title'       => 'Title',
                'type'        => 'text',
                'description' => 'Controls the title shown during checkout.',
                'default'     => 'Snap Finance',
                'desc_tip'    => true,
            ),
            'description' => array(
                'title'       => 'Description',
                'type'        => 'textarea',
                'description' => 'Controls the description shown during checkout.',
                'default'     => 'Flexible payments with Snap Finance. Check eligibility, get an instant decision.',
            ),
            'sandbox_merchant_id' => array(
                'title' => 'Sandbox Merchant ID',
                'type'  => 'text',
                'default' => '',
            ),
            'sandbox_client_id' => array(
                'title' => 'Sandbox Client ID',
                'type'  => 'text',
                'default' => '',
            ),
            'production_merchant_id' => array(
                'title' => 'Production Merchant ID',
                'type'  => 'text',
                'default' => '',
            ),
            'production_client_id' => array(
                'title' => 'Production Client ID',
                'type'  => 'text',
                'default' => '',
            ),
            'button_theme' => array(
                'title'   => 'Button Theme',
                'type'    => 'select',
                'options' => array( 'DARK' => 'Dark', 'LIGHT' => 'Light' ),
                'default' => 'DARK',
            ),
            // Min/max amounts removed from admin - using Snap's fixed limits
            // Minimum: £250, Maximum: £10,000 (hardcoded for business compliance)
        );
    }

    public function payment_fields() {
        echo '<div id="snap-uk-checkout" style="min-height: 50px; min-width: 200px; margin: 15px 0; border: none; outline: none; box-shadow: none;"></div>';
        echo '<input type="hidden" name="snap_finance_selected" value="1" />';
    }

    /**
     * Enqueue Snap SDK + shared renderer + the correct driver (Blocks or Classic).
     * - SDK loads in <head>
     * - snap_params localized to 'snap-render'
     * - Exactly one driver (blocks OR classic)
     * - Does NOT bail early on Blocks if available gateways are empty
     */
    public function enqueue_checkout_assets() {

        // Debug logging to pinpoint early returns
        error_log('SNAP DEBUG: enqueue_checkout_assets() running at ' . date('Y-m-d H:i:s'));

        // 1) Frontend + checkout-ish pages only.
        if ( is_admin() ) { 
            error_log('SNAP ENQUEUE: returning early because is_admin()');
            return; 
        }
        if ( ! function_exists( 'is_checkout' ) || ( ! is_checkout() && empty( $_GET['pay_for_order'] ) ) ) { 
            error_log('SNAP ENQUEUE: returning early because not checkout page');
            return; 
        }

        // 2) Detect Blocks vs Classic (do this FIRST; don't gate on gateways yet).
        $is_blocks = false;
        if ( function_exists( 'has_block' ) && has_block( 'woocommerce/checkout' ) ) {
            $is_blocks = true;
        } elseif ( function_exists( 'wc_current_theme_is_fse_theme' ) && wc_current_theme_is_fse_theme() ) {
            $is_blocks = true;
        }

        error_log('SNAP ENQUEUE: is_blocks=' . ($is_blocks ? 'yes' : 'no') . ' enabled=' . ($this->enabled ?? '(unset)') . ' testmode=' . ($this->testmode ? 'yes' : 'no'));

        // 3) Gateway must be enabled. (Blocks: do NOT require "available gateways" yet.)
        if ( 'yes' !== $this->enabled ) { 
            error_log('SNAP ENQUEUE: returning early because enabled !== yes'); 
            return; 
        }

        // Classic: soft-guard if available gateways are already present AND Snap is truly unavailable.
        if ( ! $is_blocks && function_exists( 'WC' ) && WC()->payment_gateways() ) {
            $avail = WC()->payment_gateways()->get_available_payment_gateways();
            if ( is_array( $avail ) && ! isset( $avail[ $this->id ] ) ) {
                error_log('SNAP ENQUEUE: returning early because not in available gateways (classic)');
                return;
            }
        }

        error_log('SNAP ENQUEUE: Proceeding to enqueue scripts...');

        // Optional: if you have is_available() customized to include min/max etc., this can also block.
        if ( method_exists( $this, 'is_available' ) && ! $this->is_available() ) {
            error_log('SNAP ENQUEUE: returning early because is_available() is false (e.g., min/max/cart condition)');
            return;
        }

        // 4) Enqueue SDK in HEAD (Snap requirement).
        $sdk_url = $this->testmode
            ? 'https://sandbox-sdk.snapfinance.co.uk/v1/snapuk.min.js'
            : 'https://sdk.snapfinance.co.uk/v1/snapuk.min.js';

        error_log('SNAP ENQUEUE: Enqueuing SDK from: ' . $sdk_url);
        
        // false => HEAD
        wp_enqueue_script( 'snap-sdk', $sdk_url, [], null, false );
        // Nudge tag creation in some stacks (harmless elsewhere)
        if ( function_exists( 'wp_script_add_data' ) ) {
            wp_script_add_data( 'snap-sdk', 'data', '' );
        }

        // 5) Build params for JS.
        $products = [];
        if ( function_exists( 'WC' ) && WC()->cart ) {
            foreach ( WC()->cart->get_cart() as $item ) {
                $p = $item['data'] ?? null;
                $products[] = [
                    'description' => $p ? $p->get_name() : '',
                    'price'       => $p ? wc_get_price_including_tax( $p ) : 0,
                    'quantity'    => isset( $item['quantity'] ) ? (int) $item['quantity'] : 1,
                ];
            }
        }

        // Generate unique invoice number
        $invoiceNumber = 'WC' . time() . rand(100, 999);
        
        // Use tomorrow's date to avoid "already pending" issues
        $tomorrow = new DateTime();
        $tomorrow->add(new DateInterval('P1D'));
        $deliveryDate = $tomorrow->format('Y-m-d');

        // Build transaction data for Snap SDK
        $transaction = [
            'invoiceNumber' => $invoiceNumber,
            'deliveryDate' => $deliveryDate,
            'shippingCost' => 0, // Add shipping cost logic if needed
            'products' => array_map(function($product) {
                return [
                    'productId' => 'SKU-' . uniqid(),
                    'quantity' => $product['quantity'],
                    'description' => $product['description'],
                    'price' => $product['price']
                ];
            }, $products),
            'customer' => [
                'firstName' => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_first_name') : '',
                'lastName'  => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_last_name') : '',
                'email'     => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_email') : '',
                'mobileNumber' => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_phone') : '',
                'streetAddress' => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_address_1') : '',
                'unit' => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_address_2') : '',
                'city' => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_city') : '',
                'postcode' => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_postcode') : ''
            ]
        ];

        $params = [
            'ajax_url'     => admin_url( 'admin-ajax.php' ),
            'nonce'        => wp_create_nonce( 'snap_finance_nonce' ),
            'rest_nonce'   => wp_create_nonce( 'wp_rest' ),
            'rest_url'     => esc_url_raw( rest_url( 'snap/v1/funded' ) ),
            'client_id'    => $this->client_id,
            'merchant_id'  => $this->merchant_id,
            'button_theme' => $this->button_theme ?: 'DARK',
            'cart_total'   => ( function_exists( 'WC' ) && WC()->cart ) ? (float) WC()->cart->total : 0.0,
            'products'     => $products,
            'transaction'  => $transaction, // Add transaction data for Blocks
            'min_amount'   => self::MIN_AMOUNT,
            'max_amount'   => self::MAX_AMOUNT,
            'is_blocks'    => $is_blocks,
            'icon'         => plugins_url('assets/images/snap-logo.svg', dirname(__FILE__)) . '?v=' . ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' ),
            // Expose gateway title/description so JS can use Woo settings in both Classic and Blocks
            'gateway_title'       => $this->title,
            'gateway_description' => $this->description,
            // Billing fields for customer data
            'billing_first_name' => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_first_name') : '',
            'billing_last_name'  => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_last_name') : '',
            'billing_email'      => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_email') : '',
            'billing_phone'      => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_phone') : '',
            'billing_address_1'  => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_address_1') : '',
            'billing_address_2'  => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_address_2') : '',
            'billing_city'       => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_city') : '',
            'billing_postcode'   => ( function_exists( 'WC' ) && WC()->checkout ) ? WC()->checkout->get_value('billing_postcode') : '',
        ];

        error_log('SNAP ENQUEUE: Built params with client_id=' . $this->client_id . ' merchant_id=' . $this->merchant_id);

        // 6) Shared modules (transaction data and application handling).
        // We are in /includes/, so step up to /assets/js/.
        $base_url = trailingslashit( plugin_dir_url( __FILE__ ) . '../' );

        // Payment method detector (load first - used by other modules)
        wp_register_script(
            'snap-payment-detector',
            $base_url . 'assets/js/payment-method-detector.js',
            [], // no deps
            ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' ),
            true
        );
        wp_enqueue_script( 'snap-payment-detector' );

        // Transaction data module
        wp_register_script(
            'snap-transaction',
            $base_url . 'assets/js/transaction-data.js',
            [], // no deps
            ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' ),
            true
        );
        wp_enqueue_script( 'snap-transaction' );

        // Form monitoring utility (shared between Classic and Blocks)
        wp_register_script(
            'snap-form-monitor',
            $base_url . 'assets/js/utils/form-monitor-util.js',
            ['snap-payment-detector'], // depends on payment detector
            ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' ),
            true
        );
        wp_enqueue_script( 'snap-form-monitor' );

        // Application handler module
        wp_register_script(
            'snap-application',
            $base_url . 'assets/js/snap-application.js',
            ['snap-form-monitor'], // depends on form monitor
            ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' ),
            true
        );
        wp_enqueue_script( 'snap-application' );

        // Shared renderer (depends on transaction and application modules)
        error_log('SNAP ENQUEUE: Enqueuing snap-render.js from: ' . $base_url . 'assets/js/snap-render.js');

        wp_register_script(
            'snap-render',
            $base_url . 'assets/js/snap-render.js',
            [ 'snap-transaction', 'snap-application', 'snap-form-monitor' ], // depends on modules
            ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' ),
            true
        );
        wp_localize_script( 'snap-render', 'snap_params', $params );
        wp_enqueue_script( 'snap-render' );

        // Storage helper (no deps) - load early
        wp_enqueue_script(
            'snap-storage',
            $base_url . 'assets/js/utils/storage.js',
            [],
            ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' ),
            true
        );

        // Diagnostic: confirm snap_params exists when this runs.
        wp_add_inline_script(
            'snap-render',
            'console.log("SNAP DEBUG: snap_params localized?", typeof window.snap_params);',
            'after'
        );
        
        // Debug billing fields
        wp_add_inline_script(
            'snap-render',
            'console.log("SNAP DEBUG: Billing fields:", { firstName: window.snap_params?.billing_first_name, lastName: window.snap_params?.billing_last_name, email: window.snap_params?.billing_email, phone: window.snap_params?.billing_phone, postcode: window.snap_params?.billing_postcode });',
            'after'
        );

        // 7) Enqueue ONE driver: Blocks OR Classic.
        if ( $is_blocks ) {
            error_log('SNAP ENQUEUE: Enqueuing blocks.js from: ' . $base_url . 'assets/js/blocks.js');
            
            wp_enqueue_script(
                'snap-blocks',
                $base_url . 'assets/js/blocks.js',
                [ 'wp-element', 'wc-blocks-registry', 'wc-settings', 'snap-render', 'snap-payment-detector' ],
                ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' ),
                true
            );
            wp_add_inline_script( 'snap-blocks', 'console.log("[Snap] blocks.js loaded");', 'before' );
            wp_add_inline_script(
                'snap-blocks',
                'console.log("[Snap] sdk?", typeof window.snapuk, "| params?", typeof window.snap_params, "| renderer?", typeof window.SnapRender);',
                'after'
            );
        } else {
            error_log('SNAP ENQUEUE: Enqueuing checkout.js from: ' . $base_url . 'assets/js/checkout.js');
            
            wp_enqueue_script(
                'snap-checkout',
                $base_url . 'assets/js/checkout.js',
                [ 'jquery', 'snap-render', 'snap-payment-detector' ],
                ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' ),
                true
            );
            wp_add_inline_script( 'snap-checkout', 'console.log("[Snap] checkout.js loaded");', 'before' );
            wp_add_inline_script(
                'snap-checkout',
                'console.log("[Snap] sdk?", typeof window.snapuk, "| params?", typeof window.snap_params, "| renderer?", typeof window.SnapRender);',
                'after'
            );
        }
        
        error_log('SNAP ENQUEUE: Script enqueuing completed successfully');
    }

    public function is_available() {
        $available = parent::is_available();
        if ( ! $available ) {
            return false;
        }
        // Enforce min/max limits at the gateway level (Classic checkout visibility)
        if ( function_exists( 'WC' ) && WC()->cart ) {
            $total = (float) WC()->cart->total;
            if ( $total < self::MIN_AMOUNT || $total > self::MAX_AMOUNT ) {
                return false;
            }
        }
        return true;
    }

    /**
     * Override process_admin_options to add debug logging
     */
    public function process_admin_options() {
        error_log('SNAP DEBUG: Starting process_admin_options for ' . $this->id);
        
        // Log the POST data for debugging
        if (isset($_POST['woocommerce_' . $this->id . '_enabled'])) {
            error_log('SNAP DEBUG: Enabled checkbox value from POST: ' . $_POST['woocommerce_' . $this->id . '_enabled']);
        } else {
            error_log('SNAP DEBUG: No enabled checkbox found in POST data');
        }
        
        $saved = parent::process_admin_options();
        error_log('SNAP DEBUG: Settings save result: ' . ($saved ? 'success' : 'failed'));
        
        // Log the current enabled status after save
        $current_enabled = $this->get_option('enabled', 'no');
        error_log('SNAP DEBUG: Current enabled status after save: ' . $current_enabled);
        
        return $saved;
    }

    /**
     * Debug method to check current gateway status
     */
    public function debug_gateway_status() {
        error_log('SNAP DEBUG: Gateway Status Check');
        error_log('SNAP DEBUG: - Gateway ID: ' . $this->id);
        error_log('SNAP DEBUG: - Enabled: ' . $this->enabled);
        error_log('SNAP DEBUG: - Test Mode: ' . ($this->testmode ? 'yes' : 'no'));
        error_log('SNAP DEBUG: - Merchant ID: ' . $this->merchant_id);
        error_log('SNAP DEBUG: - Client ID: ' . $this->client_id);
        error_log('SNAP DEBUG: - Icon: ' . $this->icon);
        
        // Check if settings exist in database
        $settings = get_option('woocommerce_' . $this->id . '_settings', array());
        error_log('SNAP DEBUG: - Database settings: ' . print_r($settings, true));
    }

    /**
     * Debug method to check admin icon display
     */
    public function debug_admin_icon() {
        if (isset($_GET['page']) && $_GET['page'] === 'wc-settings' && isset($_GET['tab']) && $_GET['tab'] === 'checkout') {
            echo '<script>
                console.log("SNAP DEBUG: Admin settings page detected");
                console.log("SNAP DEBUG: Gateway icon should be: ' . $this->icon . '");
                console.log("SNAP DEBUG: Check if icon exists at: ' . $this->icon . '");
            </script>';
        }
    }

    /**
     * Filter gateway icon to ensure proper display
     */
    public function filter_gateway_icon($icon_html, $gateway_id) {
        if ($gateway_id === $this->id) {
            $icon_url = esc_url($this->icon);
            error_log('Snap Finance Admin Icon URL: ' . $icon_url);  // Debug to confirm URL
            return '<img src="' . $icon_url . '" alt="' . esc_attr($this->get_title()) . '" style="max-height: 24px; width: auto;" />';
        }
        return $icon_html;
    }

    /**
     * Add admin-specific styles for payment method icons
     */
    public function add_admin_styles() {
        if (isset($_GET['page']) && $_GET['page'] === 'wc-settings' && isset($_GET['tab']) && $_GET['tab'] === 'checkout') {
            ?>
            <style type="text/css">
            /* Ensure Snap Finance icon displays in admin settings */
            .woocommerce-payment-method__icon img[src*="snap-logo.svg"] {
                max-height: 24px !important;
                width: auto !important;
                display: block !important;
                margin: 0 !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            /* Alternative selectors for admin icon display */
            .payment-methods--logos[src*="snap-logo.svg"] {
                max-height: 24px !important;
                width: auto !important;
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            /* Force Snap Finance icon display */
            .woocommerce-payment-method__icon[data-gateway="snapfinance_refined"] img,
            .woocommerce-payment-method__icon[data-gateway="snapfinance_refined"] {
                max-height: 24px !important;
                width: auto !important;
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            </style>
            <?php
        }
    }

    protected function detect_blocks_checkout() {
        if ( function_exists( 'wc_blocks_loaded' ) && wc_blocks_loaded() ) {
            return true;
        }
        if ( function_exists( 'has_block' ) && has_block( 'woocommerce/checkout' ) ) {
            return true;
        }
        if ( function_exists( 'is_checkout' ) && is_checkout() && defined( 'WC_BLOCKS_VERSION' ) ) {
            return true;
        }
        return false;
    }

    public function add_content_protection_whitelist() {
        if ( is_checkout() ) {
            echo '<style>#snap-uk-checkout, #snap-uk-checkout * { user-select: text !important; -webkit-user-select: text !important; pointer-events:auto !important; }</style>';
        }
    }



    public function process_payment( $order_id ) {
        $order = wc_get_order( $order_id );
        if ( ! $order ) {
            wc_add_notice( __( 'Invalid order.', 'snap-finance-gateway' ), 'error' );
            return array( 'result' => 'failure' );
        }

        // Pull app details from session
        $app_id = function_exists('WC') && WC()->session ? WC()->session->get( 'snap_application_id' ) : '';
        $token  = function_exists('WC') && WC()->session ? WC()->session->get( 'snap_token' ) : '';
        $app    = function_exists('WC') && WC()->session ? WC()->session->get( 'snap_application' ) : null; // may contain progressStatus

        // If we know of a DENIED state, block checkout
        if ( is_array( $app ) && isset( $app['status'] ) && (int) $app['status'] === 14 ) {
            wc_add_notice( __( 'Your Snap Finance application was declined. Please choose another payment method or try eligibility again.', 'snap-finance-gateway' ), 'error' );
            return array( 'result' => 'failure' );
        }

        // If we have credentials, verify status server-side to prevent order placement when not funded
        if ( ! empty( $app_id ) && ! empty( $token ) ) {
            $default_base = 'https://sandbox-platform.snap-engineering.co.uk';
            $base         = apply_filters( 'snap_finance_status_base_url', $default_base );
            $base         = untrailingslashit( $base );
            $status_url   = $base . '/v1/applications/status?applicationId=' . rawurlencode( $app_id );
            $resp         = wp_remote_get( $status_url, array( 'headers' => array( 'Authorization' => 'Bearer ' . $token ), 'timeout' => 15 ) );
            if ( ! is_wp_error( $resp ) ) {
                $code = (int) wp_remote_retrieve_response_code( $resp );
                $body = json_decode( wp_remote_retrieve_body( $resp ), true );
                if ( $code === 200 && is_array( $body ) && isset( $body['progressStatus'] ) ) {
                    $ps = (int) $body['progressStatus'];
                    // Deny order placement unless FUNDED/COMPLETE; DENIED gets explicit message
                    if ( $ps === 14 ) {
                        wc_add_notice( __( 'Your Snap Finance application was declined. Please choose another payment method or try eligibility again.', 'snap-finance-gateway' ), 'error' );
                        return array( 'result' => 'failure' );
                    }
                    if ( ! in_array( $ps, array( 0, 30 ), true ) ) {
                        wc_add_notice( __( 'Please complete your Snap Finance application in the popup before placing the order.', 'snap-finance-gateway' ), 'error' );
                        return array( 'result' => 'failure' );
                    }
                }
            }
        }

        // Fallback safety: block placement if we have no funded signal
        wc_add_notice( __( 'Please complete your Snap Finance application in the popup before placing the order.', 'snap-finance-gateway' ), 'error' );
        return array( 'result' => 'failure' );
    }

    // ajax_mark_funded removed; use REST /snap/v1/funded instead

    // handle_save_snap_application removed (duplicate of wc_ajax variant)

    public function ajax_set_chosen_method() {
        if ( function_exists( 'WC' ) ) {
            WC()->session->set( 'chosen_payment_method', 'snapfinance_refined' );
        }
        wp_send_json_success();
    }

    /**
     * No-op: Hiding occurs via is_available()/Blocks is_active() using shared limits.
     */
    public function restrict_payment_methods_by_cart_total( $available_gateways ) { // [MODIFIED]
        return $available_gateways; // keep visible; frontend displays min/max notice
    }

    /**
     * Add custom CSS to remove unwanted styling from Snap button container
     */
    public function add_snap_styles() {
        if ( ! function_exists( 'is_checkout' ) || ! is_checkout() ) {
            return;
        }
        ?>
        <style type="text/css">
        #snap-uk-checkout {
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            background: transparent !important;
            min-height: 70px !important;
            min-width: 300px !important;
            height: 70px !important;
            width: 300px !important;
            transition: opacity 0.2s ease-in-out !important;
            display: block !important;
            position: relative !important;
        }
        
        /* Force override inline styles */
        #snap-uk-checkout[style*="min-height: 50px"] {
            min-height: 70px !important;
            height: 70px !important;
        }
        
        #snap-uk-checkout[style*="min-width: 200px"] {
            min-width: 300px !important;
            width: 300px !important;
        }
        #snap-uk-checkout * {
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
        }
        .snapuk-btn {
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
        }
        /* Fix button flickering with smooth transitions */
        .snap-container {
            transition: opacity 0.2s ease-in-out;
            opacity: 1;
        }
        .snap-container.loading {
            opacity: 0;
        }
        /* Ensure Snap Finance icon displays properly in Blocks checkout */
        .wc-block-components-payment-method-icon img[src*="snap-logo.svg"] {
            max-height: 24px !important;
            width: auto !important;
            display: block !important;
        }
        /* Ensure Snap Finance icon displays in admin settings */
        .woocommerce-payment-method__icon img[src*="snap-logo.svg"] {
            max-height: 24px !important;
            width: auto !important;
            display: block !important;
        }
        /* Force Snap Finance icon display in admin */
        .woocommerce-payment-method__icon[data-gateway="snapfinance_refined"] img {
            max-height: 24px !important;
            width: auto !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        /* Ensure Snap Finance icon displays in Blocks checkout */
        .wc-block-components-payment-method-icon[data-gateway="snapfinance_refined"] img {
            max-height: 24px !important;
            width: auto !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        /* Ensure Snap Finance icon displays in payment method label */
        .payment-method-label .payment-methods--logos[src*="snap-logo.svg"] {
            max-height: 24px !important;
            width: auto !important;
            display: inline-block !important;
            margin-left: 8px !important;
            vertical-align: middle !important;
        }
        
        /* Force reload of Snap Finance logo */
        .payment-methods--logos[src*="snap-logo.svg"] {
            max-height: 24px !important;
            width: auto !important;
            display: inline-block !important;
        }
        
        /* Style Snap Finance description text in Blocks checkout */
        .wc-block-components-payment-method-content p {
            color: #000000 !important;
            font-size: 16px !important;
            font-weight: 400 !important;
            line-height: 1.4 !important;
            margin: 0 0 15px 0 !important;
        }
        
        /* Ensure description text is black and properly sized */
        .snapfinance_refined .wc-block-components-payment-method-content p,
        .snapfinance_refined .wc-block-components-payment-method-content div p {
            color: #000000 !important;
            font-size: 16px !important;
            font-weight: 400 !important;
            line-height: 1.4 !important;
        }
        
        /* Fix Snap Finance warning boxes to use full width */
        #snap-uk-checkout div[style*="color: #d63638"][style*="background: #fcf0f1"],
        [id^="snap-validation-message"] div[style*="color: #d63638"][style*="background: #fcf0f1"],
        .snapfinance_refined div[style*="color: #d63638"][style*="background: #fcf0f1"] {
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
            margin: 10px 0 !important;
            padding: 10px !important;
            border-radius: 4px !important;
            border: 1px solid #d63638 !important;
            background: #fcf0f1 !important;
            color: #d63638 !important;
            font-size: 14px !important;
            line-height: 1.4 !important;
        }
        
        /* Ensure warning boxes don't overflow their containers */
        .wc-block-components-payment-method-content,
        .payment_box {
            overflow: visible !important;
            width: 100% !important;
        }
        
        /* Fix validation message positioning */
        [id^="snap-validation-message"] {
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
            margin: 5px 0 !important;
        }
        
        /* Ensure Snap Finance payment method content uses full width */
        .snapfinance_refined .wc-block-components-payment-method-content,
        .payment_method_snapfinance_refined .payment_box {
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
            padding: 0 !important;
            margin: 0 !important;
        }
        
        /* Ensure the Snap container itself doesn't constrain width */
        #snap-uk-checkout {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 300px !important;
        }

        </style>
        <?php
    }
}
}

/* ────────────────────────────────────────────────────────────────────────────
 * Blocks integration (kept here for convenience)
 * If you have a separate file (includes/class-wc-snap-finance-blocks.php),
 * you can remove this class here and require the file from the plugin bootstrap.
 * ─────────────────────────────────────────────────────────────────────────── */
if ( class_exists( '\Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType' ) && !class_exists('WC_Snap_Finance_Block_Support') ) {

    class WC_Snap_Finance_Block_Support extends \Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType {

        protected $name = 'snapfinance_refined';

        public function initialize() {
            $this->settings = array(); // Initialize empty, will be loaded when needed
        }

        private function get_settings() {
            if (empty($this->settings)) {
                $this->settings = get_option( 'woocommerce_snapfinance_refined_settings', array() );
                error_log('SNAP BLOCKS: Loaded settings from DB: ' . print_r($this->settings, true));
            }
            return $this->settings;
        }

        public function is_active() {
            $settings = $this->get_settings();
            $enabled  = ! empty( $settings['enabled'] ) && 'yes' === $settings['enabled'];
            if ( ! $enabled ) { return false; }
            if ( function_exists( 'WC' ) && WC()->cart ) {
                $total = (float) WC()->cart->total;
                if ( $total < \WC_Snap_Finance_Gateway::MIN_AMOUNT || $total > \WC_Snap_Finance_Gateway::MAX_AMOUNT ) {
                    return false;
                }
            }
            return true;
        }

        public function get_payment_method_script_handles() {
            // [MODIFIED] Updated path to assets/js/blocks.js (not includes/)
            wp_register_script(
                'wc-snap-finance-blocks',
                plugin_dir_url( dirname( __FILE__ ) ) . 'assets/js/blocks.js',
                array( 'wc-blocks-registry', 'wc-settings', 'wp-element', 'wp-html-entities', 'wp-data', 'jquery' ),
                ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' ),
                true
            );
            
            // Debug: Log the data being passed to registry
            $data = $this->get_payment_method_data();
            error_log('SNAP BLOCKS: Registry data: ' . print_r($data, true));
            
            return array( 'wc-snap-finance-blocks' );
        }

        public function get_payment_method_data() {
            $settings = $this->get_settings();
            
            // Fix icon URL to handle spaces in folder names properly
            $icon_url = plugins_url('assets/images/snap-logo.svg', dirname(__FILE__)) . '?v=' . ( defined('SNAP_FINANCE_PLUGIN_VERSION') ? SNAP_FINANCE_PLUGIN_VERSION : '1.0.0' );
            
            // Debug icon URL
            error_log('SNAP BLOCKS: Icon URL: ' . $icon_url);
            
            $data = array(
                'title'       => isset( $settings['title'] ) ? $settings['title'] : __( 'Snap Finance', 'snap-finance-gateway' ),
                'description' => isset( $settings['description'] ) ? $settings['description'] : __( 'Flexible payments with Snap Finance. Check eligibility, get an instant decision.', 'snap-finance-gateway' ),
                'icon'        => $icon_url,
                'icon_alt'    => 'Snap Finance',
                'supports'    => array( 'products' ),
            );
            
            error_log('SNAP BLOCKS: Payment method data: ' . print_r($data, true));
            error_log('SNAP BLOCKS: Description being passed: ' . $data['description']);
            error_log('SNAP BLOCKS: Icon being passed: ' . $data['icon']);
            return $data;
        }
    }
}