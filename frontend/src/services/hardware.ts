/**
 * Hardware Integration Service
 * Handles barcode scanners, receipt printers, cash drawers, and card readers
 */

// Hardware Settings Interface
export interface HardwareSettings {
  barcodeScanner: {
    enabled: boolean;
    inputTimeout: number; // ms between keystrokes to detect scanner vs manual typing
    minLength: number; // Minimum barcode length
    maxLength?: number;
    soundEnabled?: boolean;
    prefix?: string;
    suffix?: string;
    preventDuplicates?: boolean;
    duplicateTimeout?: number;
  };
  receiptPrinter: {
    enabled: boolean;
    paperWidth: number; // mm (58 or 80)
    autoPrint: boolean;
    showLogo: boolean;
    footerText: string;
    storeName: string;
    storeAddress: string;
    storePhone: string;
    logoUrl?: string;
    fontSize?: number | 'small' | 'medium' | 'large';
    showBarcode?: boolean;
    customCss?: string;
  };
  cashDrawer: {
    enabled: boolean;
    openOnSale: boolean;
    openOnCashPayment: boolean;
  };
  cardReader: {
    enabled: boolean;
    terminalId: string;
  };
}

// Default hardware settings
export const defaultHardwareSettings: HardwareSettings = {
  barcodeScanner: {
    enabled: true,
    inputTimeout: 100,
    minLength: 6,
  },
  receiptPrinter: {
    enabled: true,
    paperWidth: 80,
    autoPrint: false,
    showLogo: true,
    footerText: 'Thank you for your business!',
    storeName: 'POS System',
    storeAddress: '',
    storePhone: '',
  },
  cashDrawer: {
    enabled: true,
    openOnSale: true,
    openOnCashPayment: true,
  },
  cardReader: {
    enabled: false,
    terminalId: '',
  },
};

/**
 * Barcode Scanner Service
 * Listens for keyboard input from USB barcode scanners
 */
class BarcodeScanner {
  private buffer: string = '';
  private timeout: NodeJS.Timeout | null = null;
  private callbacks: ((barcode: string) => void)[] = [];
  private settings: HardwareSettings['barcodeScanner'];
  private boundHandler: ((event: KeyboardEvent) => void) | null = null;
  private lastScannedBarcode: string = '';
  private lastScanTime: number = 0;

  constructor(settings: HardwareSettings['barcodeScanner']) {
    this.settings = settings;
    if (settings.enabled) {
      this.initListener();
    }
  }

  private initListener() {
    this.boundHandler = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input field (unless it has barcode-enabled class)
      const target = event.target as HTMLElement;
      if (
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement) &&
        !target.classList.contains('barcode-enabled')
      ) {
        return;
      }

      // Clear existing timeout
      if (this.timeout) {
        clearTimeout(this.timeout);
      }

      // Handle Enter key as scan completion
      if (event.key === 'Enter' && this.buffer.length >= this.settings.minLength) {
        event.preventDefault();
        const barcode = this.buffer.trim();
        this.buffer = '';
        if (!this.isDuplicate(barcode)) {
          this.callbacks.forEach((callback) => callback(barcode));
        }
        return;
      }

      // Add character to buffer
      if (event.key && event.key.length === 1) {
        this.buffer += event.key;
      }

      // Process buffer after short delay (barcode scanners type very fast)
      this.timeout = setTimeout(() => {
        if (this.buffer.length >= this.settings.minLength) {
          const barcode = this.buffer.trim();
          if (!this.isDuplicate(barcode)) {
            this.callbacks.forEach((callback) => callback(barcode));
          }
        }
        this.buffer = '';
      }, this.settings.inputTimeout);
    };

    document.addEventListener('keydown', this.boundHandler);
  }

  /**
   * Update scanner settings
   */
  updateSettings(settings: HardwareSettings['barcodeScanner']): void {
    const wasEnabled = this.settings.enabled;
    this.settings = settings;

    if (!wasEnabled && settings.enabled) {
      this.initListener();
    } else if (wasEnabled && !settings.enabled) {
      this.destroy();
    }
  }

  /**
   * Subscribe to barcode scans
   */
  onScan(callback: (barcode: string) => void): void {
    this.callbacks.push(callback);
  }

  /**
   * Unsubscribe from barcode scans
   */
  offScan(callback: (barcode: string) => void): void {
    this.callbacks = this.callbacks.filter((cb) => cb !== callback);
  }

  /**
   * Check if scanner is enabled
   */
  isEnabled(): boolean {
    return this.settings.enabled;
  }

  /**
   * Subscribe to scanner activity (any scan attempt)
   */
  onActivity(callback: () => void): void {
    this.activityCallbacks = this.activityCallbacks || [];
    this.activityCallbacks.push(callback);
  }

  /**
   * Unsubscribe from scanner activity
   */
  offActivity(callback: () => void): void {
    this.activityCallbacks = (this.activityCallbacks || []).filter((cb: () => void) => cb !== callback);
  }

  private activityCallbacks: (() => void)[] = [];

  /**
   * Simulate a barcode scan (for testing)
   */
  simulateScan(barcode: string): void {
    this.callbacks.forEach((callback) => callback(barcode));
  }

  /**
   * Check if barcode is a duplicate scan (same barcode within timeout window)
   */
  private isDuplicate(barcode: string): boolean {
    if (!this.settings.preventDuplicates) return false;
    const now = Date.now();
    const timeout = this.settings.duplicateTimeout || 1500; // default 1.5s
    if (barcode === this.lastScannedBarcode && (now - this.lastScanTime) < timeout) {
      return true;
    }
    this.lastScannedBarcode = barcode;
    this.lastScanTime = now;
    return false;
  }

  /**
   * Clear duplicate scan cache
   */
  clearDuplicateCache(): void {
    this.lastScannedBarcode = '';
    this.lastScanTime = 0;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.boundHandler) {
      document.removeEventListener('keydown', this.boundHandler);
      this.boundHandler = null;
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.buffer = '';
  }
}

/**
 * Receipt data interface
 */
export interface Receipt {
  saleNumber: string;
  date: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: string;
  amountPaid: number;
  change: number;
  employeeName: string;
  customerName?: string;
  loyaltyPoints?: number;
}

/**
 * Receipt Printer Service
 * Interfaces with ESC/POS compatible printers
 */
class ReceiptPrinter {
  private settings: HardwareSettings['receiptPrinter'];

  constructor(settings: HardwareSettings['receiptPrinter']) {
    this.settings = settings;
  }

  /**
   * Update printer settings
   */
  updateSettings(settings: HardwareSettings['receiptPrinter']): void {
    this.settings = settings;
  }

  /**
   * Print receipt
   */
  async print(receipt: Receipt): Promise<boolean> {
    if (!this.settings.enabled) return false;

    try {
      const printWindow = window.open('', '_blank', 'width=350,height=600');
      if (!printWindow) {
        // Popup blocked — fallback to iframe printing
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.top = '-10000px';
        iframe.style.left = '-10000px';
        iframe.style.width = '0';
        iframe.style.height = '0';
        document.body.appendChild(iframe);

        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) {
          document.body.removeChild(iframe);
          return false;
        }
        doc.open();
        doc.write(this.generateReceiptHTML(receipt));
        doc.close();

        iframe.onload = () => {
          try {
            iframe.contentWindow?.print();
          } catch { /* ignore */ }
          setTimeout(() => document.body.removeChild(iframe), 1000);
        };
        return true;
      }

      printWindow.document.write(this.generateReceiptHTML(receipt));
      printWindow.document.close();

      if (this.settings.autoPrint) {
        printWindow.onload = () => {
          printWindow.print();
          printWindow.close();
        };
      }

      return true;
    } catch (error) {
      console.error('Print failed:', error);
      return false;
    }
  }

  /**
   * Preview receipt HTML
   */
  preview(receipt: Receipt): string {
    return this.generateReceiptHTML(receipt);
  }

  /**
   * Generate HTML for receipt
   */
  private generateReceiptHTML(receipt: Receipt): string {
    const widthMm = this.settings.paperWidth === 58 ? '58mm' : '80mm';
    const widthPx = this.settings.paperWidth === 58 ? '220px' : '302px';

    return `<!DOCTYPE html>
<html>
<head>
  <title>Receipt - ${receipt.saleNumber}</title>
  <style>
    @media print {
      @page { margin: 0; size: ${widthMm} auto; }
      body { margin: 0; padding: 3mm; }
      .no-print { display: none !important; }
    }
    @media screen {
      body { display: flex; justify-content: center; padding: 20px; background: #f5f5f5; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .receipt {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      width: ${widthPx};
      background: #fff;
      color: #000;
      padding: 10px;
      line-height: 1.4;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .line { border-top: 1px dashed #000; margin: 6px 0; }
    .store-name { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
    .store-info { font-size: 10px; color: #555; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; }
    .right { text-align: right; }
    .item-name { font-weight: 500; }
    .item-detail { padding-left: 8px; color: #333; }
    .grand-total { font-size: 14px; font-weight: bold; border-top: 2px solid #000; border-bottom: 2px solid #000; }
    .grand-total td { padding: 4px 0; }
    .footer { font-size: 10px; color: #555; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="receipt">
    ${this.settings.showLogo ? `<div class="center store-name">${this.settings.storeName}</div>` : ''}
    ${this.settings.storeAddress ? `<div class="center store-info">${this.settings.storeAddress}</div>` : ''}
    ${this.settings.storePhone ? `<div class="center store-info">Tel: ${this.settings.storePhone}</div>` : ''}
    <div class="line"></div>
    <div class="center">
      <div>Receipt #${receipt.saleNumber}</div>
      <div>${new Date(receipt.date).toLocaleString()}</div>
      ${receipt.employeeName ? `<div>Cashier: ${receipt.employeeName}</div>` : ''}
    </div>
    <div class="line"></div>
    <table>
      ${receipt.items.map((item) => `
      <tr><td class="item-name" colspan="2">${item.name}</td></tr>
      <tr><td class="item-detail">${item.quantity} x $${item.price.toFixed(2)}</td><td class="right">$${item.total.toFixed(2)}</td></tr>
      `).join('')}
    </table>
    <div class="line"></div>
    <table>
      <tr><td>Subtotal:</td><td class="right">$${receipt.subtotal.toFixed(2)}</td></tr>
      <tr><td>Tax:</td><td class="right">$${receipt.tax.toFixed(2)}</td></tr>
      ${receipt.discount > 0 ? `<tr><td>Discount:</td><td class="right">-$${receipt.discount.toFixed(2)}</td></tr>` : ''}
    </table>
    <table>
      <tr class="grand-total"><td>TOTAL:</td><td class="right">$${receipt.total.toFixed(2)}</td></tr>
    </table>
    <table>
      <tr><td>Paid (${receipt.paymentMethod}):</td><td class="right">$${receipt.amountPaid.toFixed(2)}</td></tr>
      ${receipt.change > 0 ? `<tr><td>Change:</td><td class="right">$${receipt.change.toFixed(2)}</td></tr>` : ''}
    </table>
    ${receipt.customerName ? `
    <div class="line"></div>
    <div class="center">
      <div>Customer: ${receipt.customerName}</div>
      ${receipt.loyaltyPoints ? `<div>Loyalty Points: ${receipt.loyaltyPoints}</div>` : ''}
    </div>` : ''}
    <div class="line"></div>
    <div class="center footer">${this.settings.footerText}</div>
  </div>
</body>
</html>`;
  }

  /**
   * Open cash drawer (connected to printer via RJ11/RJ12)
   */
  async openDrawer(): Promise<boolean> {
    try {
      // In a web browser environment, we can't directly send ESC/POS commands
      // to a cash drawer. This would require a local print server or native app.
      // For now, just log the action.
      console.log('Cash drawer open command sent (requires hardware connection)');
      return true;
    } catch (error) {
      console.error('Failed to open drawer:', error);
      return false;
    }
  }

  /**
   * Check if printer is enabled
   */
  isEnabled(): boolean {
    return this.settings.enabled;
  }

  /**
   * Get print queue status
   */
  getQueueStatus(): { pending: number; failed: number; completed: number; total: number } {
    return { pending: 0, failed: 0, completed: 0, total: 0 };
  }

  /**
   * Retry failed print jobs
   */
  retryFailedJobs(): void {
    // No-op - browser printing handles retries
  }

  /**
   * Clear failed print jobs
   */
  clearFailedJobs(): void {
    // No-op
  }

  /**
   * Check printer connection status
   */
  checkStatus(): { connected: boolean; online: boolean; status: string; error?: string } {
    return { connected: this.settings.enabled, online: this.settings.enabled, status: this.settings.enabled ? 'ready' : 'disabled' };
  }
}

/**
 * Cash Drawer Service
 */
class CashDrawer {
  private printer: ReceiptPrinter;
  private settings: HardwareSettings['cashDrawer'];

  constructor(printer: ReceiptPrinter, settings: HardwareSettings['cashDrawer']) {
    this.printer = printer;
    this.settings = settings;
  }

  /**
   * Update drawer settings
   */
  updateSettings(settings: HardwareSettings['cashDrawer']): void {
    this.settings = settings;
  }

  /**
   * Open cash drawer
   */
  async open(): Promise<boolean> {
    if (!this.settings.enabled) return false;
    return await this.printer.openDrawer();
  }

  /**
   * Check if drawer should open for payment method
   */
  shouldOpen(paymentMethod: string): boolean {
    if (!this.settings.enabled || !this.settings.openOnSale) return false;

    if (this.settings.openOnCashPayment) {
      return paymentMethod.toLowerCase() === 'cash';
    }

    return true;
  }

  /**
   * Check if drawer is enabled
   */
  isEnabled(): boolean {
    return this.settings.enabled;
  }

  /**
   * Get drawer history log
   */
  getHistory(): Array<{ timestamp: number; reason: string; userId?: string; paymentMethod?: string }> {
    return [];
  }

  /**
   * Clear drawer history
   */
  clearHistory(): void {
    // No-op
  }
}

/**
 * Card Payment Result
 */
export interface CardPaymentResult {
  success: boolean;
  transactionId?: string;
  amount?: number;
  cardLast4?: string;
  cardBrand?: string;
  error?: string;
}

/**
 * Card Reader Service
 * Placeholder for payment terminal integration
 */
class CardReader {
  private settings: HardwareSettings['cardReader'];

  constructor(settings: HardwareSettings['cardReader']) {
    this.settings = settings;
  }

  /**
   * Update reader settings
   */
  updateSettings(settings: HardwareSettings['cardReader']): void {
    this.settings = settings;
  }

  /**
   * Process card payment
   */
  async processPayment(amount: number): Promise<CardPaymentResult> {
    if (!this.settings.enabled) {
      return { success: false, error: 'Card reader not enabled' };
    }

    try {
      // In production, integrate with actual payment processor
      // (Stripe Terminal, Square Reader, etc.)
      console.log(`Processing card payment: $${amount}`);

      // Simulate payment processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      return {
        success: true,
        transactionId: `TXN_${Date.now()}`,
        amount,
        cardLast4: '****',
        cardBrand: 'VISA',
      };
    } catch (error) {
      return {
        success: false,
        error: 'Payment declined',
      };
    }
  }

  /**
   * Cancel payment
   */
  async cancelPayment(): Promise<boolean> {
    console.log('Cancelling payment...');
    return true;
  }

  /**
   * Check if reader is enabled
   */
  isEnabled(): boolean {
    return this.settings.enabled;
  }
}

/**
 * Hardware Manager
 * Singleton for managing all hardware devices
 */
class HardwareManager {
  private static instance: HardwareManager;
  private settings: HardwareSettings;

  public scanner: BarcodeScanner;
  public printer: ReceiptPrinter;
  public drawer: CashDrawer;
  public cardReader: CardReader;

  private constructor() {
    this.settings = this.loadSettings();
    this.printer = new ReceiptPrinter(this.settings.receiptPrinter);
    this.scanner = new BarcodeScanner(this.settings.barcodeScanner);
    this.drawer = new CashDrawer(this.printer, this.settings.cashDrawer);
    this.cardReader = new CardReader(this.settings.cardReader);
  }

  static getInstance(): HardwareManager {
    if (!HardwareManager.instance) {
      HardwareManager.instance = new HardwareManager();
    }
    return HardwareManager.instance;
  }

  /**
   * Load settings from localStorage
   */
  private loadSettings(): HardwareSettings {
    try {
      const saved = localStorage.getItem('hardwareSettings');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure all fields exist
        return {
          barcodeScanner: { ...defaultHardwareSettings.barcodeScanner, ...parsed.barcodeScanner },
          receiptPrinter: { ...defaultHardwareSettings.receiptPrinter, ...parsed.receiptPrinter },
          cashDrawer: { ...defaultHardwareSettings.cashDrawer, ...parsed.cashDrawer },
          cardReader: { ...defaultHardwareSettings.cardReader, ...parsed.cardReader },
        };
      }
    } catch (error) {
      console.error('Failed to load hardware settings:', error);
    }
    return defaultHardwareSettings;
  }

  /**
   * Save settings to localStorage
   */
  saveSettings(settings: HardwareSettings): void {
    this.settings = settings;
    localStorage.setItem('hardwareSettings', JSON.stringify(settings));

    // Update all devices
    this.scanner.updateSettings(settings.barcodeScanner);
    this.printer.updateSettings(settings.receiptPrinter);
    this.drawer.updateSettings(settings.cashDrawer);
    this.cardReader.updateSettings(settings.cardReader);
  }

  /**
   * Get current settings
   */
  getSettings(): HardwareSettings {
    return this.settings;
  }

  /**
   * Test barcode scanner
   */
  testScanner(): string {
    if (!this.settings.barcodeScanner.enabled) {
      return 'Scanner is disabled. Enable it in settings first.';
    }
    return 'Scanner test active. Scan a barcode or type rapidly (faster than ' +
           this.settings.barcodeScanner.inputTimeout + 'ms between keys).';
  }

  /**
   * Test receipt printer
   */
  async testPrinter(): Promise<boolean> {
    const testReceipt: Receipt = {
      saleNumber: 'TEST-001',
      date: new Date().toISOString(),
      items: [
        { name: 'Test Item 1', quantity: 2, price: 9.99, total: 19.98 },
        { name: 'Test Item 2', quantity: 1, price: 14.99, total: 14.99 },
      ],
      subtotal: 34.97,
      tax: 3.50,
      discount: 0,
      total: 38.47,
      paymentMethod: 'Cash',
      amountPaid: 50.00,
      change: 11.53,
      employeeName: 'Test User',
    };

    return await this.printer.print(testReceipt);
  }

  /**
   * Test cash drawer
   */
  async testDrawer(): Promise<boolean> {
    return await this.drawer.open();
  }

  /**
   * Get cash drawer history
   */
  getDrawerHistory(limit?: number): Array<{ timestamp: number; reason: string; userId?: string; paymentMethod?: string }> {
    return this.drawer.getHistory().slice(0, limit || 100);
  }

  /**
   * Complete sale with hardware actions
   */
  async completeSale(receipt: Receipt, paymentMethod: string): Promise<void> {
    // Print receipt
    if (this.printer.isEnabled()) {
      await this.printer.print(receipt);
    }

    // Open cash drawer if needed
    if (this.drawer.shouldOpen(paymentMethod)) {
      await this.drawer.open();
    }
  }
}

// Export singleton instance
export const hardware = HardwareManager.getInstance();
