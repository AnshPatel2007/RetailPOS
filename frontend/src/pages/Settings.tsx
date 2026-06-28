import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/store/authStore';
import {
  Store,
  Receipt,
  CreditCard,
  Bell,
  Scan,
  Printer,
  DollarSign,
  TestTube2,
  Save
} from 'lucide-react';
import { hardware, HardwareSettings } from '@/services/hardware';
import { userService } from '@/services/api';
import toast from 'react-hot-toast';

export const Settings: React.FC = () => {
  const { user } = useAuthStore();
  const [hardwareSettings, setHardwareSettings] = useState<HardwareSettings>(
    hardware.getSettings()
  );
  const [scannerTestResult, setScannerTestResult] = useState<string>('');

  // Store settings state
  const [storeSettings, setStoreSettings] = useState({
    storeName: 'Main Store',
    address: '123 Main Street',
    city: 'New York',
    state: 'NY',
    taxRate: '8.875',
  });

  // Receipt settings state
  const [receiptSettings, setReceiptSettings] = useState({
    header: 'Thank you for your purchase!',
    footer: 'Please come again!',
    showAddress: true,
    showTaxBreakdown: true,
  });

  // Payment methods state
  const [paymentMethods, setPaymentMethods] = useState({
    cash: true,
    card: true,
    giftCard: false,
    storeCredit: false,
  });

  // Notification settings state
  const [notificationSettings, setNotificationSettings] = useState({
    lowStockAlerts: true,
    endOfDayReports: true,
    emailNotifications: false,
    notificationEmail: user?.email || '',
  });

  // User profile state
  const [profileSettings, setProfileSettings] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // Load saved settings on mount
  useEffect(() => {
    const savedStore = localStorage.getItem('pos_store_settings');
    const savedReceipt = localStorage.getItem('pos_receipt_settings');
    const savedPayment = localStorage.getItem('pos_payment_methods');
    const savedNotifications = localStorage.getItem('pos_notification_settings');

    if (savedStore) setStoreSettings(JSON.parse(savedStore));
    if (savedReceipt) setReceiptSettings(JSON.parse(savedReceipt));
    if (savedPayment) setPaymentMethods(JSON.parse(savedPayment));
    if (savedNotifications) setNotificationSettings(JSON.parse(savedNotifications));
  }, []);

  // Update profile state when user changes
  useEffect(() => {
    if (user) {
      setProfileSettings(prev => ({
        ...prev,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
      }));
      setNotificationSettings(prev => ({
        ...prev,
        notificationEmail: user.email || '',
      }));
    }
  }, [user]);

  // Save handlers
  const saveStoreSettings = () => {
    localStorage.setItem('pos_store_settings', JSON.stringify(storeSettings));
    toast.success('Store settings saved');
  };

  const saveReceiptSettings = () => {
    localStorage.setItem('pos_receipt_settings', JSON.stringify(receiptSettings));
    toast.success('Receipt settings saved');
  };

  const savePaymentMethods = () => {
    localStorage.setItem('pos_payment_methods', JSON.stringify(paymentMethods));
    toast.success('Payment methods saved');
  };

  const saveNotificationSettings = () => {
    localStorage.setItem('pos_notification_settings', JSON.stringify(notificationSettings));
    toast.success('Notification settings saved');
  };

  const saveUserProfile = async () => {
    try {
      // Update profile (name and email)
      const { data: updatedUser } = await userService.updateProfile({
        firstName: profileSettings.firstName,
        lastName: profileSettings.lastName,
        email: profileSettings.email,
      });

      // Update auth store with new user data
      useAuthStore.setState({ user: updatedUser });

      // If password change is requested, handle separately
      if (profileSettings.newPassword) {
        if (!profileSettings.currentPassword) {
          toast.error('Current password is required to change password');
          return;
        }

        if (profileSettings.newPassword !== profileSettings.confirmPassword) {
          toast.error('New passwords do not match');
          return;
        }

        await userService.changePassword({
          currentPassword: profileSettings.currentPassword,
          newPassword: profileSettings.newPassword,
          confirmPassword: profileSettings.confirmPassword,
        });

        toast.success('Profile and password updated successfully');
        setProfileSettings(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
      } else {
        toast.success('Profile updated successfully');
      }
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error || 'Failed to update profile';
      toast.error(errorMessage);
    }
  };

  // Listen for barcode scans when in test mode
  useEffect(() => {
    if (scannerTestResult) {
      const handleScan = (barcode: string) => {
        setScannerTestResult(`Scanned: ${barcode}`);
        toast.success(`Barcode detected: ${barcode}`);
      };
      hardware.scanner.onScan(handleScan);
      return () => hardware.scanner.offScan(handleScan);
    }
  }, [scannerTestResult]);

  // Handle hardware settings change
  const updateHardwareSettings = (
    section: keyof HardwareSettings,
    field: string,
    value: any
  ) => {
    setHardwareSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }));
  };

  // Save hardware settings
  const saveHardwareSettings = () => {
    hardware.saveSettings(hardwareSettings);
    toast.success('Hardware settings saved');
  };

  // Test scanner
  const testScanner = () => {
    const result = hardware.testScanner();
    setScannerTestResult(result);
    toast(result, { icon: '🔍' });
  };

  // Test printer
  const testPrinter = async () => {
    toast.loading('Opening print preview...');
    const success = await hardware.testPrinter();
    toast.dismiss();
    if (success) {
      toast.success('Test receipt generated');
    } else {
      toast.error('Failed to generate test receipt');
    }
  };

  // Test cash drawer
  const testDrawer = async () => {
    const success = await hardware.testDrawer();
    if (success) {
      toast.success('Cash drawer command sent');
    } else {
      toast.error('Failed to open cash drawer');
    }
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-muted-foreground">Configure your POS system</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Store Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Store className="h-5 w-5 mr-2" />
              Store Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Store Name"
              value={storeSettings.storeName}
              onChange={(e) => setStoreSettings({ ...storeSettings, storeName: e.target.value })}
            />
            <Input
              label="Address"
              value={storeSettings.address}
              onChange={(e) => setStoreSettings({ ...storeSettings, address: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="City"
                value={storeSettings.city}
                onChange={(e) => setStoreSettings({ ...storeSettings, city: e.target.value })}
              />
              <Input
                label="State"
                value={storeSettings.state}
                onChange={(e) => setStoreSettings({ ...storeSettings, state: e.target.value })}
              />
            </div>
            <Input
              label="Tax Rate (%)"
              type="number"
              value={storeSettings.taxRate}
              onChange={(e) => setStoreSettings({ ...storeSettings, taxRate: e.target.value })}
              step="0.001"
            />
            <Button variant="primary" onClick={saveStoreSettings}>Save Changes</Button>
          </CardContent>
        </Card>

        {/* Receipt Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Receipt className="h-5 w-5 mr-2" />
              Receipt Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Receipt Header"
              value={receiptSettings.header}
              onChange={(e) => setReceiptSettings({ ...receiptSettings, header: e.target.value })}
            />
            <Input
              label="Receipt Footer"
              value={receiptSettings.footer}
              onChange={(e) => setReceiptSettings({ ...receiptSettings, footer: e.target.value })}
            />
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={receiptSettings.showAddress}
                onChange={(e) => setReceiptSettings({ ...receiptSettings, showAddress: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Show store address on receipt</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={receiptSettings.showTaxBreakdown}
                onChange={(e) => setReceiptSettings({ ...receiptSettings, showTaxBreakdown: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Show tax breakdown</span>
            </label>
            <Button variant="primary" onClick={saveReceiptSettings}>Save Changes</Button>
          </CardContent>
        </Card>

        {/* Payment Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <CreditCard className="h-5 w-5 mr-2" />
              Payment Methods
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={paymentMethods.cash}
                  onChange={(e) => setPaymentMethods({ ...paymentMethods, cash: e.target.checked })}
                  className="rounded border-input"
                />
                <span className="text-sm">Cash</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={paymentMethods.card}
                  onChange={(e) => setPaymentMethods({ ...paymentMethods, card: e.target.checked })}
                  className="rounded border-input"
                />
                <span className="text-sm">Credit/Debit Card</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={paymentMethods.giftCard}
                  onChange={(e) => setPaymentMethods({ ...paymentMethods, giftCard: e.target.checked })}
                  className="rounded border-input"
                />
                <span className="text-sm">Gift Card</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={paymentMethods.storeCredit}
                  onChange={(e) => setPaymentMethods({ ...paymentMethods, storeCredit: e.target.checked })}
                  className="rounded border-input"
                />
                <span className="text-sm">Store Credit</span>
              </label>
            </div>
            <Button variant="primary" onClick={savePaymentMethods}>Save Changes</Button>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Bell className="h-5 w-5 mr-2" />
              Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={notificationSettings.lowStockAlerts}
                onChange={(e) => setNotificationSettings({ ...notificationSettings, lowStockAlerts: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Low stock alerts</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={notificationSettings.endOfDayReports}
                onChange={(e) => setNotificationSettings({ ...notificationSettings, endOfDayReports: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">End of day reports</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={notificationSettings.emailNotifications}
                onChange={(e) => setNotificationSettings({ ...notificationSettings, emailNotifications: e.target.checked })}
                className="rounded border-input"
              />
              <span className="text-sm">Email notifications</span>
            </label>
            <Input
              label="Notification Email"
              type="email"
              value={notificationSettings.notificationEmail}
              onChange={(e) => setNotificationSettings({ ...notificationSettings, notificationEmail: e.target.value })}
              disabled={!notificationSettings.emailNotifications}
            />
            <Button variant="primary" onClick={saveNotificationSettings}>Save Changes</Button>
          </CardContent>
        </Card>

        {/* Barcode Scanner Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Scan className="h-5 w-5 mr-2" />
              Barcode Scanner
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.barcodeScanner.enabled}
                onChange={(e) => updateHardwareSettings('barcodeScanner', 'enabled', e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm">Enable barcode scanner</span>
            </label>
            <Input
              label="Input Timeout (ms)"
              type="number"
              value={hardwareSettings.barcodeScanner.inputTimeout}
              onChange={(e) => updateHardwareSettings('barcodeScanner', 'inputTimeout', parseInt(e.target.value) || 100)}
              disabled={!hardwareSettings.barcodeScanner.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Time between keystrokes to detect scanner vs manual typing. Lower = faster scanner detection.
            </p>
            <Input
              label="Minimum Barcode Length"
              type="number"
              value={hardwareSettings.barcodeScanner.minLength}
              onChange={(e) => updateHardwareSettings('barcodeScanner', 'minLength', parseInt(e.target.value) || 6)}
              disabled={!hardwareSettings.barcodeScanner.enabled}
            />
            {scannerTestResult && (
              <div className="p-3 bg-muted rounded-md text-sm">
                {scannerTestResult}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={testScanner}
                disabled={!hardwareSettings.barcodeScanner.enabled}
              >
                <TestTube2 className="h-4 w-4 mr-2" />
                Test Scanner
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Receipt Printer Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Printer className="h-5 w-5 mr-2" />
              Receipt Printer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.receiptPrinter.enabled}
                onChange={(e) => updateHardwareSettings('receiptPrinter', 'enabled', e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm">Enable receipt printer</span>
            </label>
            <div>
              <label className="block text-sm font-medium mb-1">Paper Width</label>
              <select
                value={hardwareSettings.receiptPrinter.paperWidth}
                onChange={(e) => updateHardwareSettings('receiptPrinter', 'paperWidth', parseInt(e.target.value))}
                className="w-full px-3 py-2 rounded-md border border-input bg-background"
                disabled={!hardwareSettings.receiptPrinter.enabled}
              >
                <option value={58}>58mm (narrow)</option>
                <option value={80}>80mm (standard)</option>
              </select>
            </div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.receiptPrinter.autoPrint}
                onChange={(e) => updateHardwareSettings('receiptPrinter', 'autoPrint', e.target.checked)}
                className="rounded border-input"
                disabled={!hardwareSettings.receiptPrinter.enabled}
              />
              <span className="text-sm">Auto-print receipts</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.receiptPrinter.showLogo}
                onChange={(e) => updateHardwareSettings('receiptPrinter', 'showLogo', e.target.checked)}
                className="rounded border-input"
                disabled={!hardwareSettings.receiptPrinter.enabled}
              />
              <span className="text-sm">Show store logo</span>
            </label>
            <Input
              label="Store Name"
              value={hardwareSettings.receiptPrinter.storeName}
              onChange={(e) => updateHardwareSettings('receiptPrinter', 'storeName', e.target.value)}
              disabled={!hardwareSettings.receiptPrinter.enabled}
            />
            <Input
              label="Store Address"
              value={hardwareSettings.receiptPrinter.storeAddress}
              onChange={(e) => updateHardwareSettings('receiptPrinter', 'storeAddress', e.target.value)}
              disabled={!hardwareSettings.receiptPrinter.enabled}
            />
            <Input
              label="Store Phone"
              value={hardwareSettings.receiptPrinter.storePhone}
              onChange={(e) => updateHardwareSettings('receiptPrinter', 'storePhone', e.target.value)}
              disabled={!hardwareSettings.receiptPrinter.enabled}
            />
            <Input
              label="Footer Text"
              value={hardwareSettings.receiptPrinter.footerText}
              onChange={(e) => updateHardwareSettings('receiptPrinter', 'footerText', e.target.value)}
              disabled={!hardwareSettings.receiptPrinter.enabled}
            />
            <Button
              variant="outline"
              onClick={testPrinter}
              disabled={!hardwareSettings.receiptPrinter.enabled}
            >
              <TestTube2 className="h-4 w-4 mr-2" />
              Print Test Receipt
            </Button>
          </CardContent>
        </Card>

        {/* Cash Drawer Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <DollarSign className="h-5 w-5 mr-2" />
              Cash Drawer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.cashDrawer.enabled}
                onChange={(e) => updateHardwareSettings('cashDrawer', 'enabled', e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm">Enable cash drawer</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.cashDrawer.openOnSale}
                onChange={(e) => updateHardwareSettings('cashDrawer', 'openOnSale', e.target.checked)}
                className="rounded border-input"
                disabled={!hardwareSettings.cashDrawer.enabled}
              />
              <span className="text-sm">Open drawer on sale completion</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.cashDrawer.openOnCashPayment}
                onChange={(e) => updateHardwareSettings('cashDrawer', 'openOnCashPayment', e.target.checked)}
                className="rounded border-input"
                disabled={!hardwareSettings.cashDrawer.enabled}
              />
              <span className="text-sm">Only open for cash payments</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Cash drawer opens via ESC/POS command through the receipt printer's RJ11/RJ12 port.
            </p>
            <Button
              variant="outline"
              onClick={testDrawer}
              disabled={!hardwareSettings.cashDrawer.enabled}
            >
              <TestTube2 className="h-4 w-4 mr-2" />
              Test Cash Drawer
            </Button>
          </CardContent>
        </Card>

        {/* Card Reader Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <CreditCard className="h-5 w-5 mr-2" />
              Card Reader (Future)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={hardwareSettings.cardReader.enabled}
                onChange={(e) => updateHardwareSettings('cardReader', 'enabled', e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-sm">Enable card reader</span>
            </label>
            <Input
              label="Terminal ID"
              value={hardwareSettings.cardReader.terminalId}
              onChange={(e) => updateHardwareSettings('cardReader', 'terminalId', e.target.value)}
              placeholder="Enter your terminal ID"
              disabled={!hardwareSettings.cardReader.enabled}
            />
            <p className="text-xs text-muted-foreground">
              Integration with Stripe Terminal or Square Reader coming soon.
            </p>
          </CardContent>
        </Card>

        {/* Save Hardware Settings */}
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-medium">Hardware Settings</h3>
                <p className="text-sm text-muted-foreground">
                  Save all hardware configuration changes
                </p>
              </div>
              <Button variant="primary" onClick={saveHardwareSettings}>
                <Save className="h-4 w-4 mr-2" />
                Save Hardware Settings
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* User Profile */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>User Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <Input
                label="First Name"
                value={profileSettings.firstName}
                onChange={(e) => setProfileSettings({ ...profileSettings, firstName: e.target.value })}
              />
              <Input
                label="Last Name"
                value={profileSettings.lastName}
                onChange={(e) => setProfileSettings({ ...profileSettings, lastName: e.target.value })}
              />
            </div>
            <Input
              label="Email"
              type="email"
              value={profileSettings.email}
              onChange={(e) => setProfileSettings({ ...profileSettings, email: e.target.value })}
              className="mb-4"
            />
            <div className="mb-4">
              <p className="text-sm font-medium mb-2">Change Password (Optional)</p>
              <p className="text-sm text-muted-foreground mb-3">Leave blank to keep current password</p>
            </div>
            <Input
              label="Current Password"
              type="password"
              placeholder="Required to change password"
              value={profileSettings.currentPassword}
              onChange={(e) => setProfileSettings({ ...profileSettings, currentPassword: e.target.value })}
              className="mb-4"
            />
            <div className="grid grid-cols-2 gap-4 mb-4">
              <Input
                label="New Password"
                type="password"
                placeholder="At least 6 characters"
                value={profileSettings.newPassword}
                onChange={(e) => setProfileSettings({ ...profileSettings, newPassword: e.target.value })}
              />
              <Input
                label="Confirm New Password"
                type="password"
                placeholder="Must match new password"
                value={profileSettings.confirmPassword}
                onChange={(e) => setProfileSettings({ ...profileSettings, confirmPassword: e.target.value })}
              />
            </div>
            <Button variant="primary" onClick={saveUserProfile}>Update Profile</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
